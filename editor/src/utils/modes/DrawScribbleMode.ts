import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";

/**
 * DrawScribble Mode
 * Allows user to draw freehand scribbles on the map
 */
export class DrawScribbleMode implements ModeStrategy {
    private lastPos: mapboxgl.LngLat | null = null;
    private drawingBbox: Bbox | null = null;

    activate(_context: ModeContext): void {
        // No special activation needed
    }

    deactivate(_context: ModeContext): void {
        // Clean up state
        this.lastPos = null;
        this.drawingBbox = null;
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        this.lastPos = e.lngLat;
        this.drawingBbox = Bbox.fromPoint(e.lngLat);
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

        if (this.drawingBbox) {
            this.drawingBbox = Bbox.merge(this.drawingBbox, segmentBbox);
        }

        context.updateFogMap(newMap, segmentBbox);
        this.lastPos = currentPos;
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (this.drawingBbox) {
            context.historyManager.append(context.fogMap, this.drawingBbox);
        }
        this.lastPos = null;
        this.drawingBbox = null;
    }

    getCursorStyle(): string {
        return 'crosshair';
    }

    shouldDisableDragPan(): boolean {
        return true;
    }
}
