import { Bbox } from "./CommonTypes";
import { Coordinate } from "./GpsImportTypes";
import { FogMap, Block } from "./FogMap";

export function crossesAntimeridian(lon1: number, lon2: number): boolean {
  return Math.abs(lon2 - lon1) > 180;
}

export function calculateBoundingBoxFromCoordinates(coordinates: Coordinate[]): Bbox | null {
  if (coordinates.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const coord of coordinates) {
    minLng = Math.min(minLng, coord.lng);
    minLat = Math.min(minLat, coord.lat);
    maxLng = Math.max(maxLng, coord.lng);
    maxLat = Math.max(maxLat, coord.lat);
  }

  return new Bbox(minLng, minLat, maxLng, maxLat);
}

export function arrayBufferToString(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(buffer);
}

/**
 * Merge two FogMaps using FogMap's updateBlocks method
 */
export function mergeFogMaps(base: FogMap, toMerge: FogMap): FogMap {
  const newBlocks: {
    [tileKey: string]: { [blockKey: string]: Block | null };
  } = {};

  Object.entries(toMerge.tiles).forEach(([tileKey, tile]) => {
    newBlocks[tileKey] = { ...tile.blocks };
  });

  return base.updateBlocks(newBlocks);
}
