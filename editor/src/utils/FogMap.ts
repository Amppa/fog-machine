import pako from "pako";
import JSZip from "jszip";
import { Md5 } from "ts-md5";
import { Bbox } from "./CommonTypes";

const DEBUG = false;

const FILENAME_MASK1 = "olhwjsktri";
const FILENAME_MASK2 = "eizxdwknmo";
const FILENAME_ENCODING: { [key: string]: number } = {};
for (let i = 0; i < FILENAME_MASK1.length; i++) {
  FILENAME_ENCODING[FILENAME_MASK1.charAt(i)] = i;
}
const MAP_WIDTH = 512;
export const TILE_WIDTH_OFFSET = 7;
export const TILE_WIDTH = 1 << TILE_WIDTH_OFFSET;
const TILE_HEADER_LEN = TILE_WIDTH ** 2;
const TILE_HEADER_SIZE = TILE_HEADER_LEN * 2;
const BLOCK_BITMAP_SIZE = 512;
const BLOCK_EXTRA_DATA = 3;
const BLOCK_SIZE = BLOCK_BITMAP_SIZE + BLOCK_EXTRA_DATA;
export const BITMAP_WIDTH_OFFSET = 6;
export const BITMAP_WIDTH = 1 << BITMAP_WIDTH_OFFSET;
const ALL_OFFSET = TILE_WIDTH_OFFSET + BITMAP_WIDTH_OFFSET;

// TODO: figure out a better way to imeplement immutable data structure
//       we encountered performance issue when using `immutable.js`

// SAD: Type Aliases do not seem to give us type safety
export type TileID = number;
export type XYKey = string;

export class FogMap {
  readonly tiles: { [key: XYKey]: Tile };
  readonly dirtyTiles: Set<XYKey>;
  static empty = new FogMap({}, new Set());

  private constructor(tiles: { [key: XYKey]: Tile }, dirtyTiles: Set<XYKey> = new Set()) {
    Object.freeze(tiles);
    this.tiles = tiles;
    this.dirtyTiles = dirtyTiles;
  }

  // It is so silly that tuple cannot be used as key
  static makeKeyXY(x: number, y: number): XYKey {
    return `${x}-${y}`;
  }

  static createFromFiles(files: [string, ArrayBuffer][]): FogMap {
    if (files.length === 0) {
      return FogMap.empty;
    }
    const mutableTiles = { ...FogMap.empty.tiles };
    files.forEach(([filename, data]) => {
      try {
        const tile = Tile.create(filename, data);
        // just in case the imported data doesn't hold this invariant
        if (Object.entries(tile.blocks).length !== 0) {
          mutableTiles[FogMap.makeKeyXY(tile.x, tile.y)] = tile;
        }
      } catch (e) {
        // TODO: handle error properly
        console.error(`${filename} is not a valid tile file.`);
        console.error(e);
      }
    });
    // Imported tiles are not dirty
    return new FogMap(mutableTiles, new Set());
  }

  updateBlocks(newBlocks: {
    [tileKey: string]: { [blockKey: string]: Block | null };
  }): FogMap {
    const mutableTiles = { ...this.tiles };
    const mutableDirtyTiles = new Set(this.dirtyTiles);
    let changed = false;

    Object.entries(newBlocks).forEach(([tileKey, blocks]) => {
      let tile = this.tiles[tileKey];
      if (!tile) {
        // If tile doesn't exist, we only care if we are ADDING blocks.
        // If we are deleting (null), we can ignore validly.
        // Check if any block is not null
        const hasNewBlocks = Object.values(blocks).some((b) => b !== null);
        if (!hasNewBlocks) return;

        const [tx, ty] = tileKey.split("-").map(Number);
        tile = Tile.createEmptyTile(tx, ty);
      }

      // Merge new blocks into tile
      const mutableBlocks = { ...tile.blocks };
      let tileChanged = false;

      Object.entries(blocks).forEach(([blockKey, block]) => {
        if (block === null) {
          if (mutableBlocks[blockKey]) {
            delete mutableBlocks[blockKey];
            tileChanged = true;
          }
        } else {
          mutableBlocks[blockKey] = block;
          tileChanged = true;
        }
      });

      if (tileChanged) {
        // Keep empty tiles instead of deleting them
        const newTile = new Tile(
          tile.filename,
          tile.id,
          tile.x,
          tile.y,
          mutableBlocks
        );
        mutableTiles[tileKey] = newTile;
        mutableDirtyTiles.add(tileKey);
        changed = true;
      }
    });

    if (changed) {
      return new FogMap(mutableTiles, mutableDirtyTiles);
    }
    return this;
  }

