import { MapPoint, PlayZone } from '../types/game';

const EARTH_RADIUS_METERS = 6371000;

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

export function calculatePolygonPerimeterMeters(vertices: MapPoint[]): number {
  if (!vertices || vertices.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    perimeter += calculateHaversineDistance(
      vertices[i].lat,
      vertices[i].lng,
      vertices[j].lat,
      vertices[j].lng
    );
  }
  return perimeter;
}

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

/**
 * Ramer-Douglas-Peucker line simplification for freehand drawing
 */
export function simplifyPoints(points: MapPoint[], tolerance: number = 0.0001): MapPoint[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    // Perpendicular distance from p to line segment start-end
    const d = perpendicularDistance(p, start, end);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPoints(points.slice(0, index + 1), tolerance);
    const right = simplifyPoints(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

function perpendicularDistance(p: MapPoint, lineStart: MapPoint, lineEnd: MapPoint): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) {
    return Math.sqrt(Math.pow(p.lng - lineStart.lng, 2) + Math.pow(p.lat - lineStart.lat, 2));
  }
  const u = ((p.lng - lineStart.lng) * dx + (p.lat - lineStart.lat) * dy) / (mag * mag);
  const clampedU = Math.max(0, Math.min(1, u));
  const projX = lineStart.lng + clampedU * dx;
  const projY = lineStart.lat + clampedU * dy;
  return Math.sqrt(Math.pow(p.lng - projX, 2) + Math.pow(p.lat - projY, 2));
}

export function formatArea(areaSqm: number): string {
  if (areaSqm >= 1000000) {
    return `${(areaSqm / 1000000).toFixed(2)} km²`;
  }
  if (areaSqm >= 10000) {
    return `${(areaSqm / 10000).toFixed(2)} ha (${Math.round(areaSqm).toLocaleString()} m²)`;
  }
  return `${Math.round(areaSqm).toLocaleString()} m²`;
}
