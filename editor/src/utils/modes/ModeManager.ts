import { ControlMode } from "../MapController";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { ViewMode } from "./ViewMode";
import { DelRectMode } from "./DelRectMode";
import { DrawPolylineMode } from "./DrawPolylineMode";
import { DrawScribbleMode } from "./DrawScribbleMode";
import { DelBlockMode } from "./DelBlockMode";
import { DelPixelMode } from "./DelPixelMode";

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
      [ControlMode.DrawPolyline, new DrawPolylineMode()],
      [ControlMode.DrawScribble, new DrawScribbleMode()],
      [ControlMode.DelRect, new DelRectMode()],
      [ControlMode.DelBlock, new DelBlockMode()],
      [ControlMode.DelPixel, new DelPixelMode()],
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

    if (newStrategy.canDragPan()) {
      this.context.map.dragPan.enable();
    } else {
      this.context.map.dragPan.disable();
    }

    // Activate new mode
    newStrategy.activate(this.context);
    this.currentMode = newMode;
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

    // Let the mode handle the release event
    strategy?.handleMouseRelease(e, this.context);

    // Unified history management: save operation bbox after release
    const historyBbox = strategy?.getHistoryBbox();
    if (historyBbox) {
      this.context.historyManager.append(this.context.fogMap, historyBbox);
      this.context.onChange(); // Trigger UI update for undo/redo buttons
    }
  }

  /**
   * Get a specific mode strategy
   */
  getStrategy(mode: ControlMode): ModeStrategy | undefined {
    return this.strategies.get(mode);
  }
}