  async exportArchive(
    onProgress?: (current: number, total: number) => void
  ): Promise<Blob | null> {
    const zip = new JSZip();
    const syncZip = zip.folder("Sync");
    if (!syncZip) {
      // TODO: handle error
      console.error("unable to create archive");
      return null;
    }

    const tiles = Object.values(this.tiles);
    const totalTiles = tiles.length;
    let processedTiles = 0;

    for (let i = 0; i < totalTiles; i++) {
      const tile = tiles[i];
      // just in case
      if (Object.entries(tile.blocks).length !== 0) {
        syncZip.file("Sync/" + tile.filename, tile.dump());
      }
      processedTiles++;

      // Yield every 50 tiles to let UI update
      if (i % 50 === 0) {
        if (onProgress) {
          onProgress(processedTiles, totalTiles);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Final progress update
    if (onProgress) {
      onProgress(totalTiles, totalTiles);
    }

    return syncZip.generateAsync({ type: "blob" });
  }

  async exportDirtyArchive(
    onProgress?: (current: number, total: number) => void
  ): Promise<Blob | null> {
    const zip = new JSZip();
    const syncZip = zip.folder("Sync");
    if (!syncZip) {
      console.error("unable to create archive");
      return null;
    }

    const dirtyTileKeys = Array.from(this.dirtyTiles);
    const totalTiles = dirtyTileKeys.length;
    let processedTiles = 0;

    for (let i = 0; i < totalTiles; i++) {
      const tileKey = dirtyTileKeys[i];
      const tile = this.tiles[tileKey];
      if (tile) {
        // Export dirty tiles even if they are empty
        syncZip.file("Sync/" + tile.filename, tile.dump());
      }
      processedTiles++;

      // Yield every 50 tiles to let UI update
      if (i % 50 === 0) {
        if (onProgress) {
          onProgress(processedTiles, totalTiles);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Final progress update
    if (onProgress) {
      onProgress(totalTiles, totalTiles);
    }

    return syncZip.generateAsync({ type: "blob" });
  }

  clearDirtyTiles(): FogMap {
    return new FogMap(this.tiles, new Set());
  }

  getDirtyTilesCount(): number {
    return this.dirtyTiles.size;
  }


  static LngLatToGlobalXY(lng: number, lat: number): number[] {
    const x = ((lng + 180) / 360) * 512;
    const y =
      ((Math.PI - Math.asinh(Math.tan((lat / 180) * Math.PI))) * 512) /
      (2 * Math.PI);
    const xg = Math.floor(x * TILE_WIDTH * BITMAP_WIDTH);
    const yg = Math.floor(y * TILE_WIDTH * BITMAP_WIDTH);
    return [xg, yg];
  }

  static *traceLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): Generator<[number, number]> {
    // Calculate line deltas
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      yield [x, y];

      if (Math.abs(x - x1) < 0.5 && Math.abs(y - y1) < 0.5) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  addLine(
    startLng: number,
    startLat: number,
    endLng: number,
    endLat: number,
    val = true
  ): FogMap {
    if (DEBUG) console.log(
      `[${startLng},${startLat}] to [${endLng},${endLat}] (val=${val})`
    );
    const [x0, y0] = FogMap.LngLatToGlobalXY(startLng, startLat);
    const [x1, y1] = FogMap.LngLatToGlobalXY(endLng, endLat);

    let mutableTiles: { [key: XYKey]: Tile } | null = null;
    let mutableDirtyTiles: Set<XYKey> | null = null;

    // Iterators, counters required by algorithm
    let x, y, px, py, xe, ye;
    // Calculate line deltas
    const dx = x1 - x0;
    const dy = y1 - y0;
    // Create a positive copy of deltas (makes iterating easier)
    const dx0 = Math.abs(dx);
    const dy0 = Math.abs(dy);
    // Calculate error intervals for both axis
    px = 2 * dy0 - dx0;
    py = 2 * dx0 - dy0;
    // The line is X-axis dominant
    if (dy0 <= dx0) {
      // Line is drawn left to right
      if (dx >= 0) {
        x = x0;
        y = y0;
        xe = x1;
      } else {
        // Line is drawn right to left (swap ends)
        x = x1;
        y = y1;
        xe = x0;
      }
      while (x < xe) {
        const [tileX, tileY] = [x >> ALL_OFFSET, y >> ALL_OFFSET];
        const key = FogMap.makeKeyXY(tileX, tileY);
        let tile = this.tiles[key];
        if (!tile) {
          tile = Tile.createEmptyTile(tileX, tileY);
        }
        if (tile) {
          if (DEBUG) console.log(`tile draw: tileX: ${tileX}, tileY: ${tileY}`);
          let newTile;
          [newTile, x, y, px] = tile.addLine(
            x - (tileX << ALL_OFFSET),
            y - (tileY << ALL_OFFSET),
            xe - (tileX << ALL_OFFSET),
            px,
            dx0,
            dy0,
            true,
            (dx < 0 && dy < 0) || (dx > 0 && dy > 0),
            val
          );
          x += tileX << ALL_OFFSET;
          y += tileY << ALL_OFFSET;

          if (tile !== newTile) {
            if (!mutableTiles) {
              mutableTiles = { ...this.tiles };
              mutableDirtyTiles = new Set(this.dirtyTiles);
            }
            if (newTile) {
              mutableTiles[key] = newTile;
              mutableDirtyTiles!.add(key);
            } else {
              // Keep empty tiles
              mutableTiles[key] = Tile.createEmptyTile(tileX, tileY);
              mutableDirtyTiles!.add(key);
            }
          }
        }
      }
    } else {
      // The line is Y-axis dominant
      // // Line is drawn bottom to top
      if (dy >= 0) {
        x = x0;
        y = y0;
        ye = y1;
      } else {
        // Line is drawn top to bottom
        x = x1;
        y = y1;
        ye = y0;
      }

      while (y < ye) {
        const [tileX, tileY] = [x >> ALL_OFFSET, y >> ALL_OFFSET];
        const key = FogMap.makeKeyXY(tileX, tileY);
        let tile = this.tiles[key];
        if (!tile) {
          tile = Tile.createEmptyTile(tileX, tileY);
        }
        if (tile) {
          if (DEBUG) console.log(`tile draw: tileX: ${tileX}, tileY: ${tileY}`);
          let newTile;
          [newTile, x, y, py] = tile.addLine(
            x - (tileX << ALL_OFFSET),
            y - (tileY << ALL_OFFSET),
            ye - (tileY << ALL_OFFSET),
            py,
            dx0,
            dy0,
            false,
            (dx < 0 && dy < 0) || (dx > 0 && dy > 0),
            val
          );
          x += tileX << ALL_OFFSET;
          y += tileY << ALL_OFFSET;

          if (tile !== newTile) {
            if (!mutableTiles) {
              mutableTiles = { ...this.tiles };
              mutableDirtyTiles = new Set(this.dirtyTiles);
            }
            if (newTile) {
              mutableTiles[key] = newTile;
              mutableDirtyTiles!.add(key);
            } else {
              // Keep empty tiles
              mutableTiles[key] = Tile.createEmptyTile(tileX, tileY);
              mutableDirtyTiles!.add(key);
            }
          }
        }
      }
    }
    if (mutableTiles && mutableDirtyTiles) {
      return new FogMap(mutableTiles, mutableDirtyTiles);
    } else {
      return this;
    }
  }

  getBlocks(bbox: Bbox): { tileKey: string; blockKey: string }[] {
    const nw = Tile.LngLatToXY(bbox.west, bbox.north);
    const se = Tile.LngLatToXY(bbox.east, bbox.south);

    const xMin = nw[0];
    const xMax = se[0];
    const yMin = nw[1];
    const yMax = se[1];

    const xMinTile = Math.floor(xMin);
    const xMaxTile = Math.floor(xMax);
    const yMinTile = Math.floor(yMin);
    const yMaxTile = Math.floor(yMax);

    const result: { tileKey: string; blockKey: string }[] = [];

    for (let tx = xMinTile; tx <= xMaxTile; tx++) {
      for (let ty = yMinTile; ty <= yMaxTile; ty++) {
        const key = FogMap.makeKeyXY(tx, ty);
        const tile = this.tiles[key];
        if (tile) {
          const localXMin = xMin - tx;
          const localYMin = yMin - ty;
          const localXMax = xMax - tx;
          const localYMax = yMax - ty;

          const localKeys = tile.getIntersectingBlocks(
            localXMin,
            localYMin,
            localXMax,
            localYMax
          );
          localKeys.forEach((bk) =>
            result.push({ tileKey: key, blockKey: bk })
          );
        }
      }
    }
    return result;
  }

  removeBlocks(blocksToRemove: {
    [tileKey: string]: string[] | Set<string>;
  }): FogMap {
    let mutableTiles: { [key: XYKey]: Tile } | null = null;
    let mutableDirtyTiles: Set<XYKey> | null = null;

    for (const tileKey in blocksToRemove) {
      if (Object.prototype.hasOwnProperty.call(this.tiles, tileKey)) {
        const tile = this.tiles[tileKey];
        const val = blocksToRemove[tileKey];
        const keysToRemove = val instanceof Set ? val : new Set(val);
        const newTile = tile.removeBlocks(keysToRemove);

        if (newTile !== tile) {
          if (!mutableTiles) {
            mutableTiles = { ...this.tiles };
            mutableDirtyTiles = new Set(this.dirtyTiles);
          }
          if (newTile) {
            mutableTiles[tileKey] = newTile;
          } else {
            // Keep empty tiles
            const [tx, ty] = tileKey.split("-").map(Number);
            mutableTiles[tileKey] = Tile.createEmptyTile(tx, ty);
          }
          mutableDirtyTiles!.add(tileKey);
        }
      }
    }

    if (mutableTiles && mutableDirtyTiles) {
      return new FogMap(mutableTiles, mutableDirtyTiles);
    } else {
      return this;
    }
  }

  // we only provide interface for clearing a bbox, because we think it make no sense to add paths for whole bbox
  clearBbox(bbox: Bbox): FogMap {
    const nw = Tile.LngLatToXY(bbox.west, bbox.north);
    const se = Tile.LngLatToXY(bbox.east, bbox.south);

    const xMin = nw[0];
    const xMax = se[0];
    const yMin = nw[1];
    const yMax = se[1];
    // TODO: what if lng=0

    const xMinInt = Math.floor(xMin);
    const xMaxInt = Math.floor(xMax);
    const yMinInt = Math.floor(yMin);
    const yMaxInt = Math.floor(yMax);

    let mutableTiles: { [key: XYKey]: Tile } | null = null;
    let mutableDirtyTiles: Set<XYKey> | null = null;

    for (let x = xMinInt; x <= xMaxInt; x++) {
      for (let y = yMinInt; y <= yMaxInt; y++) {
        const key = FogMap.makeKeyXY(x, y);
        const tile = this.tiles[key];
        if (tile) {
          const xp0 = Math.max(xMin - tile.x, 0) * TILE_WIDTH;
          const yp0 = Math.max(yMin - tile.y, 0) * TILE_WIDTH;
          const xp1 = Math.min(xMax - tile.x, 1) * TILE_WIDTH;
          const yp1 = Math.min(yMax - tile.y, 1) * TILE_WIDTH;
          const newTile = tile.clearRect(xp0, yp0, xp1 - xp0, yp1 - yp0);

          if (tile !== newTile) {
            if (!mutableTiles) {
              mutableTiles = { ...this.tiles };
              mutableDirtyTiles = new Set(this.dirtyTiles);
            }
            if (newTile) {
              mutableTiles[key] = newTile;
            } else {
              // Keep empty tiles
              mutableTiles[key] = Tile.createEmptyTile(x, y);
            }
            mutableDirtyTiles!.add(key);
          }
        }
      }
    }
    if (mutableTiles && mutableDirtyTiles) {
      return new FogMap(mutableTiles, mutableDirtyTiles);
    } else {
      return this;
    }
  }
}

export class Tile {
  readonly filename: string;
  readonly id: TileID;
  readonly x: number;
  readonly y: number;
  readonly blocks: { [key: XYKey]: Block };

  constructor(
    filename: string,
    id: TileID,
    x: number,
    y: number,
    blocks: { [key: XYKey]: Block }
  ) {
    Object.freeze(blocks);
    this.filename = filename;
    this.id = id;
    this.x = x;
    this.y = y;
    this.blocks = blocks;
  }

  static createEmptyTile(x: number, y: number): Tile {
    const id = y * MAP_WIDTH + x;
    if (DEBUG) console.log(`Creating tile. id: ${id}, x: ${x}, y: ${y}`);

    const digits = id.toString().split("").map(Number);
    const name0 = Md5.hashStr(id.toString()).substring(0, 4);
    const name1 = digits.map((d) => FILENAME_MASK1.charAt(d)).join("");
    const name2 = digits.map((d) => FILENAME_MASK2.charAt(d)).join("");
    const filename = `${name0}${name1}${name2.substring(name2.length - 2)}`;

    const blocks = {} as { [key: XYKey]: Block };

    return new Tile(filename, id, x, y, blocks);
  }

  static create(filename: string, data: ArrayBuffer): Tile {
    // TODO: try catch
    const id = Number.parseInt(
      filename
        .slice(4, -2)
        .split("")
        .map((idMasked) => FILENAME_ENCODING[idMasked])
        .join("")
    );
    const x = id % MAP_WIDTH;
    const y = Math.floor(id / MAP_WIDTH);

    if (DEBUG) console.log(`Loading tile. id: ${id}, x: ${x}, y: ${y}`);

    // TODO: try catch
    const actualData = pako.inflate(new Uint8Array(data));

    const header = new Uint16Array(
      actualData.slice(0, TILE_HEADER_SIZE).buffer
    );

    const blocks = {} as { [key: XYKey]: Block };

    for (let i = 0; i < header.length; i++) {
      const blockIdx = header[i];
      if (blockIdx > 0) {
        const blockX = i % TILE_WIDTH;
        const blockY = Math.floor(i / TILE_WIDTH);
        const startOffset = TILE_HEADER_SIZE + (blockIdx - 1) * BLOCK_SIZE;
        const endOffset = startOffset + BLOCK_SIZE;
        const blockData = actualData.slice(startOffset, endOffset);
        const block = Block.create(blockX, blockY, blockData);
        block.check();
        blocks[FogMap.makeKeyXY(blockX, blockY)] = block;
      }
    }
    return new Tile(filename, id, x, y, blocks);
  }

  dump(): Uint8Array {
    const header = new Uint8Array(TILE_HEADER_SIZE);
    const headerView = new DataView(header.buffer, 0, TILE_HEADER_SIZE);

    const blockDataSize = BLOCK_SIZE * Object.entries(this.blocks).length;

    const blockData = new Uint8Array(blockDataSize);

    let activeBlockIdx = 1;
    Object.values(this.blocks)
      .map((block) => {
        const i = block.x + block.y * TILE_WIDTH;
        return [i, block] as [number, Block];
      })
      .sort((a, b) => {
        return a[0] - b[0];
      })
      .forEach(([i, block]) => {
        headerView.setUint16(i * 2, activeBlockIdx, true);
        blockData.set(block.dump(), (activeBlockIdx - 1) * BLOCK_SIZE);
        activeBlockIdx++;
      });

    const data = new Uint8Array(TILE_HEADER_SIZE + blockDataSize);
    data.set(header);
    data.set(blockData, TILE_HEADER_SIZE);

    return pako.deflate(data);
  }

  static XYToLngLat(x: number, y: number): number[] {
    const lng = (x / 512) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / 512)) * 180) / Math.PI;
    return [lng, lat];
  }

  static LngLatToXY(lng: number, lat: number): number[] {
    const x = ((lng + 180) / 360) * 512;
    const y =
      ((Math.PI - Math.asinh(Math.tan((lat / 180) * Math.PI))) * 512) /
      (2 * Math.PI);
    return [x, y];
  }

  bounds(): number[][] {
    const sw = Tile.XYToLngLat(this.x, this.y + 1);
    const se = Tile.XYToLngLat(this.x + 1, this.y + 1);
    const ne = Tile.XYToLngLat(this.x + 1, this.y);
    const nw = Tile.XYToLngLat(this.x, this.y);
    return [nw, ne, se, sw];
  }

  bbox(): Bbox {
    const [west, south] = Tile.XYToLngLat(this.x, this.y + 1);
    const [east, north] = Tile.XYToLngLat(this.x + 1, this.y);
    const bbox = new Bbox(west, south, east, north);
    return bbox;
  }

  addLine(
    x: number,
    y: number,
    e: number,
    p: number,
    dx0: number,
    dy0: number,
    xaxis: boolean,
    quadrants13: boolean,
    val: boolean
  ): [Tile | null, number, number, number] {
    let mutableBlocks: { [key: XYKey]: Block } | null = null;
    if (xaxis) {
      // Rasterize the line
      for (let i = 0; x < e; i++) {
        if (
          x >> BITMAP_WIDTH_OFFSET >= TILE_WIDTH ||
          y >> BITMAP_WIDTH_OFFSET < 0 ||
          y >> BITMAP_WIDTH_OFFSET >= TILE_WIDTH
        ) {
          break;
        }
        const blockX = x >> BITMAP_WIDTH_OFFSET;
        const blockY = y >> BITMAP_WIDTH_OFFSET;
        const key = FogMap.makeKeyXY(blockX, blockY);
        let block = this.blocks[key];
        if (!block) {
          block = Block.create(blockX, blockY, null);
        }
        if (block) {
          if (DEBUG) console.log(
            `block draw: blockx: ${blockX}, blocky: ${blockY} x: ${x}, y: ${y}`
          );
          let newBlock;
          [newBlock, x, y, p] = block.addLine(
            x - (blockX << BITMAP_WIDTH_OFFSET),
            y - (blockY << BITMAP_WIDTH_OFFSET),
            e - (blockX << BITMAP_WIDTH_OFFSET),
            p,
            dx0,
            dy0,
            xaxis,
            quadrants13,
            val
          );

          x += blockX << BITMAP_WIDTH_OFFSET;
          y += blockY << BITMAP_WIDTH_OFFSET;

          if (newBlock !== block) {
            if (!mutableBlocks) {
              mutableBlocks = { ...this.blocks };
            }
            if (newBlock) {
              mutableBlocks[key] = newBlock;
            } else {
              delete mutableBlocks[key]; // TODO: this is impossible since we are adding tracks?
            }
          }
        }
      }
    } else {
      // Rasterize the line
      for (let i = 0; y < e; i++) {
        if (
          y >> BITMAP_WIDTH_OFFSET >= TILE_WIDTH ||
          x >> BITMAP_WIDTH_OFFSET < 0 ||
          x >> BITMAP_WIDTH_OFFSET >= TILE_WIDTH
        ) {
          break;
        }
        const blockX = x >> BITMAP_WIDTH_OFFSET;
        const blockY = y >> BITMAP_WIDTH_OFFSET;
        const key = FogMap.makeKeyXY(blockX, blockY);
        let block = this.blocks[key];
        if (!block) {
          block = Block.create(blockX, blockY, null);
        }
        if (block) {
          if (DEBUG) console.log(
            `block draw: blockx: ${blockX}, blocky: ${blockY} x: ${x}, y: ${y}`
          );
          let newBlock;
          [newBlock, x, y, p] = block.addLine(
            x - (blockX << BITMAP_WIDTH_OFFSET),
            y - (blockY << BITMAP_WIDTH_OFFSET),
            e - (blockY << BITMAP_WIDTH_OFFSET),
            p,
            dx0,
            dy0,
            xaxis,
            quadrants13,
            val
          );

          x += blockX << BITMAP_WIDTH_OFFSET;
          y += blockY << BITMAP_WIDTH_OFFSET;

          if (newBlock !== block) {
            if (!mutableBlocks) {
              mutableBlocks = { ...this.blocks };
            }
            if (newBlock) {
              mutableBlocks[key] = newBlock;
            } else {
              delete mutableBlocks[key]; // TODO: this is impossible since we are adding tracks?
            }
          }
        }
      }
    }

    // Immutable.js avoids creating new objects for updates where no change in value occurred
    if (mutableBlocks) {
      if (Object.entries(mutableBlocks).length === 0) {
        return [null, x, y, p];
      } else {
        if (DEBUG) console.log("return updated tile");
        Object.freeze(mutableBlocks);
        return [
          new Tile(this.filename, this.id, this.x, this.y, mutableBlocks),
          x,
          y,
          p,
        ];
      }
    } else {
      return [this, x, y, p];
    }
  }

  getIntersectingBlocks(
    xMin: number,
    yMin: number,
    xMax: number,
    yMax: number
  ): string[] {
    const bxMin = Math.floor(xMin * TILE_WIDTH);
    const byMin = Math.floor(yMin * TILE_WIDTH);
    const bxMax = Math.ceil(xMax * TILE_WIDTH);
    const byMax = Math.ceil(yMax * TILE_WIDTH);

    const result: string[] = [];

    for (let x = bxMin; x < bxMax; x++) {
      for (let y = byMin; y < byMax; y++) {
        const key = FogMap.makeKeyXY(x, y);
        if (Object.prototype.hasOwnProperty.call(this.blocks, key)) {
          result.push(key);
        }
      }
    }
    return result;
  }

  removeBlocks(blockKeys: Set<string>): Tile | null {
    let mutableBlocks: { [key: XYKey]: Block } | null = null;
    let changed = false;

    // Check if any keys to remove exist in this tile
    blockKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(this.blocks, key)) {
        if (!mutableBlocks) {
          mutableBlocks = { ...this.blocks };
        }
        delete mutableBlocks[key];
        changed = true;
      }
    });

    if (!changed) {
      return this;
    }

    if (mutableBlocks && Object.keys(mutableBlocks).length === 0) {
      return null;
    }

    if (mutableBlocks) {
      Object.freeze(mutableBlocks);
      return new Tile(this.filename, this.id, this.x, this.y, mutableBlocks);
    }
    return this;
  }

