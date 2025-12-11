import { FogMap } from "./FogMap";
import { Bbox } from "./CommonTypes";

export interface GpsImportResult {
    fogMap: FogMap;
    firstCoordinate: [number, number] | null;
    boundingBox: Bbox | null;
}

export interface Coordinate {
    longitude: number;
    latitude: number;
}
