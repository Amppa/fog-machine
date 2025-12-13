import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";
import * as MapEraserUtils from "../MapEraserUtils";

const CURSOR_STYLE = 'cell';

/**
 * DelBlock Mode
 * Allows user to erase fog by clicking on blocks
 */
export class DelBlockMode implements ModeStrategy {
    private delBlockState: MapEraserUtils.DelBlockState;
    private delBlockCursor: mapboxgl.Marker | null = null;
    private showGrid = false;

    constructor() {
        this.delBlockState = this.resetDelBlockState();
    }

    activate(context: ModeContext): void {
        this.showGrid = true;
        this.updateGridLayer(context);
        // DelBlock layers are initialized in MapController
    }

    deactivate(context: ModeContext): void {
        this.showGrid = false;
        this.updateGridLayer(context);
        // DelBlock layers are cleaned up in MapController
        this.delBlockState = this.resetDelBlockState();

        // Remove cursor marker
        if (this.delBlockCursor) {
            this.delBlockCursor.remove();
            this.delBlockCursor = null;
        }
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        this.delBlockState = this.resetDelBlockState();
        this.handleDelBlockInteraction(e.lngLat, context);
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (e.originalEvent.buttons === 1) {
            this.handleDelBlockInteraction(e.lngLat, context);
        }
        this.updateDelBlockCursor(e.lngLat, context);
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        const newMap = context.fogMap.removeBlocks(this.delBlockState.blocks);
        context.updateFogMap(newMap, this.delBlockState.bbox || "all", true);

        this.delBlockState = this.resetDelBlockState();
        MapEraserUtils.updatePendingDelLayer(
            context.map,
            this.delBlockState.features
        );
    }

    getCursorStyle(): string {
        return CURSOR_STYLE;
    }

    canDragPan(): boolean {
        return false;
    }

    getHistoryBbox(): Bbox | null {
        return this.delBlockState.bbox;
    }

    /**
     * Handle block interaction (erase blocks)
     */
    private handleDelBlockInteraction(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        const result = MapEraserUtils.handleDelBlockInteraction(
            context.map,
            context.fogMap,
            this.delBlockState,
            lngLat
        );

        this.delBlockState = result.newState;

        if (result.changed) {
            MapEraserUtils.updatePendingDelLayer(
                context.map,
                this.delBlockState.features
            );
        }
    }

    /**
     * Update the block cursor position
     */
    private updateDelBlockCursor(lngLat: mapboxgl.LngLat, context: ModeContext): void {
        this.delBlockCursor = MapEraserUtils.updateDelBlockCursor(
            context.map,
            this.delBlockCursor,
            lngLat
        );
    }

    /**
     * Update grid layer visibility
     */
    private updateGridLayer(context: ModeContext): void {
        context.gridRenderer.update(
            context.map,
            context.fogMap,
            this.showGrid
        );
    }

    private resetDelBlockState(): MapEraserUtils.DelBlockState {
        return {
            blocks: {},
            features: [],
            bbox: null,
        };
    }
}
