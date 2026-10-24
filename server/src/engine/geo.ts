import { PlayerLocation, PlayZone } from '../types/game.js';

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates the great-circle distance between two points using the Haversine formula.
 * @returns Distance in meters
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Evaluates whether a location is within the defined circular Play Zone.
 * Incorporates a 20m warning buffer approaching the boundary.
 */
export function checkPlayZoneBoundary(
  location: { latitude: number; longitude: number; accuracy?: number },
  zone: PlayZone
): {
  isInside: boolean;
  distanceFromCenter: number;
  distanceToBoundary: number;
  isApproachingBoundary: boolean;
} {
  const distanceFromCenter = calculateHaversineDistance(
    location.latitude,
    location.longitude,
    zone.centerLat,
    zone.centerLng
  );

  const distanceToBoundary = zone.radiusMeters - distanceFromCenter;
  const isInside = distanceToBoundary >= 0;
  // Approaching boundary if inside and within 20 meters of the edge
  const isApproachingBoundary = isInside && distanceToBoundary <= 20;

  return {
    isInside,
    distanceFromCenter,
    distanceToBoundary,
    isApproachingBoundary,
  };
}

/**
 * Validates a catch attempt by checking distance between chaser and runner,
 * taking reported GPS accuracy into account.
 */
export function validateCatchProximity(
  chaserLoc: PlayerLocation,
  runnerLoc: PlayerLocation,
  thresholdMeters: number = 25
): {
  isValid: boolean;
  rawDistance: number;
  effectiveDistance: number;
} {
  const rawDistance = calculateHaversineDistance(
    chaserLoc.latitude,
    chaserLoc.longitude,
    runnerLoc.latitude,
    runnerLoc.longitude
  );

  // Accounting for GPS uncertainty: effective distance is reduced by half of combined accuracy
  const uncertaintyAllowance = (chaserLoc.accuracy + runnerLoc.accuracy) / 2;
  const effectiveDistance = Math.max(0, rawDistance - uncertaintyAllowance);

  // Valid if either raw distance is under threshold or effective distance meets threshold
  const isValid = rawDistance <= thresholdMeters || effectiveDistance <= thresholdMeters;

  return {
    isValid,
    rawDistance,
    effectiveDistance,
  };
}

/**
 * Velocity sanity check: detects impossible GPS spoofing / teleportation.
 * Rejects movement faster than 40 km/h (~11.1 m/s) between recent readings.
 */
export function checkVelocitySanity(
  prevLoc: PlayerLocation,
  newLoc: PlayerLocation
): boolean {
  const timeDeltaSeconds = (newLoc.timestamp - prevLoc.timestamp) / 1000;
  if (timeDeltaSeconds <= 0) return true; // duplicate or simultaneous

  const distanceMeters = calculateHaversineDistance(
    prevLoc.latitude,
    prevLoc.longitude,
    newLoc.latitude,
    newLoc.longitude
  );

  const speedMps = distanceMeters / timeDeltaSeconds;
  const MAX_PERMISSIBLE_SPEED_MPS = 12; // ~43.2 km/h sprint/cycling upper bound
  return speedMps <= MAX_PERMISSIBLE_SPEED_MPS;
}
