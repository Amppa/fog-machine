import { parseGPX, Point } from "@we-gold/gpxjs";
import { FogMap } from "./FogMap";
import { Bbox } from "./CommonTypes";

function crossesAntimeridian(lon1: number, lon2: number): boolean {
    return Math.abs(lon2 - lon1) > 180;
}

/**
 * Helper function to add a series of points to the FogMap as connected lines
 * @param fogMap Current FogMap instance
 * @param points Array of points to connect
 * @returns Updated FogMap with added lines
 */
function addPointsToFogMap(fogMap: FogMap, points: Point[]): FogMap {
    if (!points || points.length < 2) {
        return fogMap;
    }

    let updatedMap = fogMap;

    // Draw lines between consecutive points
    for (let i = 0; i < points.length - 1; i++) {
        const pt1 = points[i];
        const pt2 = points[i + 1];

        // Skip segments that cross the antimeridian to avoid drawing
        // lines across the entire globe
        if (crossesAntimeridian(pt1.longitude, pt2.longitude)) {
            continue;
        }

        updatedMap = updatedMap.addLine(
            pt1.longitude,
            pt1.latitude,
            pt2.longitude,
            pt2.latitude,
            true
        );
    }

    return updatedMap;
}

/**
 * Get the first coordinate from GPX data
 * @param gpx Parsed GPX object
 * @returns First [lng, lat] pair or null if no coordinates found
 */
function getFirstCoordinate(gpx: any): [number, number] | null {
    // Try to get first point from tracks
    for (const track of gpx.tracks) {
        if (track.points.length > 0) {
            const point = track.points[0];
            return [point.longitude, point.latitude];
        }
    }

    // If no tracks, try routes
    for (const route of gpx.routes) {
        if (route.points.length > 0) {
            const point = route.points[0];
            return [point.longitude, point.latitude];
        }
    }

    return null;
}

/**
 * Calculate bounding box from GPX data
 * @param gpx Parsed GPX object
 * @returns Bbox or null if no coordinates found
 */
function calculateBoundingBox(gpx: any): Bbox | null {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let hasPoints = false;

    // Process all tracks
    for (const track of gpx.tracks) {
        for (const point of track.points) {
            minLng = Math.min(minLng, point.longitude);
            minLat = Math.min(minLat, point.latitude);
            maxLng = Math.max(maxLng, point.longitude);
            maxLat = Math.max(maxLat, point.latitude);
            hasPoints = true;
        }
    }

    // Process all routes
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

/**
 * Import GPX file and convert track data to FogMap
 * @param gpxData GPX file content as string
 * @returns Object with FogMap, first coordinate, and bounding box
 */
export function importGpxToFogMap(gpxData: string): {
    fogMap: FogMap;
    firstCoordinate: [number, number] | null;
    boundingBox: Bbox | null;
} {
    try {
        // Parse GPX data - parseGPX returns [ParsedGPX | null, Error | null]
        const [gpx, error] = parseGPX(gpxData);

        if (error || !gpx) {
            throw error || new Error("Failed to parse GPX file");
        }

        let fogMap = FogMap.empty;

        // Process all tracks
        for (const track of gpx.tracks) {
            fogMap = addPointsToFogMap(fogMap, track.points);
        }

        // Process all routes
        for (const route of gpx.routes) {
            fogMap = addPointsToFogMap(fogMap, route.points);
        }

        // Get first coordinate for camera positioning
        const firstCoordinate = getFirstCoordinate(gpx);

        // Calculate bounding box for auto-zoom
        const boundingBox = calculateBoundingBox(gpx);

        return { fogMap, firstCoordinate, boundingBox };
    } catch (error) {
        console.error("Error parsing GPX file:", error);
        throw new Error("Invalid GPX file format");
    }
}
