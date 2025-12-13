import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as fogMap from "../FogMap";

const CURSOR_STYLE = 'cell';

const DEL_BLOCK_CURSOR_STYLE = {
    SIZE: 20,
    BORDER_WIDTH: 2,
    BORDER_COLOR: '#000000',
} as const;

const LAYER_PAINT_STYLES = {
    DEL_BLOCK_PENDING: {
        COLOR: '#404040',
        WIDTH: 2,
    },
} as const;

interface DelBlockState {
    blocks: { [tileKey: string]: Set<string> };
    features: GeoJSON.Feature<GeoJSON.Polygon>[];
    bbox: Bbox | null;
}

/**
 * DelBlock Mode
 * Allows user to erase fog by clicking on blocks
 */
export class DelBlockMode implements ModeStrategy {
    private delBlockState: DelBlockState;
    private delBlockCursor: mapboxgl.Marker | null = null;
    private showGrid = false;

    constructor() {
        this.delBlockState = this.resetDelBlockState();
    }

    activate(context: ModeContext): void {
        this.showGrid = true;
        this.updateGridLayer(context);
        // DelBlock layers are initialized in MapController
    }

    deactivate(context: ModeContext): void {
        this.showGrid = false;
        this.updateGridLayer(context);
        // DelBlock layers are cleaned up in MapController
        this.delBlockState = this.resetDelBlockState();

        // Remove cursor marker
        if (this.delBlockCursor) {
            this.delBlockCursor.remove();
            this.delBlockCursor = null;
        }
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        this.delBlockState = this.resetDelBlockState();
        this.handleDelBlockInteraction(e.lngLat, context);
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (e.originalEvent.buttons === 1) {
            this.handleDelBlockInteraction(e.lngLat, context);
        }
        this.updateDelBlockCursor(e.lngLat, context);
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        const newMap = context.fogMap.removeBlocks(this.delBlockState.blocks);
        context.updateFogMap(newMap, this.delBlockState.bbox || "all", true);

        this.delBlockState = this.resetDelBlockState();
        this.updatePendingDelLayer(context.map);
    }

    getCursorStyle(): string {
        return CURSOR_STYLE;
    }

    canDragPan(): boolean {
        return false;
    }

    getHistoryBbox(): Bbox | null {
        return this.delBlockState.bbox;
    }

    /**
     * Handle block interaction (erase blocks)
     */
    private handleDelBlockInteraction(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        const map = context.map;
        const fogMapInstance = context.fogMap;

        // Calculate bbox from cursor size
        const point = map.project(lngLat);
        const halfSize = DEL_BLOCK_CURSOR_STYLE.SIZE / 2;
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

        const pendingBlocks = this.delBlockState.blocks;
        const pendingFeatures = this.delBlockState.features;
        let pendingBbox = this.delBlockState.bbox;

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

        this.delBlockState = {
            blocks: pendingBlocks,
            features: pendingFeatures,
            bbox: pendingBbox,
        };

        if (changed) {
            this.updatePendingDelLayer(context.map);
        }
    }

    /**
     * Update the block cursor position
     */
    private updateDelBlockCursor(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        const map = context.map;

        if (!this.delBlockCursor) {
            const el = document.createElement('div');
            el.className = 'delete-block-cursor-dom';
            el.style.width = `${DEL_BLOCK_CURSOR_STYLE.SIZE}px`;
            el.style.height = `${DEL_BLOCK_CURSOR_STYLE.SIZE}px`;
            el.style.border = `${DEL_BLOCK_CURSOR_STYLE.BORDER_WIDTH}px solid ${DEL_BLOCK_CURSOR_STYLE.BORDER_COLOR}`;

            this.delBlockCursor = new mapboxgl.Marker({
                element: el,
                anchor: 'center',
            })
                .setLngLat(lngLat)
                .addTo(map);
        } else {
            this.delBlockCursor.setLngLat(lngLat);
        }
    }

    /**
     * Update grid layer visibility
     */
    private updateGridLayer(context: ModeContext): void {
        context.gridRenderer.update(
            context.map,
            context.fogMap,
            this.showGrid
        );
    }

    /**
     * Update pending delete layer
     */
    private updatePendingDelLayer(map: mapboxgl.Map): void {
        const layerId = "pending-delete-layer";
        const sourceId = "pending-delete-layer";

        const data: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
            type: "FeatureCollection",
            features: this.delBlockState.features,
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
                    "line-color": LAYER_PAINT_STYLES.DEL_BLOCK_PENDING.COLOR,
                    "line-width": LAYER_PAINT_STYLES.DEL_BLOCK_PENDING.WIDTH,
                },
            });
        }
    }

    private resetDelBlockState(): DelBlockState {
        return {
            blocks: {},
            features: [],
            bbox: null,
        };
    }
}