  clearRect(x: number, y: number, width: number, height: number): Tile | null {
    if (DEBUG) console.log(
      `clearRect: x: ${x}, y: ${y}, width: ${width}, height: ${height}`
    );
    const xMin = x;
    const yMin = y;
    const xMax = x + width;
    const yMax = y + height;

    const xMinInt = Math.floor(xMin);
    const xMaxInt = Math.floor(xMax);

    const yMinInt = Math.floor(yMin);
    const yMaxInt = Math.floor(yMax);

    let mutableBlocks: { [key: XYKey]: Block } | null = null;

    for (let x = xMinInt; x <= xMaxInt; x++) {
      for (let y = yMinInt; y <= yMaxInt; y++) {
        const key = FogMap.makeKeyXY(x, y);
        const block = this.blocks[key];
        if (block) {
          const xp0 = Math.round(Math.max(xMin - block.x, 0) * BITMAP_WIDTH);
          const yp0 = Math.round(Math.max(yMin - block.y, 0) * BITMAP_WIDTH);
          const xp1 = Math.round(Math.min(xMax - block.x, 1) * BITMAP_WIDTH);
          const yp1 = Math.round(Math.min(yMax - block.y, 1) * BITMAP_WIDTH);
          const newBlock = block.clearRect(xp0, yp0, xp1 - xp0, yp1 - yp0);

          if (newBlock !== block) {
            if (!mutableBlocks) {
              mutableBlocks = { ...this.blocks };
            }
            if (newBlock) {
              mutableBlocks[key] = newBlock;
            } else {
              delete mutableBlocks[key];
            }
          }
        }
      }
    }

    // Immutable.js avoids creating new objects for updates where no change in value occurred
    if (mutableBlocks) {
      if (Object.entries(mutableBlocks).length === 0) {
        return null;
      } else {
        Object.freeze(mutableBlocks);
        return new Tile(this.filename, this.id, this.x, this.y, mutableBlocks);
      }
    } else {
      return this;
    }
  }
}

