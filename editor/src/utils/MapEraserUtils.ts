import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { Bbox } from "./CommonTypes";

export interface DrawingSession {
    baseMap: fogMap.FogMap; // The state before drawing started
    modifiedBlocks: {
        [tileKey: string]: { [blockKey: string]: fogMap.Block | null };
    }; // Mutable Blocks
    blockCounts: { [tileKey: string]: { [blockKey: string]: number } };
    erasedArea: Bbox | null;
}

export interface PendingDeleteState {
    blocks: { [tileKey: string]: Set<string> };
    features: GeoJSON.Feature<GeoJSON.Polygon>[];
    bbox: Bbox | null;
}

export function updatePendingDeleteLayer(
    map: mapboxgl.Map | null,
    pendingFeatures: GeoJSON.Feature<GeoJSON.Polygon>[]
) {
    if (!map) return;
    const layerId = "pending-delete-layer";
    const sourceId = "pending-delete-layer";

    const data: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
        type: "FeatureCollection",
        features: pendingFeatures,
    };

    const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
        source.setData(data);
    } else {
        map.addSource(sourceId, {
            type: "geojson",
            data: data,
        });
        map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            paint: {
                "line-color": "#2200AA",
                "line-width": 2,
            },
        });
    }
}

export function updateDeleteBlockCursor(
    map: mapboxgl.Map | null,
    cursorRef: mapboxgl.Marker | null,
    lngLat: mapboxgl.LngLat
): mapboxgl.Marker | null {
    if (!map) return cursorRef;

    let marker: mapboxgl.Marker;

    if (!cursorRef) {
        const el = document.createElement('div');
        el.className = 'delete-block-cursor-dom'; // use css
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.border = '2px solid blue';
        el.style.backgroundColor = 'rgba(0, 0, 255, 0.2)';

        marker = new mapboxgl.Marker({
            element: el,
            anchor: 'center',
        })
            .setLngLat(lngLat)
            .addTo(map);

    } else {
        marker = cursorRef;
        marker.setLngLat(lngLat);
    }
    return marker;
}

export function handleDeleteBlockInteraction(
    map: mapboxgl.Map | null,
    fogMapInstance: fogMap.FogMap,
    pendingState: PendingDeleteState,
    lngLat: mapboxgl.LngLat
): { newState: PendingDeleteState; changed: boolean } {
    if (!map) return { newState: pendingState, changed: false };

    // Calculate bbox from 20px cursor logic
    const point = map.project(lngLat);
    const halfSize = 10;
    const nwPoint = new mapboxgl.Point(point.x - halfSize, point.y - halfSize);
    const sePoint = new mapboxgl.Point(point.x + halfSize, point.y + halfSize);

    const tnw = map.unproject(nwPoint);
    const tse = map.unproject(sePoint);

    // Construct bbox from the corner LngLats
    const west = Math.min(tnw.lng, tse.lng);
    const east = Math.max(tnw.lng, tse.lng);
    const north = Math.max(tnw.lat, tse.lat);
    const south = Math.min(tnw.lat, tse.lat);

    const bbox = new Bbox(west, south, east, north);

    const keys = fogMapInstance.getBlocks(bbox);
    const TILE_WIDTH = fogMap.TILE_WIDTH;
    let changed = false;

    // We should clone the state to avoid direct mutation if we want to be pure,
    // but for performance, we might mutate the sets inside...
    // Let's mutate the passed object's internals since it's a "Session" object essentially,
    // but let's return a "changed" flag.
    // Actually, let's just make sure we don't lose references.

    const pendingBlocks = pendingState.blocks;
    const pendingFeatures = pendingState.features; // This is an array, we push to it.
    let pendingBbox = pendingState.bbox;

    keys.forEach(({ tileKey, blockKey }) => {
        if (!pendingBlocks[tileKey]) {
            pendingBlocks[tileKey] = new Set();
        }
        if (!pendingBlocks[tileKey].has(blockKey)) {
            pendingBlocks[tileKey].add(blockKey);
            changed = true;

            const tile = fogMapInstance.tiles[tileKey];
            if (tile && tile.blocks[blockKey]) {
                const block = tile.blocks[blockKey];
                const x0 = tile.x + block.x / TILE_WIDTH;
                const y0 = tile.y + block.y / TILE_WIDTH;
                const x1 = tile.x + (block.x + 1) / TILE_WIDTH;
                const y1 = tile.y + (block.y + 1) / TILE_WIDTH;

                const nw = fogMap.Tile.XYToLngLat(x0, y0);
                const ne = fogMap.Tile.XYToLngLat(x1, y0);
                const se = fogMap.Tile.XYToLngLat(x1, y1);
                const sw = fogMap.Tile.XYToLngLat(x0, y1);

                const cnw = [nw[0], nw[1]];
                const cne = [ne[0], ne[1]];
                const cse = [se[0], se[1]];
                const csw = [sw[0], sw[1]];

                pendingFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "Polygon",
                        coordinates: [[cnw, csw, cse, cne, cnw]],
                    },
                    properties: {},
                });

                // Update pendingDeleteBbox
                const bWest = Math.min(nw[0], ne[0], se[0], sw[0]);
                const bEast = Math.max(nw[0], ne[0], se[0], sw[0]);
                const bNorth = Math.max(nw[1], ne[1], se[1], sw[1]);
                const bSouth = Math.min(nw[1], ne[1], se[1], sw[1]);

                if (!pendingBbox) {
                    pendingBbox = new Bbox(bWest, bSouth, bEast, bNorth);
                } else {
                    pendingBbox = new Bbox(
                        Math.min(pendingBbox.west, bWest),
                        Math.min(pendingBbox.south, bSouth),
                        Math.max(pendingBbox.east, bEast),
                        Math.max(pendingBbox.north, bNorth)
                    );
                }
            }
        }
    });

    return {
        newState: {
            blocks: pendingBlocks,
            features: pendingFeatures,
            bbox: pendingBbox,
        },
        changed,
    };
}

