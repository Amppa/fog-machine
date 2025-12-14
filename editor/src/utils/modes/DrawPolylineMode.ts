import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { MapDraw } from "../MapDraw";
import { Bbox } from "../CommonTypes";

const CURSOR_STYLE = "crosshair";

/**
 * DrawPolyline Mode
 * Allows user to draw polylines to reveal fog
 */
export class DrawPolylineMode implements ModeStrategy {
  private mapDraw: MapDraw | null = null;

  activate(context: ModeContext): void {
    // Create MapDraw instance when mode is activated
    this.mapDraw = new MapDraw(
      context.map,
      () => context.fogMap,
      context.updateFogMap
    );
    this.mapDraw.activate();
  }

  deactivate(_context: ModeContext): void {
    // Clean up MapDraw when mode is deactivated
    this.mapDraw?.deactivate();
    this.mapDraw = null;
  }

  handleMousePress(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
    // MapDraw handles all mouse events internally via @mapbox/mapbox-gl-draw
  }

  handleMouseMove(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
    // MapDraw handles all mouse events internally via @mapbox/mapbox-gl-draw
  }

  handleMouseRelease(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
    // MapDraw handles all mouse events internally via @mapbox/mapbox-gl-draw
  }

  getCursorStyle(): string {
    return CURSOR_STYLE;
  }

  canDragPan(): boolean {
    return false;
  }

  /**
   * DrawPolyline uses MapDraw which handles history internally
   * Return null to avoid duplicate history entries
   */
  getHistoryBbox(): Bbox | null {
    return null;
  }
}
