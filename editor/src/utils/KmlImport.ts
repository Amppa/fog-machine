import JSZip from "jszip";
import { FogMap } from "./FogMap";
import { Bbox } from "./CommonTypes";
import { GpsImportResult } from "./GpsImportTypes";
import { crossesAntimeridian } from "./GpsImportUtils";

function extractKmlCoordinates(kmlDoc: Document): number[][][] {
  const coordinateSets: number[][][] = [];

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

  const gxTracks = kmlDoc.getElementsByTagNameNS("http://www.google.com/kml/ext/2.2", "Track");
  for (let i = 0; i < gxTracks.length; i++) {
    const coords = extractGxTrackCoordinates(gxTracks[i]);
    if (coords.length > 0) {
      coordinateSets.push(coords);
    }
  }

  return coordinateSets;
}

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

function extractGxTrackCoordinates(trackElement: Element): number[][] {
  const coords: number[][] = [];
  const coordElements = trackElement.getElementsByTagNameNS("http://www.google.com/kml/ext/2.2", "coord");

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

function coordinatesToFogMap(coordinateSets: number[][][]): FogMap {
  let fogMap = FogMap.empty;

  for (const coords of coordinateSets) {
    if (coords.length > 1) {
      for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];

        if (crossesAntimeridian(lng1, lng2)) {
          continue;
        }

        fogMap = fogMap.addLine(lng1, lat1, lng2, lat2, true);
      }
    }
  }

  return fogMap;
}

export function importKmlToFogMap(kmlData: string): GpsImportResult {
  try {
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(kmlData, "text/xml");

    const parserError = kmlDoc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
      throw new Error("Failed to parse KML XML");
    }

    const coordinateSets = extractKmlCoordinates(kmlDoc);

    if (coordinateSets.length === 0) {
      throw new Error("No track data found in KML file");
    }

    const firstCoordinate = getFirstCoordinate(coordinateSets);
    const boundingBox = calculateBoundingBox(coordinateSets);

    const fogMap = coordinatesToFogMap(coordinateSets);

    return { fogMap, firstCoordinate, boundingBox };
  } catch (error) {
    console.error("Error parsing KML file:", error);
    throw new Error("Invalid KML file format");
  }
}

export async function importKmzToFogMap(kmzData: ArrayBuffer): Promise<GpsImportResult> {
  try {
    const zip = await new JSZip().loadAsync(kmzData);

    let kmlFile: JSZip.JSZipObject | null = null;

    kmlFile = zip.file("doc.kml");

    if (!kmlFile) {
      const kmlFiles = zip.file(/\.kml$/i);
      if (kmlFiles.length > 0) {
        kmlFile = kmlFiles[0];
      }
    }

    if (!kmlFile) {
      throw new Error("No KML file found in KMZ archive");
    }

    const kmlData = await kmlFile.async("string");
    return importKmlToFogMap(kmlData);
  } catch (error) {
    console.error("Error parsing KMZ file:", error);
    throw new Error("Invalid KMZ file format");
  }
}
