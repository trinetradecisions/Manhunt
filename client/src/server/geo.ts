import { PlayerLocation, PlayZone, MapPoint, PlayBoundaryShape } from '../types/game';

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
 * Projects a point P onto segment AB and calculates minimum distance in meters.
 */
export function distanceToSegmentMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const cosLat = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const degToMetersLat = 111320;
  const degToMetersLng = 111320 * cosLat;

  const px = (pLng - aLng) * degToMetersLng;
  const py = (pLat - aLat) * degToMetersLat;
  const bx = (bLng - aLng) * degToMetersLng;
  const by = (bLat - aLat) * degToMetersLat;

  const bLenSq = bx * bx + by * by;
  if (bLenSq === 0) {
    return Math.sqrt(px * px + py * py);
  }

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / bLenSq));
  const projX = t * bx;
  const projY = t * by;

  const dx = px - projX;
  const dy = py - projY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Evaluates whether a point is inside a polygon using ray-casting.
 */
export function isPointInPolygon(
  point: { latitude: number; longitude: number },
  vertices: MapPoint[]
): boolean {
  if (!vertices || vertices.length < 3) return false;
  let inside = false;
  const { latitude: py, longitude: px } = point;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng;
    const yi = vertices[i].lat;
    const xj = vertices[j].lng;
    const yj = vertices[j].lat;

    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Evaluates whether a point is within a rectangular bounding box.
 */
export function isPointInRectangle(
  point: { latitude: number; longitude: number },
  northEast: MapPoint,
  southWest: MapPoint
): boolean {
  const minLat = Math.min(southWest.lat, northEast.lat);
  const maxLat = Math.max(southWest.lat, northEast.lat);
  const minLng = Math.min(southWest.lng, northEast.lng);
  const maxLng = Math.max(southWest.lng, northEast.lng);

  return (
    point.latitude >= minLat &&
    point.latitude <= maxLat &&
    point.longitude >= minLng &&
    point.longitude <= maxLng
  );
}

/**
 * Calculates distance from point to the nearest polygon boundary edge in meters.
 */
export function distanceToPolygonBoundary(
  point: { latitude: number; longitude: number },
  vertices: MapPoint[]
): number {
  if (!vertices || vertices.length < 2) return 0;
  let minDistance = Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const dist = distanceToSegmentMeters(
      point.latitude,
      point.longitude,
      vertices[i].lat,
      vertices[i].lng,
      vertices[j].lat,
      vertices[j].lng
    );
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance === Infinity ? 0 : minDistance;
}

/**
 * Calculates distance from point to the nearest rectangle boundary edge in meters.
 */
export function distanceToRectangleBoundary(
  point: { latitude: number; longitude: number },
  northEast: MapPoint,
  southWest: MapPoint
): number {
  const minLat = Math.min(southWest.lat, northEast.lat);
  const maxLat = Math.max(southWest.lat, northEast.lat);
  const minLng = Math.min(southWest.lng, northEast.lng);
  const maxLng = Math.max(southWest.lng, northEast.lng);

  const rectVertices: MapPoint[] = [
    { lat: minLat, lng: minLng },
    { lat: maxLat, lng: minLng },
    { lat: maxLat, lng: maxLng },
    { lat: minLat, lng: maxLng },
  ];

  return distanceToPolygonBoundary(point, rectVertices);
}

/**
 * Calculates approximate area of a polygon in square meters.
 */
export function calculatePolygonAreaMeters(vertices: MapPoint[]): number {
  if (!vertices || vertices.length < 3) return 0;

  let sumLat = 0;
  let sumLng = 0;
  for (const v of vertices) {
    sumLat += v.lat;
    sumLng += v.lng;
  }
  const centerLat = sumLat / vertices.length;
  const centerLng = sumLng / vertices.length;

  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const degToMetersLat = 111320;
  const degToMetersLng = 111320 * cosLat;

  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const xi = (vertices[i].lng - centerLng) * degToMetersLng;
    const yi = (vertices[i].lat - centerLat) * degToMetersLat;
    const xj = (vertices[j].lng - centerLng) * degToMetersLng;
    const yj = (vertices[j].lat - centerLat) * degToMetersLat;

    area += xi * yj - xj * yi;
  }

  return Math.abs(area) / 2;
}

