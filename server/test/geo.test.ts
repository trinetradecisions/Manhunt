import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistance,
  checkPlayZoneBoundary,
  validateCatchProximity,
  checkVelocitySanity,
  validatePlayZone,
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

  it('correctly evaluates rectangular boundary containment', () => {
    const rectZone = {
      shapeType: 'RECTANGLE' as const,
      centerLat: 51.5050,
      centerLng: -0.1250,
      radiusMeters: 500,
      northEast: { lat: 51.5100, lng: -0.1200 },
      southWest: { lat: 51.5000, lng: -0.1300 },
    };

    const inside = checkPlayZoneBoundary({ latitude: 51.5050, longitude: -0.1250 }, rectZone);
    expect(inside.isInside).toBe(true);

    const outside = checkPlayZoneBoundary({ latitude: 51.5150, longitude: -0.1250 }, rectZone);
    expect(outside.isInside).toBe(false);
  });

  it('correctly evaluates custom polygon boundary containment', () => {
    // Triangle around central point
    const polyZone = {
      shapeType: 'POLYGON' as const,
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 500,
      vertices: [
        { lat: 51.5000, lng: -0.1300 },
        { lat: 51.5100, lng: -0.1200 },
        { lat: 51.5000, lng: -0.1100 },
      ],
    };

    // Center-top inside triangle
    const inside = checkPlayZoneBoundary({ latitude: 51.5030, longitude: -0.1200 }, polyZone);
    expect(inside.isInside).toBe(true);

    // Well outside triangle
    const outside = checkPlayZoneBoundary({ latitude: 51.5150, longitude: -0.1200 }, polyZone);
    expect(outside.isInside).toBe(false);
  });

  it('detects self-intersecting polygons and validates boundaries', () => {
    // Self-intersecting bow-tie shape
    const selfIntersecting = [
      { lat: 51.5000, lng: -0.1300 },
      { lat: 51.5100, lng: -0.1100 },
      { lat: 51.5000, lng: -0.1100 },
      { lat: 51.5100, lng: -0.1300 },
    ];
    const invalidResult = validatePlayZone({
      shapeType: 'POLYGON',
      centerLat: 51.5050,
      centerLng: -0.1200,
      radiusMeters: 500,
      vertices: selfIntersecting,
    });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.error).toContain('self-intersects');

    // Valid non-intersecting quadrilateral
    const validQuad = [
      { lat: 51.5000, lng: -0.1300 },
      { lat: 51.5100, lng: -0.1300 },
      { lat: 51.5100, lng: -0.1100 },
      { lat: 51.5000, lng: -0.1100 },
    ];
    const validResult = validatePlayZone({
      shapeType: 'POLYGON',
      centerLat: 51.5050,
      centerLng: -0.1200,
      radiusMeters: 500,
      vertices: validQuad,
    });
    expect(validResult.valid).toBe(true);
    expect(validResult.areaSquareMeters).toBeGreaterThan(500);
  });

  it('rejects areas that are too small or excessively large', () => {
    // Tiny circle radius 11m (area ~380m² < 500m²)
    const tiny = validatePlayZone({
      shapeType: 'CIRCLE',
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 11,
    });
    expect(tiny.valid).toBe(false);
    expect(tiny.error).toContain('too small');

    // Giant circle radius 4000m (area ~50km² > 25km²)
    const giant = validatePlayZone({
      shapeType: 'CIRCLE',
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 3500,
    });
    expect(giant.valid).toBe(false);
    expect(giant.error).toContain('excessively large');
  });
});
