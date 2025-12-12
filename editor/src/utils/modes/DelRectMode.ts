import mapboxgl from "mapbox-gl";
import * as MapEraserUtils from "../MapEraserUtils";
import { ModeStrategy, ModeContext } from "./ModeStrategy";
import { Bbox } from "../CommonTypes";

/**
 * DelRect Mode (Rectangle Eraser)
 * Allows user to draw a rectangle to erase fog
 */
export class DelRectMode implements ModeStrategy {
    private eraserArea: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null = null;

    activate(context: ModeContext): void {
        MapEraserUtils.setDelRectLayersVisibility(
            context.map,
            MapEraserUtils.LAYER_IDS.DEL_RECT,
            MapEraserUtils.LAYER_IDS.DEL_RECT_OUTLINE,
            true
        );
    }

    deactivate(context: ModeContext): void {
        MapEraserUtils.setDelRectLayersVisibility(
            context.map,
            MapEraserUtils.LAYER_IDS.DEL_RECT,
            MapEraserUtils.LAYER_IDS.DEL_RECT_OUTLINE,
            false
        );
        this.eraserArea = null;
    }

    handleMousePress(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (!this.eraserArea) {
            const eraserSource = context.map.getSource(
                MapEraserUtils.LAYER_IDS.DEL_RECT
            ) as mapboxgl.GeoJSONSource | null;

            if (eraserSource) {
                const startPoint = new mapboxgl.LngLat(e.lngLat.lng, e.lngLat.lat);
                this.eraserArea = [startPoint, eraserSource];
            }
        }
    }

    handleMouseMove(e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        if (!this.eraserArea) return;
        const [startPoint, eraserSource] = this.eraserArea;
        const bounds = Bbox.fromTwoPoints(e.lngLat, startPoint);

        eraserSource.setData({
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [bounds.east, bounds.north],
                        [bounds.west, bounds.north],
                        [bounds.west, bounds.south],
                        [bounds.east, bounds.south],
                        [bounds.east, bounds.north],
                    ],
                ],
            },
        });
    }

    handleMouseRelease(e: mapboxgl.MapMouseEvent, context: ModeContext): void {
        if (!this.eraserArea) return;
        const [startPoint, eraserSource] = this.eraserArea;
        const bounds = Bbox.fromTwoPoints(e.lngLat, startPoint);

        // Clear layer data
        eraserSource.setData({
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [[]],
            },
        });

        const newMap = context.fogMap.clearBbox(bounds);
        context.updateFogMap(newMap, bounds);

        this.eraserArea = null;
    }

    getCursorStyle(): string {
        return 'cell';
    }

    shouldDisableDragPan(): boolean {
        return true;
    }
}
