import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as fogMap from "../FogMap";


const CURSOR_STYLE = 'crosshair';
const DEFAULT_DEL_PIXEL_SIZE = 5;
const AUTO_ZOOM_LEVEL = 11;

const LAYER_IDS = {
    DEL_PIXEL_CURSOR: 'del-pixel-cursor',
} as const;

const LAYER_PAINT_STYLES = {
    DEL_PIXEL_CURSOR: {
        COLOR: '#000000',
        WIDTH: 2,
    },
} as const;


export interface DrawingSession {
    baseMap: fogMap.FogMap;
    modifiedBlocks: {
        [tileKey: string]: { [blockKey: string]: fogMap.Block | null };
    };
    blockCounts: { [tileKey: string]: { [blockKey: string]: number } };
    erasedArea: Bbox | null;
}


function getSquareCursor(
    lngLat: mapboxgl.LngLat,
    pixelSize: number
): GeoJSON.Geometry {
    const [gx, gy] = fogMap.FogMap.LngLatToGlobalXY(lngLat.lng, lngLat.lat);
    const half = pixelSize / 2;
    const centerOffset = pixelSize % 2 === 1 ? 0.5 : 0;
    const gx1 = gx - half + centerOffset;
    const gx2 = gx + half + centerOffset;
    const gy1 = gy - half + centerOffset;
    const gy2 = gy + half + centerOffset;

    const scale = fogMap.TILE_WIDTH * fogMap.BITMAP_WIDTH;

    const x1 = gx1 / scale;
    const y1 = gy1 / scale;
    const x2 = gx2 / scale;
    const y2 = gy2 / scale;

    const nw = fogMap.Tile.XYToLngLat(x1, y1);
    const ne = fogMap.Tile.XYToLngLat(x2, y1);
    const se = fogMap.Tile.XYToLngLat(x2, y2);
    const sw = fogMap.Tile.XYToLngLat(x1, y2);

    return {
        type: "Polygon",
        coordinates: [[
            [nw[0], nw[1]],
            [ne[0], ne[1]],
            [se[0], se[1]],
            [sw[0], sw[1]],
            [nw[0], nw[1]]
        ]]
    };
}

function getCircleCursor(
    lngLat: mapboxgl.LngLat,
    pixelSize: number
): GeoJSON.Geometry {
    const [gx, gy] = fogMap.FogMap.LngLatToGlobalXY(lngLat.lng, lngLat.lat);
    const radius = pixelSize / 2;
    const centerOffset = pixelSize % 2 === 1 ? 0.5 : 0;

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

function getDelPixelCursor(
    lngLat: mapboxgl.LngLat,
    pixelSize: number
): GeoJSON.Geometry {
    return getCircleCursor(lngLat, pixelSize);
}


function initDelPixelCursorLayer(
    map: mapboxgl.Map | null,
    layerId: string
) {
    if (!map) return;
    if (!map.getSource(layerId)) {
        map.addSource(layerId, {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features: []
            }
        });
        map.addLayer({
            id: layerId,
            type: "line",
            source: layerId,
            paint: {
                "line-color": LAYER_PAINT_STYLES.DEL_PIXEL_CURSOR.COLOR,
                "line-width": LAYER_PAINT_STYLES.DEL_PIXEL_CURSOR.WIDTH
            }
        });
    }
}

function updateDelPixelCursorLayer(
    map: mapboxgl.Map | null,
    layerId: string,
    lngLat: mapboxgl.LngLat,
    pixelSize: number
): void {
    if (!map) return;
    const source = map.getSource(layerId) as mapboxgl.GeoJSONSource;
    if (source) {
        const cursor = getDelPixelCursor(lngLat, pixelSize);
        source.setData({
            type: "Feature",
            geometry: cursor,
            properties: {},
        });
    }
}

function cleanupDelPixelLayer(map: mapboxgl.Map | null, layerId: string) {
    if (!map) return;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(layerId)) map.removeSource(layerId);
}


