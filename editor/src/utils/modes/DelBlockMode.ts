import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as fogMap from "../FogMap";

const CURSOR_STYLE = "cell";
const MIN_ZOOM_FOR_BLOCKS = 6;

const DEL_BLOCK_CURSOR_STYLE = {
  SIZE: 20,
  BORDER_WIDTH: 2,
  BORDER_COLOR: "#000000",
} as const;

const LAYER_PAINT_STYLES = {
  DEL_BLOCK_PENDING: {
    COLOR: "#404040",
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

  constructor() {
    this.delBlockState = this.resetDelBlockState();
  }

  activate(context: ModeContext): void {
    // Auto-zoom to level 6 if current zoom is too low to see blocks clearly

    context.ensureMinZoomLevel(MIN_ZOOM_FOR_BLOCKS);
    // DelBlock layers are initialized in MapController
  }

  deactivate(context: ModeContext): void {
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
    this.processBlockErasure(e.lngLat, context);
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
    if (e.originalEvent.buttons === 1) {
      this.processBlockErasure(e.lngLat, context);
    }
    this.updateDelBlockCursor(e.lngLat, context);
  }

  handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {
    const newMap = context.fogMap.removeBlocks(this.delBlockState.blocks);
    const bboxForHistory = this.delBlockState.bbox;

    context.updateFogMap(newMap, bboxForHistory || "all");

    this.delBlockState = this.resetDelBlockState();
    this.updatePendingDelLayer(context.map);

    // Store bbox for history (will be read by ModeManager)
    this.delBlockState.bbox = bboxForHistory;
  }

  getCursorStyle(): string {
    return CURSOR_STYLE;
  }

  canDragPan(): boolean {
    return false;
  }

  getHistoryBbox(): Bbox | null {
    const bbox = this.delBlockState.bbox;
    this.delBlockState.bbox = null; // Clear after reading
    return bbox;
  }

  /**
   * Process block erasure at cursor position
   */
  private processBlockErasure(lngLat: mapboxgl.LngLat, context: ModeContext): void {
    const bbox = this.getCursorBbox(lngLat, context.map);
    const keys = context.fogMap.getBlocks(bbox);

    let changed = false;
    const pendingBlocks = this.delBlockState.blocks;
    const pendingFeatures = this.delBlockState.features;
    let pendingBbox = this.delBlockState.bbox;

    keys.forEach(({ tileKey, blockKey }) => {
      if (this.addBlockToPending(tileKey, blockKey, pendingBlocks)) {
        changed = true;
        const blockPolygon = this.createBlockPolygon(tileKey, blockKey, context.fogMap);

        if (blockPolygon) {
          pendingFeatures.push(blockPolygon.feature);
          pendingBbox = this.expandPendingBbox(pendingBbox, blockPolygon.bbox);
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
   * Calculate bbox from cursor position and size
   */
  private getCursorBbox(lngLat: mapboxgl.LngLat, map: mapboxgl.Map): Bbox {
    const point = map.project(lngLat);
    const halfSize = DEL_BLOCK_CURSOR_STYLE.SIZE / 2;

    const nwPoint = new mapboxgl.Point(point.x - halfSize, point.y - halfSize);
    const sePoint = new mapboxgl.Point(point.x + halfSize, point.y + halfSize);

    const nw = map.unproject(nwPoint);
    const se = map.unproject(sePoint);

    return new Bbox(
      Math.min(nw.lng, se.lng),
      Math.min(nw.lat, se.lat),
      Math.max(nw.lng, se.lng),
      Math.max(nw.lat, se.lat)
    );
  }

  /**
   * Add block to pending deletion set
   * @returns true if block was newly added, false if already exists
   */
  private addBlockToPending(
    tileKey: string,
    blockKey: string,
    pendingBlocks: { [tileKey: string]: Set<string> }
  ): boolean {
    if (!pendingBlocks[tileKey]) {
      pendingBlocks[tileKey] = new Set();
    }

    if (pendingBlocks[tileKey].has(blockKey)) {
      return false;
    }

    pendingBlocks[tileKey].add(blockKey);
    return true;
  }

  /**
   * Create polygon feature for a block
   */
  private createBlockPolygon(
    tileKey: string,
    blockKey: string,
    fogMapInstance: fogMap.FogMap
  ): { feature: GeoJSON.Feature<GeoJSON.Polygon>; bbox: Bbox } | null {
    const tile = fogMapInstance.tiles[tileKey];
    if (!tile || !tile.blocks[blockKey]) {
      return null;
    }

    const block = tile.blocks[blockKey];
    const TILE_WIDTH = fogMap.TILE_WIDTH;

    const x0 = tile.x + block.x / TILE_WIDTH;
    const y0 = tile.y + block.y / TILE_WIDTH;
    const x1 = tile.x + (block.x + 1) / TILE_WIDTH;
    const y1 = tile.y + (block.y + 1) / TILE_WIDTH;

    const nw = fogMap.Tile.XYToLngLat(x0, y0);
    const ne = fogMap.Tile.XYToLngLat(x1, y0);
    const se = fogMap.Tile.XYToLngLat(x1, y1);
    const sw = fogMap.Tile.XYToLngLat(x0, y1);

    const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [nw[0], nw[1]],
            [sw[0], sw[1]],
            [se[0], se[1]],
            [ne[0], ne[1]],
            [nw[0], nw[1]],
          ],
        ],
      },
      properties: {},
    };

    const bbox = new Bbox(
      Math.min(nw[0], ne[0], se[0], sw[0]),
      Math.min(nw[1], ne[1], se[1], sw[1]),
      Math.max(nw[0], ne[0], se[0], sw[0]),
      Math.max(nw[1], ne[1], se[1], sw[1])
    );

    return { feature, bbox };
  }

  private expandPendingBbox(curBbox: Bbox | null, newBbox: Bbox): Bbox {
    if (!curBbox) {
      return newBbox;
    }

    return new Bbox(
      Math.min(curBbox.west, newBbox.west),
      Math.min(curBbox.south, newBbox.south),
      Math.max(curBbox.east, newBbox.east),
      Math.max(curBbox.north, newBbox.north)
    );
  }

  /**
   * Update the block cursor position
   */
  private updateDelBlockCursor(curLngLat: mapboxgl.LngLat, context: ModeContext): void {
    const map = context.map;

    if (!this.delBlockCursor) {
      const el = document.createElement("div");
      el.className = "delete-block-cursor-dom";
      el.style.width = `${DEL_BLOCK_CURSOR_STYLE.SIZE}px`;
      el.style.height = `${DEL_BLOCK_CURSOR_STYLE.SIZE}px`;
      el.style.border = `${DEL_BLOCK_CURSOR_STYLE.BORDER_WIDTH}px solid ${DEL_BLOCK_CURSOR_STYLE.BORDER_COLOR}`;

      this.delBlockCursor = new mapboxgl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat(curLngLat)
        .addTo(map);
    } else {
      this.delBlockCursor.setLngLat(curLngLat);
    }
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