/**
 * Calculates area of a rectangle in square meters.
 */
export function calculateRectangleAreaMeters(
  northEast: MapPoint,
  southWest: MapPoint
): number {
  const minLat = Math.min(southWest.lat, northEast.lat);
  const maxLat = Math.max(southWest.lat, northEast.lat);
  const minLng = Math.min(southWest.lng, northEast.lng);
  const maxLng = Math.max(southWest.lng, northEast.lng);

  const heightMeters = calculateHaversineDistance(minLat, minLng, maxLat, minLng);
  const widthMeters = calculateHaversineDistance(minLat, minLng, minLat, maxLng);
  return heightMeters * widthMeters;
}

function doSegmentsIntersect(
  a1: MapPoint,
  a2: MapPoint,
  b1: MapPoint,
  b2: MapPoint
): boolean {
  const ccw = (p1: MapPoint, p2: MapPoint, p3: MapPoint) => {
    return (p3.lat - p1.lat) * (p2.lng - p1.lng) > (p2.lat - p1.lat) * (p3.lng - p1.lng);
  };

  return (
    ccw(a1, b1, b2) !== ccw(a2, b1, b2) &&
    ccw(a1, a2, b1) !== ccw(a1, a2, b2)
  );
}

export function checkPolygonSelfIntersection(vertices: MapPoint[]): boolean {
  if (!vertices || vertices.length < 4) return false;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];

    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;

      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];

      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

export function validatePlayZone(zone: PlayZone): {
  valid: boolean;
  error?: string;
  warning?: string;
  areaSquareMeters?: number;
} {
  if (!zone) return { valid: false, error: 'Play zone is required' };

  if (
    typeof zone.centerLat !== 'number' ||
    typeof zone.centerLng !== 'number' ||
    isNaN(zone.centerLat) ||
    isNaN(zone.centerLng) ||
    zone.centerLat < -90 ||
    zone.centerLat > 90 ||
    zone.centerLng < -180 ||
    zone.centerLng > 180
  ) {
    return { valid: false, error: 'Invalid center coordinates' };
  }

  const shape = zone.shapeType || 'CIRCLE';
  let area = 0;

  if (shape === 'CIRCLE') {
    if (typeof zone.radiusMeters !== 'number' || zone.radiusMeters < 10) {
      return { valid: false, error: 'Circle radius must be at least 10 meters' };
    }
    if (zone.radiusMeters > 5000) {
      return { valid: false, error: 'Circle radius cannot exceed 5000 meters' };
    }
    area = Math.PI * zone.radiusMeters * zone.radiusMeters;
  } else if (shape === 'RECTANGLE') {
    if (!zone.northEast || !zone.southWest) {
      return { valid: false, error: 'Rectangle requires northEast and southWest coordinates' };
    }
    const { northEast: ne, southWest: sw } = zone;
    if (
      ne.lat <= sw.lat ||
      ne.lng === sw.lng ||
      ne.lat < -90 ||
      ne.lat > 90 ||
      sw.lat < -90 ||
      sw.lat > 90
    ) {
      return { valid: false, error: 'Invalid rectangle coordinates or inverted bounds' };
    }
    area = calculateRectangleAreaMeters(ne, sw);
  } else if (shape === 'POLYGON') {
    if (!zone.vertices || zone.vertices.length < 3) {
      return { valid: false, error: 'Polygon must have at least 3 vertices' };
    }
    if (zone.vertices.length > 50) {
      return { valid: false, error: 'Polygon cannot have more than 50 vertices' };
    }
    for (const v of zone.vertices) {
      if (
        typeof v.lat !== 'number' ||
        typeof v.lng !== 'number' ||
        isNaN(v.lat) ||
        isNaN(v.lng) ||
        v.lat < -90 ||
        v.lat > 90 ||
        v.lng < -180 ||
        v.lng > 180
      ) {
        return { valid: false, error: 'Polygon contains invalid coordinates' };
      }
    }
    if (checkPolygonSelfIntersection(zone.vertices)) {
      return { valid: false, error: 'Polygon self-intersects. Boundary lines cannot cross each other.' };
    }
    area = calculatePolygonAreaMeters(zone.vertices);
  } else {
    return { valid: false, error: `Unsupported shape type: ${shape}` };
  }

  const MIN_AREA_SQM = 500;
  const MAX_AREA_SQM = 25000000;

  if (area < MIN_AREA_SQM) {
    return {
      valid: false,
      error: `Selected play area is too small (${Math.round(area)} m²). Minimum playable area is ${MIN_AREA_SQM} m².`,
      areaSquareMeters: area,
    };
  }

  if (area > MAX_AREA_SQM) {
    return {
      valid: false,
      error: `Selected play area is excessively large (${(area / 1000000).toFixed(2)} km²). Maximum permitted area is 25 km².`,
      areaSquareMeters: area,
    };
  }

  let warning: string | undefined;
  if (area > 5000000) {
    warning = `Warning: Play area is quite large (${(area / 1000000).toFixed(1)} km²). Operatives may struggle to track runners on foot.`;
  }

  return { valid: true, warning, areaSquareMeters: area };
}

