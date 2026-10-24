'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { PlayerLocation } from '../types/game';

export type ExtendedGpsStatus =
  | 'WAITING_FOR_PERMISSION'
  | 'ACQUIRING_FIX'
  | 'ACQUIRED'
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED';

export interface OneShotGpsDiagnostics {
  status: 'IDLE' | 'REQUESTING' | 'SUCCESS' | 'ERROR';
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number | null;
  errorCode: number | null;
  errorName: string | null;
  errorMessage: string | null;
}

interface UseGeolocationOptions {
  onLocationUpdate?: (location: PlayerLocation) => void;
  stalenessThresholdSeconds?: number;
}

export function useGeolocation({
  onLocationUpdate,
  stalenessThresholdSeconds = 45,
}: UseGeolocationOptions = {}) {
  const [location, setLocation] = useState<PlayerLocation | null>(null);
  const [gpsStatus, setGpsStatus] = useState<ExtendedGpsStatus>('WAITING_FOR_PERMISSION');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [browserPermissionState, setBrowserPermissionState] = useState<string>('unknown');

  const lastUpdateRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);

  // Store callback in ref to prevent infinite re-render / watchPosition cancellation loop
  const onLocationUpdateRef = useRef(onLocationUpdate);
  onLocationUpdateRef.current = onLocationUpdate;

  // Dedicated one-shot diagnostics state for explicit navigator.geolocation.getCurrentPosition()
  const [oneShotGps, setOneShotGps] = useState<OneShotGpsDiagnostics>({
    status: 'IDLE',
    latitude: null,
    longitude: null,
    accuracy: null,
    altitude: null,
    heading: null,
    speed: null,
    timestamp: null,
    errorCode: null,
    errorName: null,
    errorMessage: null,
  });

  const handleSuccess = useCallback((pos: GeolocationPosition) => {
    const now = Date.now();
    lastUpdateRef.current = now;

    const playerLoc: PlayerLocation = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy * 10) / 10,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: now,
    };

    setLocation(playerLoc);
    setGpsStatus('ACQUIRED');
    setErrorMessage(null);
    setErrorCode(null);
    setIsStale(false);

    if (onLocationUpdateRef.current) {
      onLocationUpdateRef.current(playerLoc);
    }
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    setErrorCode(err.code);
    switch (err.code) {
      case err.PERMISSION_DENIED:
        setGpsStatus('PERMISSION_DENIED');
        setErrorMessage(
          err.message || 'Location permission denied. Please allow location access in your browser settings.'
        );
        break;
      case err.POSITION_UNAVAILABLE:
        setGpsStatus('POSITION_UNAVAILABLE');
        setErrorMessage(
          err.message || 'GPS position unavailable. Ensure device location services/GPS are enabled.'
        );
        break;
      case err.TIMEOUT:
        setGpsStatus('TIMEOUT');
        setErrorMessage(
          err.message || 'GPS location request timed out. Attempting satellite signal acquisition...'
        );
        break;
      default:
        setGpsStatus('POSITION_UNAVAILABLE');
        setErrorMessage(err.message || 'Unknown geolocation error.');
    }
  }, []);

  // Explicit one-shot call to navigator.geolocation.getCurrentPosition()
  const requestOneShotGps = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setOneShotGps({
        status: 'ERROR',
        latitude: null,
        longitude: null,
        accuracy: null,
        altitude: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
        errorCode: 0,
        errorName: 'UNSUPPORTED',
        errorMessage: 'Geolocation API is not supported in this browser.',
      });
      setGpsStatus('UNSUPPORTED');
      return;
    }

    setOneShotGps((prev) => ({ ...prev, status: 'REQUESTING', errorMessage: null }));

    navigator.geolocation.getCurrentPosition(
      (pos: GeolocationPosition) => {
        setOneShotGps({
          status: 'SUCCESS',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy * 10) / 10,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp || Date.now(),
          errorCode: null,
          errorName: null,
          errorMessage: null,
        });

        // Also update player location
        handleSuccess(pos);
      },
      (err: GeolocationPositionError) => {
        let errorName = 'UNKNOWN_ERROR';
        if (err.code === err.PERMISSION_DENIED) errorName = 'PERMISSION_DENIED';
        else if (err.code === err.POSITION_UNAVAILABLE) errorName = 'POSITION_UNAVAILABLE';
        else if (err.code === err.TIMEOUT) errorName = 'TIMEOUT';

        setOneShotGps({
          status: 'ERROR',
          latitude: null,
          longitude: null,
          accuracy: null,
          altitude: null,
          heading: null,
          speed: null,
          timestamp: Date.now(),
          errorCode: err.code,
          errorName,
          errorMessage: err.message || errorName,
        });

        handleError(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0, // Force fresh hardware reading
      }
    );
  }, [handleSuccess, handleError]);

  // Start continuous watching without teardown loops
  const startWatching = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('UNSUPPORTED');
      setErrorMessage('Geolocation is not supported by your browser.');
      return;
    }

    // Check browser permission status if supported
    if ('permissions' in navigator && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((permissionStatus) => {
          setBrowserPermissionState(permissionStatus.state);
          if (permissionStatus.state === 'denied') {
            setGpsStatus('PERMISSION_DENIED');
            setErrorMessage('Location permission is blocked in browser settings for this site.');
          } else if (permissionStatus.state === 'granted') {
            setGpsStatus((prev) => (prev === 'ACQUIRED' ? 'ACQUIRED' : 'ACQUIRING_FIX'));
          } else if (permissionStatus.state === 'prompt') {
            setGpsStatus('WAITING_FOR_PERMISSION');
          }

          permissionStatus.onchange = () => {
            setBrowserPermissionState(permissionStatus.state);
            if (permissionStatus.state === 'denied') {
              setGpsStatus('PERMISSION_DENIED');
              setErrorMessage('Location permission was denied in browser settings.');
            } else if (permissionStatus.state === 'granted') {
              setGpsStatus((prev) => (prev === 'ACQUIRED' ? 'ACQUIRED' : 'ACQUIRING_FIX'));
              // Immediately request position once permission is granted
              requestOneShotGps();
            }
          };
        })
        .catch(() => {
          // Ignore permissions query errors on browsers that don't support it
        });
    }

    // Call getCurrentPosition first for fast initial position lock
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleSuccess(pos);
      },
      (err) => {
        // If high-accuracy timed out on initial request, retry once with standard accuracy
        if (err.code === err.TIMEOUT) {
          navigator.geolocation.getCurrentPosition(
            handleSuccess,
            handleError,
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 10000 }
          );
        } else {
          handleError(err);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      }
    );

    // Clear existing watch if any
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    // Start continuous watchPosition
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000,
      }
    );
  }, [handleSuccess, handleError, requestOneShotGps]);

  // Mount effect: Starts watching once on mount and manages staleness
  useEffect(() => {
    startWatching();

    const staleInterval = setInterval(() => {
      if (lastUpdateRef.current > 0) {
        const secondsSinceLastUpdate = (Date.now() - lastUpdateRef.current) / 1000;
        if (secondsSinceLastUpdate >= stalenessThresholdSeconds) {
          setIsStale(true);
        } else {
          setIsStale(false);
        }
      }
    }, 5000);

    return () => {
      if (watchIdRef.current !== null && typeof window !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      clearInterval(staleInterval);
    };
  }, [startWatching, stalenessThresholdSeconds]);

  return {
    location,
    gpsStatus,
    errorMessage,
    errorCode,
    isStale,
    browserPermissionState,
    oneShotGps,
    requestOneShotGps,
    refreshGps: startWatching,
  };
}
