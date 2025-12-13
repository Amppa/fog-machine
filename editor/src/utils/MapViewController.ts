import mapboxgl from "mapbox-gl";
import { Bbox } from "./CommonTypes";

const DEFAULT_ZOOM = 20;
const FIT_BOUNDS_PADDING = 50;

export class MapViewController {
    private map: mapboxgl.Map;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    getCenter(): { lng: number; lat: number; zoom: number } | null {
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();
        if (center && zoom !== undefined) {
            return { lng: center.lng, lat: center.lat, zoom };
        }
        return null;
    }

    flyTo(lng: number, lat: number, zoom?: number): void {
        const options: mapboxgl.FlyToOptions = {
            center: [lng, lat],
            essential: true,
        };
        if (zoom !== undefined) {
            options.zoom = zoom;
        }
        this.map.flyTo(options);
    }

    fitBounds(bounds: Bbox): void {
        this.map.fitBounds(
            [
                [bounds.west, bounds.south], // southwest
                [bounds.east, bounds.north], // northeast
            ],
            {
                padding: FIT_BOUNDS_PADDING,
                essential: true,
            }
        );
    }

    zoomToBoundingBox(
        bbox: Bbox | null,
        defaultCoord: [number, number] | null
    ): void {
        if (bbox) {
            this.zoomToBbox(bbox);
        } else if (defaultCoord) {
            this.flyTo(defaultCoord[0], defaultCoord[1]);
        }
    }

    private zoomToBbox(bbox: Bbox): void {
        const isSinglePoint =
            bbox.west === bbox.east && bbox.south === bbox.north;

        if (isSinglePoint) {
            this.flyTo(bbox.west, bbox.south, DEFAULT_ZOOM);
        } else {
            this.fitBounds(bbox);
        }
    }
}
