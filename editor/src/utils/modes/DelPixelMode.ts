import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as MapEraserUtils from "../MapEraserUtils";

const CURSOR_STYLE = 'crosshair';
const DEFAULT_DEL_PIXEL_SIZE = 5;
const AUTO_ZOOM_LEVEL = 11;

/**
 * DelPixel Mode
 * Allows user to erase fog pixel by pixel with a brush
 */
export class DelPixelMode implements ModeStrategy {
    private lastPos: mapboxgl.LngLat | null = null;
    private eraserStrokeBbox: Bbox | null = null;
    private drawingSession: MapEraserUtils.DrawingSession | null = null;
    private earserSize = DEFAULT_DEL_PIXEL_SIZE;
    private delPixelCursorLayerId = MapEraserUtils.LAYER_IDS.DEL_PIXEL_CURSOR;

    activate(context: ModeContext): void {
        // Auto zoom if needed (pixel is too small to operate)
        const currentZoom = context.map.getZoom();
        if (currentZoom < AUTO_ZOOM_LEVEL) {
            const center = context.map.getCenter();
            context.map.flyTo({
                zoom: AUTO_ZOOM_LEVEL,
                center: [center.lng, center.lat],
                essential: true,
            });
        }

        // Initialize cursor layer
        MapEraserUtils.initDelPixelCursorLayer(context.map, this.delPixelCursorLayerId);
    }

    deactivate(context: ModeContext): void {
        MapEraserUtils.cleanupDelPixelLayer(context.map, this.delPixelCursorLayerId);
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

        // Initial interaction on press
        this.handleDelPixelInteraction(e.lngLat, context);
        context.onChange();
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        MapEraserUtils.updateDelPixelCursorLayer(
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
        // Drawing session is finalized, fogMap already updated
        this.lastPos = null;
        context.onChange();
        context.map.dragPan.enable();
    }

    getCursorStyle(): string {
        return CURSOR_STYLE;
    }

    shouldDisableDragPan(): boolean {
        return true;
    }

    /**
     * Get the bounding box of the erased area for history
     */
    getHistoryBbox(): Bbox | null {
        const bbox = this.drawingSession?.erasedArea || null;
        this.drawingSession = null;
        return bbox;
    }

    /**
     * Handle pixel eraser interaction
     */
    private handleDelPixelInteraction(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        if (!this.lastPos || !this.drawingSession) return;

        const result = MapEraserUtils.handleDelPixelInteraction(
            context.fogMap,
            this.drawingSession,
            this.lastPos,
            lngLat,
            this.earserSize
        );

        this.lastPos = lngLat;

        if (result && result.changed) {
            context.updateFogMap(result.newMap, result.segmentBbox, true, true); // skipHistory, skipGridUpdate
        }
    }

    /**
     * Set the pixel eraser size
     */
    setDelPixelSize(size: number): void {
        this.earserSize = size;
    }

    /**
     * Get the current pixel eraser size
     */
    getDelPixelSize(): number {
        return this.earserSize;
    }
}
