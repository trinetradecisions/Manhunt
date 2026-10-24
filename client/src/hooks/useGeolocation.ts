'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { PlayerLocation, GpsPermissionStatus } from '../types/game';

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
  const [gpsStatus, setGpsStatus] = useState<GpsPermissionStatus>('PROMPT');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const lastUpdateRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);

  // Dedicated one-shot diagnostics state for navigator.geolocation.getCurrentPosition()
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

  const handleSuccess = useCallback(
    (pos: GeolocationPosition) => {
      const now = Date.now();
      lastUpdateRef.current = now;

      const playerLoc: PlayerLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: now,
      };

      setLocation(playerLoc);
      setGpsStatus('GRANTED');
      setErrorMessage(null);
      setIsStale(false);

      if (onLocationUpdate) {
        onLocationUpdate(playerLoc);
      }
    },
    [onLocationUpdate]
  );

  const handleError = useCallback((err: GeolocationPositionError) => {
    switch (err.code) {
      case err.PERMISSION_DENIED:
        setGpsStatus('DENIED');
        setErrorMessage('Location permission denied. Please enable GPS in browser settings.');
        break;
      case err.POSITION_UNAVAILABLE:
        setGpsStatus('UNAVAILABLE');
        setErrorMessage('GPS position unavailable. Ensure location services are turned on.');
        break;
      case err.TIMEOUT:
        setGpsStatus('UNAVAILABLE');
        setErrorMessage('Location request timed out. Checking GPS signal...');
        break;
      default:
        setErrorMessage(err.message);
    }
  }, []);

  // Explicit one-shot call to navigator.geolocation.getCurrentPosition()
  const requestOneShotGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
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
      return;
    }

    setOneShotGps((prev) => ({ ...prev, status: 'REQUESTING', errorMessage: null }));

    navigator.geolocation.getCurrentPosition(
      (pos: GeolocationPosition) => {
        setOneShotGps({
          status: 'SUCCESS',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp || Date.now(),
          errorCode: null,
          errorName: null,
          errorMessage: null,
        });

        // Also update active player location
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
          errorMessage: err.message,
        });

        handleError(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0, // Force fresh reading, never return stale cache
      }
    );
  }, [handleSuccess, handleError]);

  const startWatching = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('UNAVAILABLE');
      setErrorMessage('Geolocation is not supported by your browser.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );
  }, [handleSuccess, handleError]);

  useEffect(() => {
    startWatching();

    // Staleness checking interval
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
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      clearInterval(staleInterval);
    };
  }, [startWatching, stalenessThresholdSeconds]);

  return {
    location,
    gpsStatus,
    errorMessage,
    isStale,
    oneShotGps,
    requestOneShotGps,
    refreshGps: startWatching,
  };
}