export class Block {
  readonly x: number;
  readonly y: number;
  readonly bitmap: Uint8Array;
  readonly extraData: Uint8Array;

  private constructor(
    x: number,
    y: number,
    bitmap: Uint8Array,
    extraData: Uint8Array
  ) {
    this.x = x;
    this.y = y;
    this.bitmap = bitmap;
    this.extraData = extraData;
  }

  static create(x: number, y: number, data: Uint8Array | null): Block {
    if (data) {
      const bitmap = data.slice(0, BLOCK_BITMAP_SIZE);
      const extraData = data.slice(BLOCK_BITMAP_SIZE, BLOCK_SIZE);
      return new Block(x, y, bitmap, extraData);
    } else {
      const bitmap = new Uint8Array(BLOCK_BITMAP_SIZE);
      const extraData = new Uint8Array(BLOCK_EXTRA_DATA);
      // FIXME: correct the extraData
      return new Block(x, y, bitmap, extraData);
    }
  }

  check(): boolean {
    let count = 0;
    for (let i = 0; i < BITMAP_WIDTH; i++) {
      for (let j = 0; j < BITMAP_WIDTH; j++) {
        if (this.isVisited(i, j)) {
          count++;
        }
      }
    }

    const isCorrect = count === this.count();
    if (!isCorrect) {
      console.warn(`block check sum error!`);
    }
    return isCorrect;
  }

