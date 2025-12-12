import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { MapDraw } from "../MapDraw";

const CURSOR_STYLE = 'crosshair';

/**
 * DrawPolyline Mode
 * Allows user to draw polylines to reveal fog
 */
export class DrawPolylineMode implements ModeStrategy {
    private mapDraw: MapDraw | null = null;

    activate(context: ModeContext): void {
        // MapDraw will be initialized in MapController
        if (!this.mapDraw) {
            console.error('[DrawPolylineMode] MapDraw is not initialized. Call setMapDraw() before activating this mode.');
            return;
        }
        this.mapDraw.activate();
    }

    deactivate(_context: ModeContext): void {
        this.mapDraw?.deactivate();
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

    shouldDisableDragPan(): boolean {
        return true;
    }

    /**
     * Set the MapDraw instance
     * This is called from MapController after MapDraw is initialized
     */
    setMapDraw(mapDraw: MapDraw): void {
        this.mapDraw = mapDraw;
    }
}