export function checkPlayZoneBoundary(
  location: { latitude: number; longitude: number; accuracy?: number },
  zone: PlayZone
): {
  isInside: boolean;
  distanceFromCenter: number;
  distanceToBoundary: number;
  isApproachingBoundary: boolean;
} {
  const shape = zone.shapeType || 'CIRCLE';
  const distanceFromCenter = calculateHaversineDistance(
    location.latitude,
    location.longitude,
    zone.centerLat,
    zone.centerLng
  );

  let isInside = false;
  let distanceToBoundary = 0;

  if (shape === 'RECTANGLE' && zone.northEast && zone.southWest) {
    isInside = isPointInRectangle(location, zone.northEast, zone.southWest);
    distanceToBoundary = distanceToRectangleBoundary(
      location,
      zone.northEast,
      zone.southWest
    );
  } else if (shape === 'POLYGON' && zone.vertices && zone.vertices.length >= 3) {
    isInside = isPointInPolygon(location, zone.vertices);
    distanceToBoundary = distanceToPolygonBoundary(location, zone.vertices);
  } else {
    const distToEdge = zone.radiusMeters - distanceFromCenter;
    isInside = distToEdge >= 0;
    distanceToBoundary = Math.abs(distToEdge);
  }

  const isApproachingBoundary = isInside && distanceToBoundary <= 20;

  return {
    isInside,
    distanceFromCenter,
    distanceToBoundary,
    isApproachingBoundary,
  };
}

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

  const uncertaintyAllowance = (chaserLoc.accuracy + runnerLoc.accuracy) / 2;
  const effectiveDistance = Math.max(0, rawDistance - uncertaintyAllowance);
  const isValid = rawDistance <= thresholdMeters || effectiveDistance <= thresholdMeters;

  return {
    isValid,
    rawDistance,
    effectiveDistance,
  };
}

export function checkVelocitySanity(
  prevLoc: PlayerLocation,
  newLoc: PlayerLocation
): boolean {
  const timeDeltaSeconds = (newLoc.timestamp - prevLoc.timestamp) / 1000;
  if (timeDeltaSeconds <= 0) return true;

  const distanceMeters = calculateHaversineDistance(
    prevLoc.latitude,
    prevLoc.longitude,
    newLoc.latitude,
    newLoc.longitude
  );

  const speedMps = distanceMeters / timeDeltaSeconds;
  const MAX_PERMISSIBLE_SPEED_MPS = 12;
  return speedMps <= MAX_PERMISSIBLE_SPEED_MPS;
}

export function generateRandomPointInZone(
  zone: PlayZone,
  marginMeters: number = 25
): MapPoint {
  const centerLat = zone.centerLat;
  const centerLng = zone.centerLng;
  const maxR = Math.max(30, (zone.radiusMeters || 500) - marginMeters);

  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(Math.random()) * maxR;

    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const dLat = (r * Math.cos(angle)) / 111320;
    const dLng = (r * Math.sin(angle)) / (111320 * (cosLat || 1));

    const candidate: MapPoint = {
      lat: centerLat + dLat,
      lng: centerLng + dLng,
    };

    const boundary = checkPlayZoneBoundary(
      {
        latitude: candidate.lat,
        longitude: candidate.lng,
        accuracy: 5,
      },
      zone
    );

    if (boundary.isInside) {
      return candidate;
    }
  }

  return { lat: centerLat, lng: centerLng };
}