  dump(): Uint8Array {
    const data = new Uint8Array(BLOCK_SIZE);

    let count = 0;
    for (let i = 0; i < BITMAP_WIDTH; i++) {
      for (let j = 0; j < BITMAP_WIDTH; j++) {
        if (this.isVisited(i, j)) {
          count++;
        }
      }
    }
    const checksumDataview = new DataView(this.extraData.buffer, 1, 2);
    checksumDataview.setUint16(
      0,
      (checksumDataview.getUint16(0, false) & 0xc000) | ((count << 1) + 1),
      false
    );

    data.set(this.bitmap);
    data.set(this.extraData, BLOCK_BITMAP_SIZE);

    return data;
  }

  region(): string {
    const regionChar0 = String.fromCharCode(
      (this.extraData[0] >> 3) + "?".charCodeAt(0)
    );
    const regionChar1 = String.fromCharCode(
      (((this.extraData[0] & 0x7) << 2) | ((this.extraData[1] & 0xc0) >> 6)) +
      "?".charCodeAt(0)
    );
    return regionChar0 + regionChar1;
  }

  count(): number {
    return (
      (new DataView(this.extraData.buffer, 1, 2).getUint16(0, false) &
        0x3fff) >>
      1
    );
  }

  isVisited(x: number, y: number): boolean {
    const bitOffset = 7 - (x % 8);
    const i = Math.floor(x / 8);
    const j = y;
    return (this.bitmap[i + j * 8] & (1 << bitOffset)) !== 0;
  }

