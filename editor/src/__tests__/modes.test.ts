import * as fogMap from "../utils/FogMap";
import { Bbox } from "../utils/CommonTypes";

// Helper function to count total blocks
function countTotalBlocks(fogMapData: fogMap.FogMap): number {
    return Object.values(fogMapData.tiles).reduce(
        (sum, tile) => sum + Object.keys(tile.blocks).length,
        0
    );
}

describe("Mode Functional Tests", () => {
    describe("DrawScribble Mode - addLine", () => {
        test("should reveal fog when drawing a short line", () => {
            // 1. Start with empty FogMap
            let fogMapData = fogMap.FogMap.empty;

            // 2. Draw a line (simulating DrawScribble mode)
            fogMapData = fogMapData.addLine(
                121.5, 25.0,  // Start point (lng, lat)
                121.6, 25.1   // End point (lng, lat)
            );

            // 3. Verify exact counts
            const tileCount = Object.keys(fogMapData.tiles).length;
            const blockCount = countTotalBlocks(fogMapData);


            // This specific line creates exactly 1 tile with 39 blocks
            expect(tileCount).toBe(1);
            expect(blockCount).toBe(39);
        });

        test("should create multiple tiles for long line", () => {
            let fogMapData = fogMap.FogMap.empty;

            // Draw a longer line that crosses tile boundaries
            fogMapData = fogMapData.addLine(
                121.0, 25.0,
                122.0, 26.0
            );

            const tileCount = Object.keys(fogMapData.tiles).length;
            const blockCount = countTotalBlocks(fogMapData);


            // This long line creates exactly 4 tiles with 382 blocks
            expect(tileCount).toBe(4);
            expect(blockCount).toBe(382);
        });

        test("should accumulate multiple lines", () => {
            let fogMapData = fogMap.FogMap.empty;

            // Draw first line
            fogMapData = fogMapData.addLine(121.5, 25.0, 121.6, 25.1);
            const tilesAfterFirstLine = Object.keys(fogMapData.tiles).length;

            // Draw second line
            fogMapData = fogMapData.addLine(121.7, 25.2, 121.8, 25.3);
            const tilesAfterSecondLine = Object.keys(fogMapData.tiles).length;

            // Should have at least as many tiles as before
            expect(tilesAfterSecondLine).toBeGreaterThanOrEqual(tilesAfterFirstLine);
        });
    });

    describe("DelRect Mode - clearBbox", () => {
        test("should clear fog in rectangle area", () => {
            // 1. Create fog by drawing a line
            let fogMapData = fogMap.FogMap.empty;
            fogMapData = fogMapData.addLine(121.5, 25.0, 121.6, 25.1);

            const blocksBeforeClear = countTotalBlocks(fogMapData);
            expect(blocksBeforeClear).toBeGreaterThan(0);

            // 2. Clear the same area with a rectangle
            const bbox = new Bbox(121.5, 25.0, 121.6, 25.1);
            fogMapData = fogMapData.clearBbox(bbox);

            // 3. Verify: blocks should be significantly reduced or cleared
            const blocksAfterClear = countTotalBlocks(fogMapData);
            expect(blocksAfterClear).toBeLessThan(blocksBeforeClear);
        });

        test("should partially clear fog", () => {
            let fogMapData = fogMap.FogMap.empty;

            // Draw a line
            fogMapData = fogMapData.addLine(121.5, 25.0, 121.7, 25.2);

            // Clear only part of the area
            const bbox = new Bbox(121.5, 25.0, 121.55, 25.05);
            fogMapData = fogMapData.clearBbox(bbox);

            // Should still have some blocks remaining
            const totalBlocks = countTotalBlocks(fogMapData);
            expect(totalBlocks).toBeGreaterThan(0);
        });
    });

    describe("DelBlock Mode - removeBlocks", () => {
        test("should remove specific blocks", () => {
            // 1. Create fog
            let fogMapData = fogMap.FogMap.empty;
            fogMapData = fogMapData.addLine(121.5, 25.0, 121.6, 25.1);

            // 2. Get blocks in a bbox
            const bbox = new Bbox(121.5, 25.0, 121.6, 25.1);
            const blocksToRemove = fogMapData.getBlocks(bbox);

            expect(blocksToRemove.length).toBeGreaterThan(0);

            // 3. Group blocks by tile
            const blocksByTile: { [tileKey: string]: string[] } = {};
            blocksToRemove.forEach(({ tileKey, blockKey }) => {
                if (!blocksByTile[tileKey]) {
                    blocksByTile[tileKey] = [];
                }
                blocksByTile[tileKey].push(blockKey);
            });

            // 4. Remove blocks
            fogMapData = fogMapData.removeBlocks(blocksByTile);

            // 5. Verify: blocks should be removed
            const totalBlocks = countTotalBlocks(fogMapData);
            expect(totalBlocks).toBe(0);
        });
    });

    describe("FogMap state management", () => {
        test("should mark tiles as dirty after operations", () => {
            let fogMapData = fogMap.FogMap.empty;

            // Initially no dirty tiles
            expect(fogMapData.getDirtyTilesCount()).toBe(0);

            // Draw a line
            fogMapData = fogMapData.addLine(121.5, 25.0, 121.6, 25.1);

            // Should have dirty tiles
            expect(fogMapData.getDirtyTilesCount()).toBeGreaterThan(0);
        });

        test("should clear dirty tiles flag", () => {
            let fogMapData = fogMap.FogMap.empty;
            fogMapData = fogMapData.addLine(121.5, 25.0, 121.6, 25.1);

            expect(fogMapData.getDirtyTilesCount()).toBeGreaterThan(0);

            // Clear dirty flag
            fogMapData = fogMapData.clearDirtyTiles();

            expect(fogMapData.getDirtyTilesCount()).toBe(0);
        });
    });

    describe("Edge cases", () => {
        test("should handle empty FogMap operations", () => {
            let fogMapData = fogMap.FogMap.empty;

            // Clear empty map should not crash
            const bbox = new Bbox(121.5, 25.0, 121.6, 25.1);
            fogMapData = fogMapData.clearBbox(bbox);

            expect(Object.keys(fogMapData.tiles).length).toBe(0);
        });
    });
});

export { };
