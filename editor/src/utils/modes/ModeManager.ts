import { ControlMode } from "../MapController";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { ViewMode } from "./ViewMode";
import { DelRectMode } from "./DelRectMode";
import { DrawScribbleMode } from "./DrawScribbleMode";

/**
 * ModeManager manages mode strategies and handles mode switching
 */
export class ModeManager {
    private strategies: Map<ControlMode, ModeStrategy>;
    private currentMode: ControlMode;
    private context: ModeContext;

    constructor(context: ModeContext) {
        this.context = context;
        this.currentMode = ControlMode.View;

        // Initialize all strategies
        this.strategies = new Map([
            [ControlMode.View, new ViewMode()],
            [ControlMode.Eraser, new DelRectMode()],
            [ControlMode.DrawScribble, new DrawScribbleMode()],
            // TODO: Add other modes
            // [ControlMode.DrawLine, new DrawLineMode()],
            // [ControlMode.DeleteBlock, new DelBlockMode()],
            // [ControlMode.DeletePixel, new DelPixelMode()],
        ]);
    }

    /**
     * Switch to a new mode
     */
    setMode(newMode: ControlMode): void {
        if (newMode === this.currentMode) return;

        const newStrategy = this.strategies.get(newMode);
        if (!newStrategy) {
            console.error(`Unknown mode: ${newMode}`);
            return;
        }

        // Deactivate old mode
        const oldStrategy = this.strategies.get(this.currentMode);
        if (oldStrategy) {
            oldStrategy.deactivate(this.context);
        }

        // Set cursor and drag pan
        const canvas = this.context.map.getCanvasContainer();
        if (canvas) {
            canvas.style.cursor = newStrategy.getCursorStyle();
        }

        if (newStrategy.shouldDisableDragPan()) {
            this.context.map.dragPan.disable();
        } else {
            this.context.map.dragPan.enable();
        }

        // Activate new mode
        newStrategy.activate(this.context);
        this.currentMode = newMode;
    }

    /**
     * Get current mode
     */
    getCurrentMode(): ControlMode {
        return this.currentMode;
    }

    /**
     * Handle mouse press event
     */
    handleMousePress(e: mapboxgl.MapMouseEvent): void {
        const strategy = this.strategies.get(this.currentMode);
        strategy?.handleMousePress(e, this.context);
    }

    /**
     * Handle mouse move event
     */
    handleMouseMove(e: mapboxgl.MapMouseEvent): void {
        const strategy = this.strategies.get(this.currentMode);
        strategy?.handleMouseMove(e, this.context);
    }

    /**
     * Handle mouse release event
     */
    handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
        const strategy = this.strategies.get(this.currentMode);
        strategy?.handleMouseRelease(e, this.context);
    }
}
