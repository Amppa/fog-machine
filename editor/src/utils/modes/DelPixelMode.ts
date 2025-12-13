import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as fogMap from "../FogMap";

const CURSOR_STYLE = 'crosshair';
const DEFAULT_DEL_PIXEL_SIZE = 5;
const AUTO_ZOOM_LEVEL = 11;

const DEL_PIXEL_CURSOR_STYLE = {
    BORDER_WIDTH: 2,
    BORDER_COLOR: '#000000',
} as const;

export interface DrawingSession {
    baseMap: fogMap.FogMap;
    modifiedBlocks: {
        [tileKey: string]: { [blockKey: string]: fogMap.Block | null };
    };
    blockCounts: { [tileKey: string]: { [blockKey: string]: number } };
    erasedArea: Bbox | null;
}

class PixelEraser {
    private cachedTileKey = "";
    private cachedBlockKey = "";
    private cachedBlock: fogMap.Block | null | undefined = undefined;
    private processedPixels = new Set<string>();
    private changed = false;

    constructor(
        private drawingSession: DrawingSession,
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

    eraseCircle(points: [number, number][], size: number): void {
        const radius = size / 2;
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

export class DelPixelMode implements ModeStrategy {
    private lastPos: mapboxgl.LngLat | null = null;
    private eraserStrokeBbox: Bbox | null = null;
    private drawingSession: DrawingSession | null = null;
    private eraserSize = DEFAULT_DEL_PIXEL_SIZE;
    private eraserCursor: mapboxgl.Marker | null = null;
    private isDrawing = false;

    activate(context: ModeContext): void {
        const currentZoom = context.map.getZoom();
        if (currentZoom < AUTO_ZOOM_LEVEL) {
            const center = context.map.getCenter();
            context.map.flyTo({
                zoom: AUTO_ZOOM_LEVEL,
                center: [center.lng, center.lat],
                essential: true,
            });
        }
    }

    deactivate(context: ModeContext): void {
        this.lastPos = null;
        this.eraserStrokeBbox = null;
        this.drawingSession = null;

        if (this.eraserCursor) {
            this.eraserCursor.remove();
            this.eraserCursor = null;
        }
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        this.isDrawing = true;
        context.map.dragPan.disable();
        this.lastPos = e.lngLat;
        this.eraserStrokeBbox = Bbox.fromPoint(e.lngLat);

        this.drawingSession = {
            baseMap: context.fogMap,
            modifiedBlocks: {},
            blockCounts: {},
            erasedArea: Bbox.fromPoint(e.lngLat),
        };

        this.applyEraserStroke(e.lngLat, context);
        context.onChange();
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        this.updateDelPixelCursor(e.lngLat, context.map);

        if (e.originalEvent.buttons === 1 && this.lastPos) {
            this.applyEraserStroke(e.lngLat, context);
        }
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        this.isDrawing = false;
        console.log('[DelPixelMode] Mouse released, isDrawing:', this.isDrawing);
        this.lastPos = null;
        context.onChange();
        context.map.dragPan.enable();
    }

    getCursorStyle(): string {
        return CURSOR_STYLE;
    }

    canDragPan(): boolean {
        return false;
    }

    getHistoryBbox(): Bbox | null {
        const bbox = this.drawingSession?.erasedArea || null;
        this.drawingSession = null;
        return bbox;
    }

    setDelPixelSize(size: number): void {
        this.eraserSize = size;
    }

    getDelPixelSize(): number {
        return this.eraserSize;
    }

    getIsDrawing(): boolean {
        return this.isDrawing;
    }

    private updateDelPixelCursor(lngLat: mapboxgl.LngLat, map: mapboxgl.Map): void {
        if (!this.eraserCursor) {
            const size = this.calculateCursorSize(map);
            const el = document.createElement('div');
            el.className = 'delete-pixel-cursor-dom';
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.style.border = `${DEL_PIXEL_CURSOR_STYLE.BORDER_WIDTH}px solid ${DEL_PIXEL_CURSOR_STYLE.BORDER_COLOR}`;
            el.style.borderRadius = '50%';
            el.style.pointerEvents = 'none';

            this.eraserCursor = new mapboxgl.Marker({
                element: el,
                anchor: 'center',
            })
                .setLngLat(lngLat)
                .addTo(map);
        } else {
            this.eraserCursor.setLngLat(lngLat);

            // Update size if zoom changed
            const size = this.calculateCursorSize(map);
            const el = this.eraserCursor.getElement();
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
        }
    }

    private calculateCursorSize(map: mapboxgl.Map): number {
        // Calculate pixel size in screen coordinates
        const center = map.getCenter();
        const [gx, gy] = fogMap.FogMap.LngLatToGlobalXY(center.lng, center.lat);
        const radius = this.eraserSize / 2;

        const scale = fogMap.TILE_WIDTH * fogMap.BITMAP_WIDTH;
        const px1 = (gx - radius) / scale;
        const px2 = (gx + radius) / scale;

        const lng1 = fogMap.Tile.XYToLngLat(px1, gy / scale)[0];
        const lng2 = fogMap.Tile.XYToLngLat(px2, gy / scale)[0];

        const point1 = map.project(new mapboxgl.LngLat(lng1, center.lat));
        const point2 = map.project(new mapboxgl.LngLat(lng2, center.lat));

        return Math.abs(point2.x - point1.x);
    }

    private applyEraserStroke(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        if (!this.lastPos || !this.drawingSession) return;

        const result = processEraserStroke(
            context.fogMap,
            this.drawingSession,
            this.lastPos,
            lngLat,
            this.eraserSize
        );

        this.lastPos = lngLat;

        if (result && result.changed) {
            context.updateFogMap(result.newMap, result.segmentBbox, true, true);
        }
    }
}

function processEraserStroke(
    fogMapInstance: fogMap.FogMap,
    drawingSession: DrawingSession,
    lastPos: mapboxgl.LngLat | null,
    curPos: mapboxgl.LngLat,
    eraserSize: number
): {
    newMap: fogMap.FogMap;
    segmentBbox: Bbox;
    changed: boolean;
} | null {
    if (!lastPos || !drawingSession) return null;

    const [x0, y0] = fogMap.FogMap.LngLatToGlobalXY(lastPos.lng, lastPos.lat);
    const [x1, y1] = fogMap.FogMap.LngLatToGlobalXY(curPos.lng, curPos.lat);

    const constants = {
        TILE_WIDTH: fogMap.TILE_WIDTH,
        BITMAP_WIDTH: fogMap.BITMAP_WIDTH,
        BITMAP_WIDTH_OFFSET: fogMap.BITMAP_WIDTH_OFFSET,
        ALL_OFFSET: fogMap.TILE_WIDTH_OFFSET + fogMap.BITMAP_WIDTH_OFFSET,
    };

    const points = Array.from(fogMap.FogMap.traceLine(x0, y0, x1, y1));
    const eraser = new PixelEraser(drawingSession, constants);
    eraser.eraseCircle(points, eraserSize);

    const segmentBbox = new Bbox(
        Math.min(lastPos.lng, curPos.lng),
        Math.min(lastPos.lat, curPos.lat),
        Math.max(lastPos.lng, curPos.lng),
        Math.max(lastPos.lat, curPos.lat)
    );

    if (eraser.hasChanged()) {
        const newMap = fogMapInstance.updateBlocks(drawingSession.modifiedBlocks);

        if (drawingSession.erasedArea) {
            const b = drawingSession.erasedArea;
            drawingSession.erasedArea = new Bbox(
                Math.min(b.west, segmentBbox.west),
                Math.min(b.south, segmentBbox.south),
                Math.max(b.east, segmentBbox.east),
                Math.max(b.north, segmentBbox.north)
            );
        }

        return { newMap, segmentBbox, changed: true };
    }

    return { newMap: fogMapInstance, segmentBbox, changed: false };
}
