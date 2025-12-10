import { parseGPX, Point } from "@we-gold/gpxjs";
import { FogMap } from "./FogMap";

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
 * Import GPX file and convert track data to FogMap
 * @param gpxData GPX file content as string
 * @returns FogMap with imported tracks
 */
export function importGpxToFogMap(gpxData: string): FogMap {
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

        return fogMap;
    } catch (error) {
        console.error("Error parsing GPX file:", error);
        throw new Error("Invalid GPX file format");
    }
}
