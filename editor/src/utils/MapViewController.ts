import mapboxgl from "mapbox-gl";
import { Bbox } from "./CommonTypes";

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
                padding: 50, // 50px padding
                essential: true,
            }
        );
    }

    zoomToBoundingBox(
        boundingBox: Bbox | null,
        firstCoordinate: [number, number] | null
    ): void {
        if (boundingBox) {
            const isSinglePoint =
                boundingBox.west === boundingBox.east &&
                boundingBox.south === boundingBox.north;

            if (isSinglePoint) {
                this.flyTo(boundingBox.west, boundingBox.south, 20);
            } else {
                this.fitBounds(boundingBox);
            }
        } else if (firstCoordinate) {
            this.flyTo(firstCoordinate[0], firstCoordinate[1]);
        }
    }
}
