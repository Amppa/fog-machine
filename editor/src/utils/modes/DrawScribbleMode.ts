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

        context.updateFogMap(newMap, segmentBbox);
        this.lastPos = currentPos;
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        // History is managed by MapController
        // We just reset the state
        this.lastPos = null;
        this.strokeBbox = null;
    }

    getCursorStyle(): string {
        return CURSOR_STYLE;
    }

    shouldDisableDragPan(): boolean {
        return true;
    }

    /**
     * Get the current stroke bounding box for history management
     */
    getStrokeBbox(): Bbox | null {
        return this.strokeBbox;
    }

    /**
     * Clear the stroke bounding box (called after history is saved)
     */
    clearStrokeBbox(): void {
        this.strokeBbox = null;
    }
}
