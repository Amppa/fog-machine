import { Bbox } from "./CommonTypes";
import { Coordinate } from "./GpsImportTypes";
import { FogMap, Block } from "./FogMap";

export function crossesAntimeridian(lon1: number, lon2: number): boolean {
  return Math.abs(lon2 - lon1) > 180;
}

export function calculateBoundingBox(coordinates: Coordinate[]): Bbox | null {
  if (coordinates.length === 0) return null;
  const boundingBox = new Bbox(Infinity, Infinity, -Infinity, -Infinity);

  for (const coord of coordinates) {
    boundingBox.extend({ lng: coord.lng, lat: coord.lat });
  }

  return boundingBox;
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
