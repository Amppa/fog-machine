import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as MapEraserUtils from "../MapEraserUtils";
import { DrawingSession } from "../MapEraserUtils";
import * as fogMap from "../FogMap";

// Pixel sizes for eraser (same as in Editor.tsx)
const DELETE_PIXEL_SIZES = [1, 3, 9, 31]; // Edge length pixels

/**
 * DelPixel Mode
 * Allows user to erase fog pixel by pixel with a circular cursor
 */
export class DelPixelMode implements ModeStrategy {
    private lastPos: mapboxgl.LngLat | null = null;
    private drawingSession: DrawingSession | null = null;
    private eraserSize: number = DELETE_PIXEL_SIZES[DELETE_PIXEL_SIZES.length - 1]; // Default: 31 (last size)
    private readonly layerId = MapEraserUtils.LAYER_IDS.DEL_PIXEL_CURSOR;

    activate(context: ModeContext): void {
        // Initialize cursor layer
        this.initCursorLayer(context.map);

        // Auto zoom if needed (pixel is too small to operate)
        const currentZoom = context.map.getZoom();
        if (currentZoom !== undefined && currentZoom < 11) {
            const center = context.map.getCenter();
            if (center) {
                context.map.flyTo({
                    center: center,
                    zoom: 11,
                    duration: 500,
                });
            }
        }
    }

    deactivate(context: ModeContext): void {
        // Clean up cursor layer
        this.cleanupCursor(context.map);

        // Clean up state
        this.lastPos = null;
        this.drawingSession = null;
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        this.lastPos = e.lngLat;

        this.drawingSession = {
            baseMap: context.fogMap,
            modifiedBlocks: {},
            blockCounts: {},
            erasedArea: Bbox.fromPoint(e.lngLat),
        };

        // Initial interaction on press
        this.erasePixels(e.lngLat, context);
        context.onChange();
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        // Update cursor position
        this.updateCursor(context.map, e.lngLat, this.eraserSize);

        // If mouse button is pressed, continue erasing
        if (e.originalEvent.buttons === 1 && this.lastPos) {
            this.erasePixels(e.lngLat, context);
        }
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (this.drawingSession) {
            // Finalize the session
            if (this.drawingSession.erasedArea) {
                context.historyManager.append(
                    context.fogMap,
                    this.drawingSession.erasedArea
                );
            }
            this.drawingSession = null;
        }
        this.lastPos = null;
        context.onChange();
    }

    getCursorStyle(): string {
        return 'crosshair';
    }

    shouldDisableDragPan(): boolean {
        return true;
    }

