import * as fogMap from "../utils/FogMap";

interface PerfMetrics {
    tileCnt: number;
    blockCnt: number;
    duration: number;
}

// Get tile count from FogMap
function getTileCnt(map: fogMap.FogMap): number {
    return Object.keys(map.tiles).length;
}

// Get total block count from FogMap
function getBlockCnt(map: fogMap.FogMap): number {
    return Object.values(map.tiles).reduce(
        (sum, tile) => sum + Object.keys(tile.blocks).length,
        0
    );
}

// Get metrics from FogMap
function getMetrics(map: fogMap.FogMap, duration: number): PerfMetrics {
    return {
        tileCnt: getTileCnt(map),
        blockCnt: getBlockCnt(map),
        duration
    };
}

// Measure execution time
function timeit(text: string, func: () => void): number {
    const start = performance.now();
    func();
    const end = performance.now();
    const duration = end - start;
    process.stdout.write(`${text} took ${duration.toFixed(2)} ms\n`);
    return duration;
}

// Simulate erasing pixels along a line using circle eraser
function eraseAlongLine(
    map: fogMap.FogMap,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    diameter: number
): fogMap.FogMap {
    const [gx0, gy0] = fogMap.FogMap.LngLatToGlobalXY(x0, y0);
    const [gx1, gy1] = fogMap.FogMap.LngLatToGlobalXY(x1, y1);

    const points = Array.from(fogMap.FogMap.traceLine(gx0, gy0, gx1, gy1));

    const constants = {
        TILE_WIDTH: fogMap.TILE_WIDTH,
        BITMAP_WIDTH: fogMap.BITMAP_WIDTH,
        BITMAP_WIDTH_OFFSET: fogMap.BITMAP_WIDTH_OFFSET,
        ALL_OFFSET: fogMap.TILE_WIDTH_OFFSET + fogMap.BITMAP_WIDTH_OFFSET,
    };

    // Simulate drawing session
    const session = {
        baseMap: map,
        modifiedBlocks: {} as { [tileKey: string]: { [blockKey: string]: fogMap.Block | null } },
        blockCounts: {} as { [tileKey: string]: { [blockKey: string]: number } },
    };

    const eraser = new PixelEraser(session, constants);
    eraser.eraseCircle(points, diameter);

    return map.updateBlocks(session.modifiedBlocks);
}

// PixelEraser class (copied from DelPixelMode.ts for testing)
class PixelEraser {
    private cachedTileKey = "";
    private cachedBlockKey = "";
    private cachedBlock: fogMap.Block | null | undefined = undefined;
    private processedPixels = new Set<string>();
    private changed = false;

    constructor(
        private drawingSession: {
            baseMap: fogMap.FogMap;
            modifiedBlocks: { [tileKey: string]: { [blockKey: string]: fogMap.Block | null } };
            blockCounts: { [tileKey: string]: { [blockKey: string]: number } };
        },
        private constants: {
            TILE_WIDTH: number;
            BITMAP_WIDTH: number;
            BITMAP_WIDTH_OFFSET: number;
            ALL_OFFSET: number;
        }
    ) { }

    erasePixel(gx: number, gy: number): void {
        const pixelKey = `${gx},${gy}`;
        if (this.processedPixels.has(pixelKey)) return;
        this.processedPixels.add(pixelKey);

        const { tileKey, blockKey, blockX, blockY } = this.getBlockCoordinates(gx, gy);

        this.updateCache(tileKey, blockKey);
        if (this.cachedBlock === null) return;

        const block = this.getOrCreateBlock(tileKey, blockKey, blockX, blockY);
        if (!block) return;

        if (this.clearPixelBit(block, gx, gy)) {
            this.updateBlockCount(tileKey, blockKey);
            this.changed = true;
        }
    }

    eraseCircle(points: [number, number][], diameter: number): void {
        const radius = diameter / 2;
        const radiusSquared = radius * radius;
        const offsetStart = -Math.floor(radius);
        const offsetEnd = Math.ceil(radius);

        for (const [x, y] of points) {
            for (let dx = offsetStart; dx < offsetEnd; dx++) {
                for (let dy = offsetStart; dy < offsetEnd; dy++) {
                    if (dx * dx + dy * dy <= radiusSquared) {
                        this.erasePixel(x + dx, y + dy);
                    }
                }
            }
        }
    }

    hasChanged(): boolean {
        return this.changed;
    }

