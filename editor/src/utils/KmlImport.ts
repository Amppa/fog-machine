import JSZip from "jszip";
import { FogMap } from "./FogMap";
import { Bbox } from "./CommonTypes";

/**
 * Parse KML XML and extract coordinates from LineString elements
 * @param kmlDoc Parsed KML document
 * @returns Array of coordinate arrays [lng, lat][]
 */
function extractKmlCoordinates(kmlDoc: Document): number[][][] {
    const coordinateSets: number[][][] = [];

    // Extract from LineString elements (standard KML tracks)
    const lineStrings = kmlDoc.getElementsByTagName("LineString");
    for (let i = 0; i < lineStrings.length; i++) {
        const coordsElement = lineStrings[i].getElementsByTagName("coordinates")[0];
        if (coordsElement) {
            const coordsText = coordsElement.textContent?.trim();
            if (coordsText) {
                const coords = parseKmlCoordinates(coordsText);
                if (coords.length > 0) {
                    coordinateSets.push(coords);
                }
            }
        }
    }

    // Extract from gx:Track elements (Google Earth extended format)
    const gxTracks = kmlDoc.getElementsByTagNameNS("http://www.google.com/kml/ext/2.2", "Track");
    for (let i = 0; i < gxTracks.length; i++) {
        const coords = extractGxTrackCoordinates(gxTracks[i]);
        if (coords.length > 0) {
            coordinateSets.push(coords);
        }
    }

    return coordinateSets;
}

/**
 * Parse KML coordinate string format: "lng,lat,alt lng,lat,alt ..."
 * @param coordsText Coordinate text from KML
 * @returns Array of [lng, lat] pairs
 */
function parseKmlCoordinates(coordsText: string): number[][] {
    const coords: number[][] = [];
    const points = coordsText.trim().split(/\s+/);

    for (const point of points) {
        const parts = point.split(",");
        if (parts.length >= 2) {
            const lng = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lng) && !isNaN(lat)) {
                coords.push([lng, lat]);
            }
        }
    }

    return coords;
}

/**
 * Extract coordinates from Google Earth gx:Track element
 * @param trackElement gx:Track element
 * @returns Array of [lng, lat] pairs
 */
function extractGxTrackCoordinates(trackElement: Element): number[][] {
    const coords: number[][] = [];
    const coordElements = trackElement.getElementsByTagNameNS(
        "http://www.google.com/kml/ext/2.2",
        "coord"
    );

    for (let i = 0; i < coordElements.length; i++) {
        const coordText = coordElements[i].textContent?.trim();
        if (coordText) {
            const parts = coordText.split(/\s+/);
            if (parts.length >= 2) {
                const lng = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (!isNaN(lng) && !isNaN(lat)) {
                    coords.push([lng, lat]);
                }
            }
        }
    }

    return coords;
}

function crossesAntimeridian(lon1: number, lon2: number): boolean {
    return Math.abs(lon2 - lon1) > 180;
}

/**
 * Get the first coordinate from coordinate sets
 * @param coordinateSets Array of coordinate arrays
 * @returns First [lng, lat] pair or null if no coordinates found
 */
function getFirstCoordinate(coordinateSets: number[][][]): [number, number] | null {
    if (coordinateSets.length === 0) return null;

    for (const coords of coordinateSets) {
        if (coords.length > 0) {
            const [lng, lat] = coords[0];
            return [lng, lat];
        }
    }

    return null;
}

/**
 * Calculate bounding box from coordinate sets
 * @param coordinateSets Array of coordinate arrays
 * @returns Bbox or null if no coordinates found
 */
function calculateBoundingBox(coordinateSets: number[][][]): Bbox | null {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let hasPoints = false;

    for (const coords of coordinateSets) {
        for (const [lng, lat] of coords) {
            minLng = Math.min(minLng, lng);
            minLat = Math.min(minLat, lat);
            maxLng = Math.max(maxLng, lng);
            maxLat = Math.max(maxLat, lat);
            hasPoints = true;
        }
    }

    return hasPoints ? new Bbox(minLng, minLat, maxLng, maxLat) : null;
}

/**
 * Convert coordinate sets to FogMap by drawing lines
 * @param coordinateSets Array of coordinate arrays
 * @returns FogMap with drawn tracks
 */
function coordinatesToFogMap(coordinateSets: number[][][]): FogMap {
    let fogMap = FogMap.empty;

    for (const coords of coordinateSets) {
        if (coords.length > 1) {
            // Draw lines between consecutive points
            for (let i = 0; i < coords.length - 1; i++) {
                const [lng1, lat1] = coords[i];
                const [lng2, lat2] = coords[i + 1];

                // Skip segments that cross the antimeridian to avoid drawing
                // lines across the entire globe
                if (crossesAntimeridian(lng1, lng2)) {
                    continue;
                }

                fogMap = fogMap.addLine(lng1, lat1, lng2, lat2, true);
            }
        }
    }

    return fogMap;
}

/**
 * Import KML file and convert track data to FogMap
 * @param kmlData KML file content as string
 * @returns Object with FogMap, first coordinate, and bounding box
 */
export function importKmlToFogMap(kmlData: string): {
    fogMap: FogMap;
    firstCoordinate: [number, number] | null;
    boundingBox: Bbox | null;
} {
    try {
        // Parse KML XML
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlData, "text/xml");

        // Check for parsing errors
        const parserError = kmlDoc.getElementsByTagName("parsererror");
        if (parserError.length > 0) {
            throw new Error("Failed to parse KML XML");
        }

        // Extract coordinates
        const coordinateSets = extractKmlCoordinates(kmlDoc);

        if (coordinateSets.length === 0) {
            throw new Error("No track data found in KML file");
        }

        // Get first coordinate for camera positioning
        const firstCoordinate = getFirstCoordinate(coordinateSets);

        // Calculate bounding box for auto-zoom
        const boundingBox = calculateBoundingBox(coordinateSets);

        // Convert to FogMap
        const fogMap = coordinatesToFogMap(coordinateSets);

        return { fogMap, firstCoordinate, boundingBox };
    } catch (error) {
        console.error("Error parsing KML file:", error);
        throw new Error("Invalid KML file format");
    }
}

/**
 * Import KMZ file (compressed KML) and convert track data to FogMap
 * @param kmzData KMZ file content as ArrayBuffer
 * @returns Promise with FogMap, first coordinate, and bounding box
 */
export async function importKmzToFogMap(kmzData: ArrayBuffer): Promise<{
    fogMap: FogMap;
    firstCoordinate: [number, number] | null;
    boundingBox: Bbox | null;
}> {
    try {
        // Unzip KMZ file
        const zip = await new JSZip().loadAsync(kmzData);

        // Find KML file in the archive (usually doc.kml or *.kml)
        let kmlFile: JSZip.JSZipObject | null = null;

        // First try to find doc.kml (standard name)
        kmlFile = zip.file("doc.kml");

        // If not found, look for any .kml file
        if (!kmlFile) {
            const kmlFiles = zip.file(/\.kml$/i);
            if (kmlFiles.length > 0) {
                kmlFile = kmlFiles[0];
            }
        }

        if (!kmlFile) {
            throw new Error("No KML file found in KMZ archive");
        }

        // Extract KML content
        const kmlData = await kmlFile.async("string");

        // Parse KML and convert to FogMap
        return importKmlToFogMap(kmlData);
    } catch (error) {
        console.error("Error parsing KMZ file:", error);
        throw new Error("Invalid KMZ file format");
    }
}
