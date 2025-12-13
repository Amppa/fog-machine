import mapboxgl from "mapbox-gl";
import { FogMap } from "../FogMap";
import { GridRenderer } from "../GridRenderer";
import { Bbox } from "../CommonTypes";
import { HistoryManager } from "../HistoryManager";

/**
 * Context object passed to mode strategies
 * Contains all dependencies needed by modes
 */
export interface ModeContext {
    map: mapboxgl.Map;
    fogMap: FogMap;
    gridRenderer: GridRenderer;
    historyManager: HistoryManager;
    updateFogMap: (newMap: FogMap, area: Bbox | "all", skipHistory?: boolean, skipGridUpdate?: boolean) => void;
    onChange: () => void;
}

/**
 * Strategy interface for control modes
 * Each mode implements this interface to define its behavior
 */
export interface ModeStrategy {
    /**
     * Called when the mode is activated
     */
    activate(context: ModeContext): void;

    /**
     * Called when the mode is deactivated
     */
    deactivate(context: ModeContext): void;

    /**
     * Handle mouse press event
     */
    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void;

    /**
     * Handle mouse move event
     */
    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void;

    /**
     * Handle mouse release event
     */
    handleMouseRelease(e: mapboxgl.MapMouseEvent, context: ModeContext): void;

    /**
     * Get the cursor style for this mode
     */
    getCursorStyle(): string;

    /**
     * Whether drag pan is allowed in this mode
     */
    canDragPan(): boolean;

    /**
     * Get the bounding box for history management
     * Called after handleMouseRelease to save the operation to history
     * Returns null if no operation should be saved (e.g., ViewMode)
     */
    getHistoryBbox(): Bbox | null;
}
