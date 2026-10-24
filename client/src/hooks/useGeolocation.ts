'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { PlayerLocation, GpsPermissionStatus } from '../types/game';

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
    refreshGps: startWatching,
  };
}
