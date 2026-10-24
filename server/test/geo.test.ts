import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistance,
  checkPlayZoneBoundary,
  validateCatchProximity,
  checkVelocitySanity,
} from '../src/engine/geo.js';

describe('Geospatial Engine', () => {
  it('accurately calculates Haversine distance between two known points', () => {
    // Distance between London Eye (51.5033, -0.1195) and Big Ben (51.5007, -0.1246) is ~460-470 meters
    const dist = calculateHaversineDistance(51.5033, -0.1195, 51.5007, -0.1246);
    expect(dist).toBeGreaterThan(450);
    expect(dist).toBeLessThan(480);
  });

  it('detects boundary containment and approaching warnings', () => {
    const zone = {
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 500,
    };

    // Exactly at center
    const atCenter = checkPlayZoneBoundary({ latitude: 51.5000, longitude: -0.1200 }, zone);
    expect(atCenter.isInside).toBe(true);
    expect(atCenter.isApproachingBoundary).toBe(false);

    // Far outside (10km away)
    const farAway = checkPlayZoneBoundary({ latitude: 51.6000, longitude: -0.1200 }, zone);
    expect(farAway.isInside).toBe(false);
  });

  it('validates catch proximity with GPS uncertainty buffer', () => {
    const chaserLoc = {
      latitude: 51.5000,
      longitude: -0.1200,
      accuracy: 10,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    // Runner 20 meters away
    const runnerClose = {
      latitude: 51.50015,
      longitude: -0.1200,
      accuracy: 10,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    const resClose = validateCatchProximity(chaserLoc, runnerClose, 25);
    expect(resClose.isValid).toBe(true);

    // Runner 200 meters away
    const runnerFar = {
      latitude: 51.5020,
      longitude: -0.1200,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    const resFar = validateCatchProximity(chaserLoc, runnerFar, 25);
    expect(resFar.isValid).toBe(false);
  });

  it('rejects impossible teleportation / spoofing speed', () => {
    const loc1 = {
      latitude: 51.5000,
      longitude: -0.1200,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: 1000000,
    };

    // 5km away in 2 seconds (~9000 km/h)
    const locTeleport = {
      latitude: 51.5500,
      longitude: -0.1200,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: 1002000,
    };

    expect(checkVelocitySanity(loc1, locTeleport)).toBe(false);
  });
});