    private getBlockCoordinates(gx: number, gy: number) {
        const { TILE_WIDTH, BITMAP_WIDTH_OFFSET, ALL_OFFSET } = this.constants;
        const tileX = gx >> ALL_OFFSET;
        const tileY = gy >> ALL_OFFSET;
        const tileKey = fogMap.FogMap.makeKeyXY(tileX, tileY);
        const blockX = (gx >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
        const blockY = (gy >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
        const blockKey = fogMap.FogMap.makeKeyXY(blockX, blockY);
        return { tileKey, blockKey, blockX, blockY };
    }

    private updateCache(tileKey: string, blockKey: string): void {
        if (tileKey !== this.cachedTileKey || blockKey !== this.cachedBlockKey) {
            this.cachedTileKey = tileKey;
            this.cachedBlockKey = blockKey;
            this.cachedBlock = undefined;

            if (this.drawingSession.modifiedBlocks[tileKey]) {
                this.cachedBlock = this.drawingSession.modifiedBlocks[tileKey][blockKey];
            }
        }
    }

    private getOrCreateBlock(
        tileKey: string,
        blockKey: string,
        blockX: number,
        blockY: number
    ): fogMap.Block | null {
        if (this.cachedBlock === undefined) {
            const tile = this.drawingSession.baseMap.tiles[tileKey];
            const originalBlock = tile?.blocks[blockKey];
            if (!originalBlock) return null;

            const newBlock = fogMap.Block.create(blockX, blockY, originalBlock.dump());

            if (!this.drawingSession.modifiedBlocks[tileKey]) {
                this.drawingSession.modifiedBlocks[tileKey] = {};
                this.drawingSession.blockCounts[tileKey] = {};
            }

            this.drawingSession.modifiedBlocks[tileKey][blockKey] = newBlock;
            this.drawingSession.blockCounts[tileKey][blockKey] = newBlock.count();
            this.cachedBlock = newBlock;
        }

        return this.cachedBlock as fogMap.Block;
    }

    private clearPixelBit(block: fogMap.Block, gx: number, gy: number): boolean {
        const { BITMAP_WIDTH } = this.constants;
        const localX = gx % BITMAP_WIDTH;
        const localY = gy % BITMAP_WIDTH;
        const bitOffset = 7 - (localX % 8);
        const i = Math.floor(localX / 8);
        const j = localY;
        const index = i + j * 8;

        const isSet = (block.bitmap[index] & (1 << bitOffset)) !== 0;
        if (isSet) {
            block.bitmap[index] &= ~(1 << bitOffset);
            return true;
        }
        return false;
    }

    private updateBlockCount(tileKey: string, blockKey: string): void {
        this.drawingSession.blockCounts[tileKey][blockKey]--;

        if (this.drawingSession.blockCounts[tileKey][blockKey] <= 0) {
            this.drawingSession.modifiedBlocks[tileKey][blockKey] = null;
            this.cachedBlock = null;
        }
    }
}

describe("Performance Test - DelPixel", () => {
    test("should measure performance of delPixel operation", () => {
        process.stdout.write("\n=== Performance Test: DelPixel ===\n\n");

        // Step 1: Draw dense lines to create 50% coverage area
        process.stdout.write("Step 1: Drawing dense lines to create ~50% coverage area\n");

        let map = fogMap.FogMap.empty;
        const centerLng = 120.0;
        const centerLat = 24.0;
        const areaSize = 0.05; // ~5km area
        const lineSpacing = 0.0001; // Dense spacing for 50% coverage

        let drawDuration = 0;
        const drawStart = performance.now();

        // Draw horizontal lines
        for (let lat = centerLat - areaSize; lat <= centerLat + areaSize; lat += lineSpacing) {
            map = map.addLine(
                centerLng - areaSize,
                lat,
                centerLng + areaSize,
                lat
            );
        }

        drawDuration = performance.now() - drawStart;
        const afterDrawMetrics = getMetrics(map, drawDuration);

        process.stdout.write(`  Drawing took ${drawDuration.toFixed(2)} ms\n`);
        process.stdout.write(`  → Tiles: ${afterDrawMetrics.tileCnt}, Blocks: ${afterDrawMetrics.blockCnt}\n\n`);

        // Step 2: Simulate delPixel with press/move/release pattern
        process.stdout.write("Step 2: Simulating delPixel operations (press/move/release)\n");

        const diameter = 50; // Larger eraser diameter for visible effect
        const erasePaths = [
            // Horizontal strokes across the area
            { x0: centerLng - areaSize * 0.9, y0: centerLat, x1: centerLng + areaSize * 0.9, y1: centerLat },
            { x0: centerLng - areaSize * 0.8, y0: centerLat + areaSize * 0.2, x1: centerLng + areaSize * 0.8, y1: centerLat + areaSize * 0.2 },
            { x0: centerLng - areaSize * 0.8, y0: centerLat - areaSize * 0.2, x1: centerLng + areaSize * 0.8, y1: centerLat - areaSize * 0.2 },
            { x0: centerLng - areaSize * 0.7, y0: centerLat + areaSize * 0.4, x1: centerLng + areaSize * 0.7, y1: centerLat + areaSize * 0.4 },
            { x0: centerLng - areaSize * 0.7, y0: centerLat - areaSize * 0.4, x1: centerLng + areaSize * 0.7, y1: centerLat - areaSize * 0.4 },
            // Vertical strokes
            { x0: centerLng, y0: centerLat - areaSize * 0.9, x1: centerLng, y1: centerLat + areaSize * 0.9 },
            { x0: centerLng + areaSize * 0.3, y0: centerLat - areaSize * 0.8, x1: centerLng + areaSize * 0.3, y1: centerLat + areaSize * 0.8 },
            { x0: centerLng - areaSize * 0.3, y0: centerLat - areaSize * 0.8, x1: centerLng - areaSize * 0.3, y1: centerLat + areaSize * 0.8 },
            // Diagonal strokes
            { x0: centerLng - areaSize * 0.6, y0: centerLat - areaSize * 0.6, x1: centerLng + areaSize * 0.6, y1: centerLat + areaSize * 0.6 },
            { x0: centerLng - areaSize * 0.6, y0: centerLat + areaSize * 0.6, x1: centerLng + areaSize * 0.6, y1: centerLat - areaSize * 0.6 },
            // Additional coverage strokes
            { x0: centerLng - areaSize * 0.5, y0: centerLat + areaSize * 0.7, x1: centerLng + areaSize * 0.5, y1: centerLat + areaSize * 0.7 },
            { x0: centerLng - areaSize * 0.5, y0: centerLat - areaSize * 0.7, x1: centerLng + areaSize * 0.5, y1: centerLat - areaSize * 0.7 },
        ];

        let totalEraseDuration = 0;

        erasePaths.forEach((path, idx) => {
            const duration = timeit(`  Erase stroke ${idx + 1}`, () => {
                map = eraseAlongLine(map, path.x0, path.y0, path.x1, path.y1, diameter);
            });
            totalEraseDuration += duration;
        });

        const afterEraseMetrics = getMetrics(map, totalEraseDuration);

        process.stdout.write(`\n  Total erase time: ${totalEraseDuration.toFixed(2)} ms\n`);
        process.stdout.write(`  Average time per stroke: ${(totalEraseDuration / erasePaths.length).toFixed(2)} ms\n`);
        process.stdout.write(`  → Remaining Tiles: ${afterEraseMetrics.tileCnt}, Blocks: ${afterEraseMetrics.blockCnt}\n\n`);

        // Summary
        process.stdout.write("=== Summary ===\n");
        process.stdout.write(`Initial Drawing: ${drawDuration.toFixed(2)} ms\n`);
        process.stdout.write(`  Created Tiles: ${afterDrawMetrics.tileCnt}, Blocks: ${afterDrawMetrics.blockCnt}\n`);
        process.stdout.write(`Erasing Operations: ${totalEraseDuration.toFixed(2)} ms\n`);
        process.stdout.write(`  Remaining Tiles: ${afterEraseMetrics.tileCnt}, Blocks: ${afterEraseMetrics.blockCnt}\n`);
        process.stdout.write(`  Blocks Removed: ${afterDrawMetrics.blockCnt - afterEraseMetrics.blockCnt}\n`);
        process.stdout.write(`  Removal Rate: ${((afterDrawMetrics.blockCnt - afterEraseMetrics.blockCnt) / afterDrawMetrics.blockCnt * 100).toFixed(1)}%\n\n`);

        // Basic assertions
        expect(afterDrawMetrics.blockCnt).toBeGreaterThan(0);
        expect(afterEraseMetrics.blockCnt).toBeLessThan(afterDrawMetrics.blockCnt);
    });
});

export { };
