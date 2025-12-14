import { parseGPX, Point } from "@we-gold/gpxjs";
import { FogMap } from "./FogMap";
import { Bbox } from "./CommonTypes";
import { GpsImportResult } from "./GpsImportTypes";
import { crossesAntimeridian } from "./GpsImportUtils";

function addPointsToFogMap(fogMap: FogMap, points: Point[]): FogMap {
  if (!points || points.length < 2) {
    return fogMap;
  }

  let updatedMap = fogMap;

  for (let i = 0; i < points.length - 1; i++) {
    const pt1 = points[i];
    const pt2 = points[i + 1];

    if (crossesAntimeridian(pt1.longitude, pt2.longitude)) {
      continue;
    }

    updatedMap = updatedMap.addLine(pt1.longitude, pt1.latitude, pt2.longitude, pt2.latitude, true);
  }

  return updatedMap;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFirstCoordinate(gpx: any): [number, number] | null {
  for (const track of gpx.tracks) {
    if (track.points.length > 0) {
      const point = track.points[0];
      return [point.longitude, point.latitude];
    }
  }

  for (const route of gpx.routes) {
    if (route.points.length > 0) {
      const point = route.points[0];
      return [point.longitude, point.latitude];
    }
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function calculateBoundingBox(gpx: any): Bbox | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let hasPoints = false;

  for (const track of gpx.tracks) {
    for (const point of track.points) {
      minLng = Math.min(minLng, point.longitude);
      minLat = Math.min(minLat, point.latitude);
      maxLng = Math.max(maxLng, point.longitude);
      maxLat = Math.max(maxLat, point.latitude);
      hasPoints = true;
    }
  }

  for (const route of gpx.routes) {
    for (const point of route.points) {
      minLng = Math.min(minLng, point.longitude);
      minLat = Math.min(minLat, point.latitude);
      maxLng = Math.max(maxLng, point.longitude);
      maxLat = Math.max(maxLat, point.latitude);
      hasPoints = true;
    }
  }

  return hasPoints ? new Bbox(minLng, minLat, maxLng, maxLat) : null;
}

export function importGpxToFogMap(gpxData: string): GpsImportResult {
  try {
    const [gpx, error] = parseGPX(gpxData);

    if (error || !gpx) {
      throw error || new Error("Failed to parse GPX file");
    }

    let fogMap = FogMap.empty;

    for (const track of gpx.tracks) {
      fogMap = addPointsToFogMap(fogMap, track.points);
    }

    for (const route of gpx.routes) {
      fogMap = addPointsToFogMap(fogMap, route.points);
    }

    const firstCoordinate = getFirstCoordinate(gpx);
    const boundingBox = calculateBoundingBox(gpx);

    return { fogMap, firstCoordinate, boundingBox };
  } catch (error) {
    console.error("Error parsing GPX file:", error);
    throw new Error("Invalid GPX file format");
  }
}
