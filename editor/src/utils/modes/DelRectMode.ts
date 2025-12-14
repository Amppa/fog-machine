import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";

// DelRect-specific constants
const DEL_RECT_STYLE = {
  COLOR: "#969696",
  FILL_OPACITY: 0.5,
  LINE_WIDTH: 1,
} as const;

const LAYER_IDS = {
  DEL_RECT: "del-rect",
  DEL_RECT_OUTLINE: "del-rect-outline",
} as const;

/**
 * DelRect Mode (Rectangle Eraser)
 * Allows user to draw a rectangle to erase fog
 */
export class DelRectMode implements ModeStrategy {
  private eraserArea: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null = null;
  private lastOperationBbox: Bbox | null = null;

  activate(context: ModeContext): void {
    this.setVisibility(context.map, true);
  }

  deactivate(context: ModeContext): void {
    this.setVisibility(context.map, false);
    this.eraserArea = null;
    this.lastOperationBbox = null;
  }

  handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
    if (!this.eraserArea) {
      const eraserSource = context.map.getSource(LAYER_IDS.DEL_RECT) as mapboxgl.GeoJSONSource | null;

      if (eraserSource) {
        const startPoint = new mapboxgl.LngLat(e.lngLat.lng, e.lngLat.lat);
        this.eraserArea = [startPoint, eraserSource];
      }
    }
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
    if (!this.eraserArea) return;
    const [startPoint, eraserSource] = this.eraserArea;
    const bounds = Bbox.fromTwoPoints(e.lngLat, startPoint);

    eraserSource.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [bounds.east, bounds.north],
            [bounds.west, bounds.north],
            [bounds.west, bounds.south],
            [bounds.east, bounds.south],
            [bounds.east, bounds.north],
          ],
        ],
      },
    });
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
    if (!this.eraserArea) return;
    const [startPoint, eraserSource] = this.eraserArea;
    const bounds = Bbox.fromTwoPoints(e.lngLat, startPoint);

    // Clear visual rectangle
    eraserSource.setData(this.createEmptyFeature());

    // Erase fog, skip history (will be saved by ModeManager)
    const newMap = context.fogMap.clearBbox(bounds);
    context.updateFogMap(newMap, bounds, true); // skipHistory = true

    // Save bbox for history
    this.lastOperationBbox = bounds;
    this.eraserArea = null;
  }

  getCursorStyle(): string {
    return "cell";
  }

  canDragPan(): boolean {
    return false;
  }

  /**
   * Get the bounding box of the erased rectangle for history
   */
  getHistoryBbox(): Bbox | null {
    const bbox = this.lastOperationBbox;
    this.lastOperationBbox = null; // Clear after reading
    return bbox;
  }

  /**
   * Initialize DelRect layers on the map
   * Should be called once during map initialization
   */
  static initLayers(map: mapboxgl.Map): void {
    map.addSource(LAYER_IDS.DEL_RECT, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[]],
        },
      },
    });

    map.addLayer({
      id: LAYER_IDS.DEL_RECT,
      type: "fill",
      source: LAYER_IDS.DEL_RECT,
      layout: {
        visibility: "none",
      },
      paint: {
        "fill-color": DEL_RECT_STYLE.COLOR,
        "fill-opacity": DEL_RECT_STYLE.FILL_OPACITY,
      },
    });

    map.addLayer({
      id: LAYER_IDS.DEL_RECT_OUTLINE,
      type: "line",
      source: LAYER_IDS.DEL_RECT,
      layout: {
        visibility: "none",
      },
      paint: {
        "line-color": DEL_RECT_STYLE.COLOR,
        "line-width": DEL_RECT_STYLE.LINE_WIDTH,
      },
    });
  }

  /**
   * Create an empty GeoJSON feature
   */
  private createEmptyFeature(): GeoJSON.Feature<GeoJSON.Polygon> {
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[]],
      },
    };
  }

  /**
   * Set visibility of DelRect layers
   */
  private setVisibility(map: mapboxgl.Map, visible: boolean): void {
    const visibility = visible ? "visible" : "none";

    if (map.getLayer(LAYER_IDS.DEL_RECT)) {
      map.setLayoutProperty(LAYER_IDS.DEL_RECT, "visibility", visibility);
    }
    if (map.getLayer(LAYER_IDS.DEL_RECT_OUTLINE)) {
      map.setLayoutProperty(LAYER_IDS.DEL_RECT_OUTLINE, "visibility", visibility);
    }
  }
}