export function handleDeletePixelInteraction(
    fogMapInstance: fogMap.FogMap,
    drawingSession: DrawingSession,
    lastPos: mapboxgl.LngLat | null,
    currentPos: mapboxgl.LngLat
): {
    newMap: fogMap.FogMap; // The updated map (if changed)
    segmentBbox: Bbox; // The affected area of the scribble segment
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

    // Trace line
    const points = Array.from(fogMap.FogMap.traceLine(x0, y0, x1, y1));
    let changed = false;

    // Cache for block lookups
    let cachedTileKey = "";
    let cachedBlockKey = "";
    // The block can be:
    // - a Block object: valid block
    // - null: explicitly deleted block
    // - undefined: not yet loaded/checked
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
            if (drawingSession.modifiedBlocks[tileKey]) {
                cachedBlock = drawingSession.modifiedBlocks[tileKey][blockKey];
            }
        }

        // cacheBlock might still be undefined if it wasn't in modifiedBlocks,
        // OR it could be null (deleted) or Block.
        // If it is undefined, we need to check baseMap and possibly initialize it.

        // Explicitly deleted check
        if (cachedBlock === null) return;

        if (cachedBlock === undefined) {
            // Not in modified blocks, check base map
            const tile = drawingSession.baseMap.tiles[tileKey];
            const originalBlock = tile?.blocks[blockKey];

            if (!originalBlock) {
                // Doesn't exist in original, so effectively null.
                // We don't cache 'null' here because 'null' in modifiedBlocks means DELETED.
                // But here it just means 'nothing to erase'.
                // We can just return.
                // Since we didn't set cachedBlock to anything valid, next pixel in same block will hit here again.
                // We should probably mark it as 'empty-not-modified' but for now standard lookup is okay.
                return;
            }

            // Create new mutable block
            const newBlock = fogMap.Block.create(blockX, blockY, originalBlock.dump());

            if (!drawingSession.modifiedBlocks[tileKey]) {
                drawingSession.modifiedBlocks[tileKey] = {};
                drawingSession.blockCounts[tileKey] = {};
            }

            drawingSession.modifiedBlocks[tileKey][blockKey] = newBlock;
            drawingSession.blockCounts[tileKey][blockKey] = newBlock.count();

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
            drawingSession.blockCounts[tileKey][blockKey]--;

            // Check if block is empty
            if (drawingSession.blockCounts[tileKey][blockKey] <= 0) {
                drawingSession.modifiedBlocks[tileKey][blockKey] = null;
                cachedBlock = null; // Update cache to reflect deletion
            }

            // Mark as changed
            changed = true;
        }
    };

    const ERASER_SIZE = 8;
    const offsetStart = -Math.floor(ERASER_SIZE / 2); // -4
    const offsetEnd = Math.ceil(ERASER_SIZE / 2); // +4

    for (const [x, y] of points) {
        for (let dx = offsetStart; dx < offsetEnd; dx++) {
            for (let dy = offsetStart; dy < offsetEnd; dy++) {
                erasePixel(x + dx, y + dy);
            }
        }
    }

    // Calculate segmentBbox
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

export function finishEraserSession(
    drawingSession: DrawingSession
): { recordedBbox: Bbox | null } {
    // Finalize the session
    // We should already have the visual state in fogMap (baseMap + modifiedBlocks applied)
    // We just need to return the info needed for history.

    return {
        recordedBbox: drawingSession.erasedArea,
    };
}

export function cleanupDeleteBlockLayers(map: mapboxgl.Map | null) {
    if (!map) return;

    const cursorLayerId = "delete-block-cursor";
    if (map.getLayer(cursorLayerId)) map.removeLayer(cursorLayerId);
    if (map.getLayer(cursorLayerId + "-outline"))
        map.removeLayer(cursorLayerId + "-outline");
    if (map.getSource(cursorLayerId)) map.removeSource(cursorLayerId);

    const pendingLayerId = "pending-delete-layer";
    if (map.getLayer(pendingLayerId)) map.removeLayer(pendingLayerId);
    if (map.getSource(pendingLayerId)) map.removeSource(pendingLayerId);
}