  private static setPoint(
    mutableBitmap: Uint8Array,
    x: number,
    y: number,
    val: boolean
  ): void {
    const bitOffset = 7 - (x % 8);
    const i = Math.floor(x / 8);
    const j = y;
    const valNumber = val ? 1 : 0;
    mutableBitmap[i + j * 8] =
      (mutableBitmap[i + j * 8] & ~(1 << bitOffset)) | (valNumber << bitOffset);
  }

  private static bitmapEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) {
      return false;
    }
    for (let i = 0; i != a.byteLength; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  // a modified Bresenham algorithm with initialized error from upper layer
  addLine(
    x: number,
    y: number,
    e: number,
    p: number,
    dx0: number,
    dy0: number,
    xaxis: boolean,
    quadrants13: boolean,
    val: boolean
  ): [Block | null, number, number, number] {
    const mutableBitmap = new Uint8Array(this.bitmap);
    if (DEBUG) console.log(`subblock draw: x:${x}, y:${y}, e:${e}`);
    // Draw the first pixel
    Block.setPoint(mutableBitmap, x, y, val);
    if (xaxis) {
      // Rasterize the line
      for (let i = 0; x < e; i++) {
        x = x + 1;
        // Deal with octants...
        if (p < 0) {
          p = p + 2 * dy0;
        } else {
          if (quadrants13) {
            y = y + 1;
          } else {
            y = y - 1;
          }
          p = p + 2 * (dy0 - dx0);
        }

        if (x >= BITMAP_WIDTH || y < 0 || y >= BITMAP_WIDTH) {
          break;
        }
        // Draw pixel from line span at
        // currently rasterized position
        Block.setPoint(mutableBitmap, x, y, val);
      }
    } else {
      // The line is Y-axis dominant
      // Rasterize the line
      for (let i = 0; y < e; i++) {
        y = y + 1;
        // Deal with octants...
        if (p <= 0) {
          p = p + 2 * dx0;
        } else {
          if (quadrants13) {
            x = x + 1;
          } else {
            x = x - 1;
          }
          p = p + 2 * (dx0 - dy0);
        }

        if (y >= BITMAP_WIDTH || x < 0 || x >= BITMAP_WIDTH) {
          break;
        }
        // Draw pixel from line span at
        // currently rasterized position
        Block.setPoint(mutableBitmap, x, y, val);
      }
    }

    // Check if empty when clearing
    if (!val && mutableBitmap.every((v) => v === 0)) {
      return [null, x, y, p];
    }

    if (Block.bitmapEqual(mutableBitmap, this.bitmap)) {
      return [this, x, y, p];
    } else {
      return [
        new Block(this.x, this.y, mutableBitmap, this.extraData),
        x,
        y,
        p,
      ];
    }
  }

  clearRect(x: number, y: number, width: number, height: number): Block | null {
    const mutableBitmap = new Uint8Array(this.bitmap);

    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        Block.setPoint(mutableBitmap, x + i, y + j, false);
      }
    }
    if (mutableBitmap.every((v) => v === 0)) {
      return null;
    }
    if (Block.bitmapEqual(mutableBitmap, this.bitmap)) {
      return this;
    } else {
      return new Block(this.x, this.y, mutableBitmap, this.extraData);
    }
  }
}