    // Helper method to erase pixels
    private erasePixels(
        curPos: mapboxgl.LngLat,
        context: ModeContext
    ): void {
        if (!this.drawingSession || !this.lastPos) return;

        const [x0, y0] = fogMap.FogMap.LngLatToGlobalXY(this.lastPos.lng, this.lastPos.lat);
        const [x1, y1] = fogMap.FogMap.LngLatToGlobalXY(curPos.lng, curPos.lat);

        const TILE_WIDTH = fogMap.TILE_WIDTH;
        const BITMAP_WIDTH = fogMap.BITMAP_WIDTH;
        const BITMAP_WIDTH_OFFSET = fogMap.BITMAP_WIDTH_OFFSET;
        const ALL_OFFSET = fogMap.TILE_WIDTH_OFFSET + BITMAP_WIDTH_OFFSET;

        // Trace line
        const points = Array.from(fogMap.FogMap.traceLine(x0, y0, x1, y1));
        let changed = false;

        // Cache for block lookups
        let cachedTileKey = "";
        let cachedBlockKey = "";
        let cachedBlock: fogMap.Block | null | undefined = undefined;

        // Deduplication set
        const processedPixels = new Set<string>();

        const erasePixel = (gx: number, gy: number) => {
            // 1. Pixel Deduplication
            const pixelKey = gx + "," + gy;
            if (processedPixels.has(pixelKey)) {
                return;
            }
            processedPixels.add(pixelKey);

            // 2. Optimized Block Lookup
            const tileX = gx >> ALL_OFFSET;
            const tileY = gy >> ALL_OFFSET;
            const tileKey = fogMap.FogMap.makeKeyXY(tileX, tileY);

            const blockX = (gx >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
            const blockY = (gy >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
            const blockKey = fogMap.FogMap.makeKeyXY(blockX, blockY);

            // Check cache
            if (tileKey !== cachedTileKey || blockKey !== cachedBlockKey) {
                cachedTileKey = tileKey;
                cachedBlockKey = blockKey;
                cachedBlock = undefined; // Reset

                // Access the double-map
                if (this.drawingSession!.modifiedBlocks[tileKey]) {
                    cachedBlock = this.drawingSession!.modifiedBlocks[tileKey][blockKey];
                }
            }

            // Explicitly deleted check
            if (cachedBlock === null) return;

            if (cachedBlock === undefined) {
                // Not in modified blocks, check base map
                const tile = this.drawingSession!.baseMap.tiles[tileKey];
                const originalBlock = tile?.blocks[blockKey];

                if (!originalBlock) {
                    return;
                }

                // Create new mutable block
                const newBlock = fogMap.Block.create(blockX, blockY, originalBlock.dump());

                if (!this.drawingSession!.modifiedBlocks[tileKey]) {
                    this.drawingSession!.modifiedBlocks[tileKey] = {};
                    this.drawingSession!.blockCounts[tileKey] = {};
                }

                this.drawingSession!.modifiedBlocks[tileKey][blockKey] = newBlock;
                this.drawingSession!.blockCounts[tileKey][blockKey] = newBlock.count();

                // Update cache
                cachedBlock = newBlock;
            }

            // Now cachedBlock is guaranteed to be a Block object
            const block = cachedBlock as fogMap.Block;

            const localX = gx % BITMAP_WIDTH;
            const localY = gy % BITMAP_WIDTH;

            const bitOffset = 7 - (localX % 8);
            const i = Math.floor(localX / 8);
            const j = localY;
            const index = i + j * 8;

            // Check if pixel is currently ON
            const isSet = (block.bitmap[index] & (1 << bitOffset)) !== 0;

            if (isSet) {
                // Clear the bit
                block.bitmap[index] &= ~(1 << bitOffset);

                // Decrement count
                this.drawingSession!.blockCounts[tileKey][blockKey]--;

                // Check if block is empty
                if (this.drawingSession!.blockCounts[tileKey][blockKey] <= 0) {
                    this.drawingSession!.modifiedBlocks[tileKey][blockKey] = null;
                    cachedBlock = null; // Update cache to reflect deletion
                }

                // Mark as changed
                changed = true;
            }
        };

        // Circle eraser
        const eraseCircle = (points: [number, number][], eraserSize: number) => {
            const radius = eraserSize / 2;
            const radiusSquared = radius * radius;
            const offsetStart = eraserSize % 2 === 1 ? -Math.floor(radius) : -radius;
            const offsetEnd = Math.ceil(radius);

            for (const [x, y] of points) {
                for (let dx = offsetStart; dx < offsetEnd; dx++) {
                    for (let dy = offsetStart; dy < offsetEnd; dy++) {
                        if (dx * dx + dy * dy <= radiusSquared) {
                            erasePixel(x + dx, y + dy);
                        }
                    }
                }
            }
        };

        // Use circle eraser
        eraseCircle(points, this.eraserSize);

        // Calculate segmentBbox
        const segmentBbox = new Bbox(
            Math.min(this.lastPos.lng, curPos.lng),
            Math.min(this.lastPos.lat, curPos.lat),
            Math.max(this.lastPos.lng, curPos.lng),
            Math.max(this.lastPos.lat, curPos.lat)
        );

        if (changed) {
            const newMap = context.fogMap.updateBlocks(this.drawingSession.modifiedBlocks);

            if (this.drawingSession.erasedArea) {
                const b = this.drawingSession.erasedArea;
                this.drawingSession.erasedArea = new Bbox(
                    Math.min(b.west, segmentBbox.west),
                    Math.min(b.south, segmentBbox.south),
                    Math.max(b.east, segmentBbox.east),
                    Math.max(b.north, segmentBbox.north)
                );
            }

            context.updateFogMap(newMap, segmentBbox);
            this.lastPos = curPos;
        }
    }

    // Public method to set eraser size
    setEraserSize(size: number): void {
        this.eraserSize = size;
    }

    getEraserSize(): number {
        return this.eraserSize;
    }

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    // Initialize cursor layer
    private initCursorLayer(map: mapboxgl.Map): void {
        if (!map.getSource(this.layerId)) {
            map.addSource(this.layerId, {
                type: "geojson",
                data: {
                    type: "FeatureCollection",
                    features: []
                }
            });
            map.addLayer({
                id: this.layerId,
                type: "line",
                source: this.layerId,
                paint: {
                    "line-color": MapEraserUtils.LAYER_PAINT_STYLES.DEL_PIXEL_CURSOR.COLOR,
                    "line-width": MapEraserUtils.LAYER_PAINT_STYLES.DEL_PIXEL_CURSOR.WIDTH
                }
            });
        }
    }

    // Update cursor position and size
    private updateCursor(
        map: mapboxgl.Map,
        lngLat: mapboxgl.LngLat,
        eraserSize: number
    ): void {
        const source = map.getSource(this.layerId) as mapboxgl.GeoJSONSource;
        if (source) {
            const cursor = this.getCircleCursor(lngLat, eraserSize);
            source.setData({
                type: "Feature",
                geometry: cursor,
                properties: {},
            });
        }
    }

    // Generate circle cursor geometry
    private getCircleCursor(
        lngLat: mapboxgl.LngLat,
        eraserSize: number
    ): GeoJSON.Geometry {
        const [gx, gy] = fogMap.FogMap.LngLatToGlobalXY(lngLat.lng, lngLat.lat);
        const radius = eraserSize / 2;
        const centerOffset = eraserSize % 2 === 1 ? 0.5 : 0;

        const scale = fogMap.TILE_WIDTH * fogMap.BITMAP_WIDTH;

        const numPoints = 32;
        const coordinates: number[][] = [];

        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            const dx = Math.cos(angle) * radius;
            const dy = Math.sin(angle) * radius;

            const px = (gx + dx + centerOffset) / scale;
            const py = (gy + dy + centerOffset) / scale;

            const point = fogMap.Tile.XYToLngLat(px, py);
            coordinates.push([point[0], point[1]]);
        }

        return {
            type: "Polygon",
            coordinates: [coordinates]
        };
    }

    // Cleanup cursor layer
    private cleanupCursor(map: mapboxgl.Map): void {
        if (map.getLayer(this.layerId)) map.removeLayer(this.layerId);
        if (map.getSource(this.layerId)) map.removeSource(this.layerId);
    }
}

