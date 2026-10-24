'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { PlayerLocation } from '../types/game';

export type ExtendedGpsStatus =
  | 'NOT_ENABLED'
  | 'INSECURE_CONTEXT'
  | 'WAITING_FOR_PERMISSION'
  | 'ACQUIRING_FIX'
  | 'ACQUIRED'
  | 'WEAK_SIGNAL'
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
  autoStart?: boolean;
}

export function useGeolocation({
  onLocationUpdate,
  stalenessThresholdSeconds = 45,
  autoStart = false,
}: UseGeolocationOptions = {}) {
  const [location, setLocation] = useState<PlayerLocation | null>(null);
  const [gpsStatus, setGpsStatus] = useState<ExtendedGpsStatus>('NOT_ENABLED');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [lastFixTimestamp, setLastFixTimestamp] = useState<number | null>(null);
  const [browserPermissionState, setBrowserPermissionState] = useState<string>('unknown');
  const [isSecure, setIsSecure] = useState<boolean>(true);

  const lastUpdateRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const isStartedRef = useRef<boolean>(false);

  // Store callback in ref to prevent infinite re-render loops
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

  // Verify secure context on client mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const secure = window.isSecureContext ?? (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      setIsSecure(secure);
      if (!secure) {
        setGpsStatus('INSECURE_CONTEXT');
        setErrorMessage(
          'Mobile browsers require a Secure Context (HTTPS) for GPS access. When testing over LAN, access via HTTPS or configure browser flags.'
        );
      }
    }
  }, []);

  const handleSuccess = useCallback((pos: GeolocationPosition) => {
    const now = Date.now();
    lastUpdateRef.current = now;
    const reportedAccuracy = Math.round(pos.coords.accuracy * 10) / 10;

    const playerLoc: PlayerLocation = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: reportedAccuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: now,
    };

    setLocation(playerLoc);
    setAccuracy(reportedAccuracy);
    setLastFixTimestamp(now);
    // Distinguish between high accuracy and weak signal (> 25m)
    if (reportedAccuracy > 25) {
      setGpsStatus('WEAK_SIGNAL');
    } else {
      setGpsStatus('ACQUIRED');
    }
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
          'Location permission denied. Please allow location access in your browser and operating system settings.'
        );
        break;
      case err.POSITION_UNAVAILABLE:
        setGpsStatus('POSITION_UNAVAILABLE');
        setErrorMessage(
          'GPS position unavailable. Ensure device location / GPS hardware is turned on and you have a clear view of the sky.'
        );
        break;
      case err.TIMEOUT:
        setGpsStatus('TIMEOUT');
        setErrorMessage(
          'GPS fix timed out. Acquiring satellite lock; move outdoors or near a window...'
        );
        break;
      default:
        setGpsStatus('POSITION_UNAVAILABLE');
        setErrorMessage(err.message || 'Unknown GPS error.');
    }
  }, []);

  // One-shot explicit request
  const requestOneShotGps = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setGpsStatus('INSECURE_CONTEXT');
      setErrorMessage('HTTPS connection required for mobile GPS.');
      setOneShotGps({
        status: 'ERROR',
        latitude: null,
        longitude: null,
        accuracy: null,
        altitude: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
        errorCode: 1,
        errorName: 'INSECURE_CONTEXT',
        errorMessage: 'Geolocation is restricted to Secure Contexts (HTTPS).',
      });
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatus('UNSUPPORTED');
      setErrorMessage('Geolocation API is not supported in this browser.');
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
        errorMessage: 'Geolocation API is not supported.',
      });
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
        maximumAge: 0,
      }
    );
  }, [handleSuccess, handleError]);

  // User-initiated or game-initiated continuous tracking
  const requestLocationAccess = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setGpsStatus('INSECURE_CONTEXT');
      setErrorMessage(
        'Geolocation is blocked on insecure HTTP over LAN. Open the app via HTTPS (e.g. dev:https) to enable mobile GPS.'
      );
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatus('UNSUPPORTED');
      setErrorMessage('Geolocation is not supported by your browser.');
      return;
    }

    isStartedRef.current = true;
    setGpsStatus('ACQUIRING_FIX');
    setErrorMessage(null);

    // Check browser permission status if supported
    if ('permissions' in navigator && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((permissionStatus) => {
          setBrowserPermissionState(permissionStatus.state);
          if (permissionStatus.state === 'denied') {
            setGpsStatus('PERMISSION_DENIED');
            setErrorMessage('Location permission is blocked in browser settings for this site.');
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
              requestOneShotGps();
            }
          };
        })
        .catch(() => {});
    }

    // Call getCurrentPosition first for rapid fix
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleSuccess(pos);
      },
      (err) => {
        if (err.code === err.TIMEOUT) {
          // Retry once with standard accuracy if high accuracy timed out initially
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
        timeout: 12000,
        maximumAge: 3000,
      }
    );

    // Clear existing watch if any to prevent duplicate watchers
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Start continuous watchPosition
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 4000,
      }
    );
  }, [handleSuccess, handleError, requestOneShotGps]);

  // Clean stop for when user leaves room or match ends
  const stopLocationAccess = useCallback(() => {
    isStartedRef.current = false;
    if (watchIdRef.current !== null && typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsStatus('NOT_ENABLED');
    setLocation(null);
  }, []);

  // Mount effect: start if autoStart requested, and manage staleness timer
  useEffect(() => {
    if (autoStart) {
      requestLocationAccess();
    }

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
  }, [autoStart, requestLocationAccess, stalenessThresholdSeconds]);

  return {
    location,
    gpsStatus,
    errorMessage,
    errorCode,
    isStale,
    accuracy,
    lastFixTimestamp,
    browserPermissionState,
    isSecureContext: isSecure,
    oneShotGps,
    requestOneShotGps,
    requestLocationAccess,
    stopLocationAccess,
    refreshGps: requestLocationAccess,
  };
}
