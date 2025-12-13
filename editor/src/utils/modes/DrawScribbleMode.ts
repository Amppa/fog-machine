import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";

const CURSOR_STYLE = 'crosshair';

/**
 * DrawScribble Mode
 * Allows user to draw freehand scribbles to reveal fog
 */
export class DrawScribbleMode implements ModeStrategy {
    private lastPos: mapboxgl.LngLat | null = null;
    private strokeBbox: Bbox | null = null;

    activate(_context: ModeContext): void {
        // No special activation needed
    }

    deactivate(context: ModeContext): void {
        this.lastPos = null;
        this.strokeBbox = null;
        // Re-enable drag pan
        context.map.dragPan.enable();
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        context.map.dragPan.disable();
        this.lastPos = e.lngLat;
        this.strokeBbox = Bbox.fromPoint(e.lngLat);
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (!this.lastPos) return;

        const currentPos = e.lngLat;
        const newMap = context.fogMap.addLine(
            this.lastPos.lng,
            this.lastPos.lat,
            currentPos.lng,
            currentPos.lat
        );

        const segmentBbox = Bbox.fromTwoPoints(this.lastPos, currentPos);

        if (this.strokeBbox) {
            this.strokeBbox = Bbox.merge(this.strokeBbox, segmentBbox);
        }

        // Skip history during drawing, we'll save the entire stroke on mouse release
        context.updateFogMap(newMap, segmentBbox, true);
        this.lastPos = currentPos;
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        // Clean up state, history will be saved by ModeManager
        this.lastPos = null;
        // Don't clear strokeBbox yet, ModeManager will read it via getHistoryBbox
    }

    getCursorStyle(): string {
        return CURSOR_STYLE;
    }

    canDragPan(): boolean {
        return false;
    }

    getHistoryBbox(): Bbox | null {
        const bbox = this.strokeBbox;
        this.strokeBbox = null; // Clear after reading
        return bbox;
    }
}