function handleDelPixelInteraction(
    fogMapInstance: fogMap.FogMap,
    drawingSession: DrawingSession,
    lastPos: mapboxgl.LngLat | null,
    currentPos: mapboxgl.LngLat,
    eraserSize: number
): {
    newMap: fogMap.FogMap;
    segmentBbox: Bbox;
    changed: boolean;
} | null {
    if (!lastPos || !drawingSession) return null;

    const [x0, y0] = fogMap.FogMap.LngLatToGlobalXY(lastPos.lng, lastPos.lat);
    const [x1, y1] = fogMap.FogMap.LngLatToGlobalXY(
        currentPos.lng,
        currentPos.lat
    );

    const TILE_WIDTH = fogMap.TILE_WIDTH;
    const BITMAP_WIDTH = fogMap.BITMAP_WIDTH;
    const BITMAP_WIDTH_OFFSET = fogMap.BITMAP_WIDTH_OFFSET;
    const ALL_OFFSET = fogMap.TILE_WIDTH_OFFSET + BITMAP_WIDTH_OFFSET;


    const points = Array.from(fogMap.FogMap.traceLine(x0, y0, x1, y1));
    let changed = false;


    let cachedTileKey = "";
    let cachedBlockKey = "";
    let cachedBlock: fogMap.Block | null | undefined = undefined;


    const processedPixels = new Set<string>();

    const erasePixel = (gx: number, gy: number) => {

        const pixelKey = gx + "," + gy;
        if (processedPixels.has(pixelKey)) {
            return;
        }
        processedPixels.add(pixelKey);


        const tileX = gx >> ALL_OFFSET;
        const tileY = gy >> ALL_OFFSET;
        const tileKey = fogMap.FogMap.makeKeyXY(tileX, tileY);

        const blockX = (gx >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
        const blockY = (gy >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
        const blockKey = fogMap.FogMap.makeKeyXY(blockX, blockY);


        if (tileKey !== cachedTileKey || blockKey !== cachedBlockKey) {
            cachedTileKey = tileKey;
            cachedBlockKey = blockKey;
            cachedBlock = undefined;

            if (drawingSession.modifiedBlocks[tileKey]) {
                cachedBlock = drawingSession.modifiedBlocks[tileKey][blockKey];
            }
        }


        if (cachedBlock === null) return;

        if (cachedBlock === undefined) {
            const tile = drawingSession.baseMap.tiles[tileKey];
            const originalBlock = tile?.blocks[blockKey];

            if (!originalBlock) {
                return;
            }


            const newBlock = fogMap.Block.create(blockX, blockY, originalBlock.dump());

            if (!drawingSession.modifiedBlocks[tileKey]) {
                drawingSession.modifiedBlocks[tileKey] = {};
                drawingSession.blockCounts[tileKey] = {};
            }

            drawingSession.modifiedBlocks[tileKey][blockKey] = newBlock;
            drawingSession.blockCounts[tileKey][blockKey] = newBlock.count();

            cachedBlock = newBlock;
        }

        const block = cachedBlock as fogMap.Block;

        const localX = gx % BITMAP_WIDTH;
        const localY = gy % BITMAP_WIDTH;

        const bitOffset = 7 - (localX % 8);
        const i = Math.floor(localX / 8);
        const j = localY;
        const index = i + j * 8;


        const isSet = (block.bitmap[index] & (1 << bitOffset)) !== 0;

        if (isSet) {

            block.bitmap[index] &= ~(1 << bitOffset);


            drawingSession.blockCounts[tileKey][blockKey]--;


            if (drawingSession.blockCounts[tileKey][blockKey] <= 0) {
                drawingSession.modifiedBlocks[tileKey][blockKey] = null;
                cachedBlock = null;
            }

            changed = true;
        }
    };


    const eraseCircle = (points: [number, number][], size: number) => {
        const radius = size / 2;
        const radiusSquared = radius * radius;
        const offsetStart = -Math.floor(radius);
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

    eraseCircle(points, eraserSize);


    const segmentBbox = new Bbox(
        Math.min(lastPos.lng, currentPos.lng),
        Math.min(lastPos.lat, currentPos.lat),
        Math.max(lastPos.lng, currentPos.lng),
        Math.max(lastPos.lat, currentPos.lat)
    );

    if (changed) {
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

        return {
            newMap: newMap,
            segmentBbox: segmentBbox,
            changed: true,
        };
    } else {
        return {
            newMap: fogMapInstance,
            segmentBbox: segmentBbox,
            changed: false,
        };
    }
}


export class DelPixelMode implements ModeStrategy {
    private lastPos: mapboxgl.LngLat | null = null;
    private eraserStrokeBbox: Bbox | null = null;
    private drawingSession: DrawingSession | null = null;
    private earserSize = DEFAULT_DEL_PIXEL_SIZE;
    private delPixelCursorLayerId = LAYER_IDS.DEL_PIXEL_CURSOR;

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


        initDelPixelCursorLayer(context.map, this.delPixelCursorLayerId);
    }

    deactivate(context: ModeContext): void {
        cleanupDelPixelLayer(context.map, this.delPixelCursorLayerId);
        this.lastPos = null;
        this.eraserStrokeBbox = null;
        this.drawingSession = null;
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        context.map.dragPan.disable();
        this.lastPos = e.lngLat;
        this.eraserStrokeBbox = Bbox.fromPoint(e.lngLat);

        this.drawingSession = {
            baseMap: context.fogMap,
            modifiedBlocks: {},
            blockCounts: {},
            erasedArea: Bbox.fromPoint(e.lngLat),
        };


        this.handleDelPixelInteraction(e.lngLat, context);
        context.onChange();
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        updateDelPixelCursorLayer(
            context.map,
            this.delPixelCursorLayerId,
            e.lngLat,
            this.earserSize
        );

        if (e.originalEvent.buttons === 1 && this.lastPos) {
            this.handleDelPixelInteraction(e.lngLat, context);
        }
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {

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


    private handleDelPixelInteraction(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        if (!this.lastPos || !this.drawingSession) return;

        const result = handleDelPixelInteraction(
            context.fogMap,
            this.drawingSession,
            this.lastPos,
            lngLat,
            this.earserSize
        );

        this.lastPos = lngLat;

        if (result && result.changed) {
            context.updateFogMap(result.newMap, result.segmentBbox, true, true);
        }
    }


    setDelPixelSize(size: number): void {
        this.earserSize = size;
    }


    getDelPixelSize(): number {
        return this.earserSize;
    }
}
