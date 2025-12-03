// TODO: consider reactify this?
import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { HistoryManager } from "./HistoryManager";
import { MapDraw } from "./MapDraw";
import { MapRenderer, MAPBOX_MAIN_CANVAS_LAYER } from "./MapRenderer";
import { Bbox } from "./CommonTypes";

type MapStyle = "standard" | "satellite" | "hybrid" | "none";
type MapProjection = "globe" | "mercator";
type FogConcentration = "low" | "medium" | "high";

export enum ControlMode {
  View,
  Eraser,
  DrawLine,
  DrawScribble,
  EraseBrush,
}

export class MapController {
  private static instance: MapController | null = null;
  private map: mapboxgl.Map | null;
  private mapRenderer: MapRenderer | null;
  public fogMap: fogMap.FogMap;
  public historyManager: HistoryManager;
  private controlMode: ControlMode;
  private eraserArea: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null;
  private eraseBrushLastPos: mapboxgl.LngLat | null;
  private scribbleLastPos: mapboxgl.LngLat | null;
  private scribbleStrokeBbox: Bbox | null;
  private mapDraw: MapDraw | null;
  private onChangeCallback: { [key: string]: () => void };
  private mapStyle: MapStyle;
  private mapProjection: MapProjection;
  private resolvedLanguage: string;
  private fogConcentration: FogConcentration;

  private constructor() {
    this.map = null;
    this.fogMap = fogMap.FogMap.empty;
    this.controlMode = ControlMode.View;
    this.eraserArea = null;
    this.eraseBrushLastPos = null;
    this.scribbleLastPos = null;
    this.scribbleStrokeBbox = null;
    this.historyManager = new HistoryManager(this.fogMap);
    this.onChangeCallback = {};
    this.mapStyle = "standard";
    this.mapProjection = "mercator";
    this.resolvedLanguage = "en";
    this.fogConcentration = "medium";
    this.mapDraw = null;
    this.mapRenderer = null;
  }

  static create(): MapController {
    if (MapController.instance) {
      console.log(
        "WARNING: One shouldn't create a second copy of `mapController`"
      );
    } else {
      MapController.instance = new MapController();
    }
    return MapController.instance;
  }

  private setMapboxLanguage(): void {
    const mapboxLanguage = this.resolvedLanguage == "zh" ? "zh-Hans" : "en";
    const map = this.map;
    if (!map) {
      return;
    }

    map.getStyle().layers.forEach(function (thisLayer) {
      if (thisLayer.id.indexOf("-label") > 0) {
        map.setLayoutProperty(thisLayer.id, "text-field", [
          "get",
          "name_" + mapboxLanguage,
        ]);
      }
    });
  }

  mapboxStyleURL(): string {
    if (this.mapStyle == "standard" || this.mapStyle == "none") {
      return "mapbox://styles/mapbox/streets-v11";
    } else if (this.mapStyle == "satellite") {
      return "mapbox://styles/mapbox/satellite-v9";
    } else {
      return "mapbox://styles/mapbox/satellite-streets-v11";
    }
  }

  private setMapVisibility(visibility: "visible" | "none"): void {
    this.map?.getStyle().layers.forEach((thisLayer) => {
      if (thisLayer.id !== MAPBOX_MAIN_CANVAS_LAYER) {
        this.map?.setLayoutProperty(thisLayer.id, "visibility", visibility);
      }
    });
  }

  setMapStyle(style: MapStyle): void {
    if (style != this.mapStyle) {
      if (style == "none") {
        this.mapStyle = style;
        this.setMapVisibility("none");
      } else {
        if (this.mapStyle == "none") {
          this.setMapVisibility("visible");
        }
        this.mapStyle = style;
        this.map?.setStyle(this.mapboxStyleURL());
      }
    }
  }

  getMapStyle(): MapStyle {
    return this.mapStyle;
  }

  setMapProjection(projection: MapProjection): void {
    if (projection != this.mapProjection) {
      this.mapProjection = projection;
      this.map?.setProjection(projection);
      this.mapRenderer?.maybeRenderOnce();
    }
  }

  getMapProjection(): MapProjection {
    return this.mapProjection;
  }

  setFogConcentration(fogConcentration: FogConcentration): void {
    if (fogConcentration != this.fogConcentration) {
      this.fogConcentration = fogConcentration;
      this.redrawArea("all");
    }
  }

  getFogConcentration(): FogConcentration {
    return this.fogConcentration;
  }

  private onChange() {
    Object.keys(this.onChangeCallback).map((key) => {
      const callback = this.onChangeCallback[key];
      callback();
    });
  }

  registerMap(map: mapboxgl.Map, resolvedLanguage: string): void {
    this.map = map;
    this.map.on("mousedown", this.handleMouseClick.bind(this));
    this.map.on("mouseup", this.handleMouseRelease.bind(this));
    this.map.on("mousemove", this.handleMouseMove.bind(this));
    map.on("styledata", () => {
      // Set the default atmosphere style for globe mode
      map.setFog({});
      this.setMapboxLanguage();
    });
    this.setControlMode(this.controlMode);
    this.onChange();
    this.resolvedLanguage = resolvedLanguage;
    this.mapRenderer = new MapRenderer(
      map,
      0,
      () => {
        return this.fogMap;
      },
      () => {
        if (this.fogConcentration == "high") {
          return 0.8;
        } else if (this.fogConcentration == "medium") {
          return 0.6;
        } else {
          return 0.4;
        }
      }
    );

    this.mapDraw = new MapDraw(
      map,
      () => {
        return this.fogMap;
      },
      (newMap, areaChanged) => {
        this.updateFogMap(newMap, areaChanged);
      }
    );
  }

  setResolvedLanguage(resolvedLanguage: string) {
    if (resolvedLanguage != this.resolvedLanguage) {
      this.resolvedLanguage = resolvedLanguage;
      this.setMapboxLanguage();
    }
  }

  unregisterMap(_map: mapboxgl.Map): void {
    // TODO
  }

  registerOnChangeCallback(key: string, callback: () => void) {
    this.onChangeCallback[key] = callback;
    this.onChange();
  }

  unregisterOnChangeCallback(key: string) {
    delete this.onChangeCallback[key];
  }

  redrawArea(area: Bbox | "all"): void {
    this.mapRenderer?.redrawArea(area);
  }

  private applyFogMapUpdate(newMap: fogMap.FogMap, areaChanged: Bbox | "all") {
    this.fogMap = newMap;
    this.redrawArea(areaChanged);

    if (this.onChange) {
      this.onChange();
    }
  }

  private updateFogMap(
    newMap: fogMap.FogMap,
    areaChanged: Bbox | "all",
    skipHistory = false
  ): void {
    if (this.fogMap !== newMap) {
      if (!skipHistory) {
        this.historyManager.append(newMap, areaChanged);
      }
      this.applyFogMapUpdate(newMap, areaChanged);
    }
  }

  replaceFogMap(newMap: fogMap.FogMap): void {
    this.historyManager = new HistoryManager(fogMap.FogMap.empty);
    this.updateFogMap(newMap, "all");
  }

  undo(): void {
    this.historyManager.undo(this.applyFogMapUpdate.bind(this));
  }

  redo(): void {
    this.historyManager.redo(this.applyFogMapUpdate.bind(this));
  }

  handleMouseClick(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser) {
      console.log(
        `A click event has occurred on a visible portion of the poi-label layer at ${e.lngLat}`
      );

      if (!this.eraserArea) {
        this.map?.addSource("eraser", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[]],
            },
          },
        });

        this.map?.addLayer({
          id: "eraser",
          type: "fill",
          source: "eraser",
          layout: {},
          paint: {
            "fill-color": "#969696",
            "fill-opacity": 0.5,
          },
        });
        this.map?.addLayer({
          id: "eraser-outline",
          type: "line",
          source: "eraser",
          layout: {},
          paint: {
            "line-color": "#969696",
            "line-width": 1,
          },
        });

        const eraserSource = this.map?.getSource(
          "eraser"
        ) as mapboxgl.GeoJSONSource | null;
        if (eraserSource) {
          const startPoint = new mapboxgl.LngLat(e.lngLat.lng, e.lngLat.lat);
          this.eraserArea = [startPoint, eraserSource];
        }
      }
    } else if (this.controlMode === ControlMode.EraseBrush) {
      this.map?.dragPan.disable();
      this.eraseBrushLastPos = e.lngLat;
      // Initial erase at click point
      this.eraseAtPoint(e.lngLat);
    } else if (this.controlMode === ControlMode.DrawScribble) {
      this.map?.dragPan.disable();
      this.scribbleLastPos = e.lngLat;
      this.scribbleStrokeBbox = new Bbox(
        e.lngLat.lng,
        e.lngLat.lat,
        e.lngLat.lng,
        e.lngLat.lat
      );
    }
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser && this.eraserArea) {
      const [startPoint, eraserSource] = this.eraserArea;
      const west = Math.min(e.lngLat.lng, startPoint.lng);
      const north = Math.max(e.lngLat.lat, startPoint.lat);
      const east = Math.max(e.lngLat.lng, startPoint.lng);
      const south = Math.min(e.lngLat.lat, startPoint.lat);

      eraserSource.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [east, north],
              [west, north],
              [west, south],
              [east, south],
              [east, north],
            ],
          ],
        },
      });
    } else if (
      this.controlMode === ControlMode.EraseBrush &&
      this.eraseBrushLastPos
    ) {
      const currentPos = e.lngLat;
      const dist = currentPos.distanceTo(this.eraseBrushLastPos);
      // Interpolate if distance is significant to avoid gaps
      // 24px at zoom level 0 is huge, but we operate in lat/lng.
      // A simple heuristic: if we moved more than a pixel's worth of distance, interpolate.
      // Since we don't have easy access to pixel distance here without projecting,
      // we'll just interpolate a few steps if the distance is "large".
      // Actually, for a smooth brush, we can just interpolate based on a fixed number of steps
      // or a small fixed distance. Let's try a simple step approach.

      const steps = Math.ceil(dist / 5); // Arbitrary small distance divisor in meters? No, distanceTo returns meters.
      // 5 meters is very small on a global scale, but fine for high zoom.
      // Let's just use a fixed number of interpolations for now or rely on the fact that mousemove fires often.
      // Better: project to pixels to see how far we moved.
      const p1 = this.map?.project(this.eraseBrushLastPos);
      const p2 = this.map?.project(currentPos);
      if (p1 && p2) {
        const pixelDist = Math.sqrt(
          Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
        );
        const stepSize = 5; // interpolate every 5 pixels
        const numSteps = Math.ceil(pixelDist / stepSize);

        for (let i = 1; i <= numSteps; i++) {
          const t = i / numSteps;
          const lat =
            this.eraseBrushLastPos.lat +
            (currentPos.lat - this.eraseBrushLastPos.lat) * t;
          const lng =
            this.eraseBrushLastPos.lng +
            (currentPos.lng - this.eraseBrushLastPos.lng) * t;
          this.eraseAtPoint(new mapboxgl.LngLat(lng, lat));
        }
      } else {
        this.eraseAtPoint(currentPos);
      }
      this.eraseBrushLastPos = currentPos;
    } else if (
      this.controlMode === ControlMode.DrawScribble &&
      this.scribbleLastPos
    ) {
      const currentPos = e.lngLat;
      const newMap = this.fogMap.addLine(
        this.scribbleLastPos.lng,
        this.scribbleLastPos.lat,
        currentPos.lng,
        currentPos.lat
      );

      // TODO: the computation below cannot handle anti-meridian crossing correctly.
      // It is tricky and most people don't need it.
      const segmentBbox = new Bbox(
        Math.min(this.scribbleLastPos.lng, currentPos.lng),
        Math.min(this.scribbleLastPos.lat, currentPos.lat),
        Math.max(this.scribbleLastPos.lng, currentPos.lng),
        Math.max(this.scribbleLastPos.lat, currentPos.lat)
      );

      if (this.scribbleStrokeBbox) {
        this.scribbleStrokeBbox = new Bbox(
          Math.min(this.scribbleStrokeBbox.west, segmentBbox.west),
          Math.min(this.scribbleStrokeBbox.south, segmentBbox.south),
          Math.max(this.scribbleStrokeBbox.east, segmentBbox.east),
          Math.max(this.scribbleStrokeBbox.north, segmentBbox.north)
        );
      }

      this.updateFogMap(newMap, segmentBbox, true);
      this.scribbleLastPos = currentPos;
    }
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser && this.eraserArea) {
      const startPoint = this.eraserArea[0];
      const west = Math.min(e.lngLat.lng, startPoint.lng);
      const north = Math.max(e.lngLat.lat, startPoint.lat);
      const east = Math.max(e.lngLat.lng, startPoint.lng);
      const south = Math.min(e.lngLat.lat, startPoint.lat);

      this.map?.removeLayer("eraser");
      this.map?.removeLayer("eraser-outline");
      this.map?.removeSource("eraser");

      const bbox = new Bbox(west, south, east, north);
      console.log(`clearing the bbox ${west} ${north} ${east} ${south}`);

      const newMap = this.fogMap.clearBbox(bbox);
      this.updateFogMap(newMap, bbox);

      this.eraserArea = null;
    } else if (
      this.controlMode === ControlMode.EraseBrush &&
      this.eraseBrushLastPos
    ) {
      this.eraseBrushLastPos = null;
      this.map?.dragPan.enable();
      // We should probably add a history entry here, but since we modified the map in real-time
      // without tracking the specific changed area for the whole stroke, it's tricky.
      // For now, let's just assume the user is okay with the current state being the new history state.
      // Ideally we would have accumulated the bbox of the entire stroke.
      // TODO: Accumulate stroke bbox for history.
      this.historyManager.append(this.fogMap, "all");
    } else if (
      this.controlMode === ControlMode.DrawScribble &&
      this.scribbleLastPos
    ) {
      if (this.scribbleStrokeBbox) {
        this.historyManager.append(this.fogMap, this.scribbleStrokeBbox);
      }
      this.scribbleLastPos = null;
      this.scribbleStrokeBbox = null;
      this.map?.dragPan.enable();
    }
  }

  setControlMode(mode: ControlMode): void {
    const mapboxCanvas = this.map?.getCanvasContainer();
    if (!mapboxCanvas) {
      return;
    }

    // disable the current active mode
    switch (this.controlMode) {
      case ControlMode.View:
        break;
      case ControlMode.Eraser:
        mapboxCanvas.style.cursor = "";
        this.map?.dragPan.enable();
        if (this.eraserArea) {
          this.map?.removeLayer("eraser");
          this.map?.removeLayer("eraser-outline");
          this.map?.removeSource("eraser");
          this.eraserArea = null;
        }
        break;
      case ControlMode.EraseBrush:
        mapboxCanvas.style.cursor = "";
        this.map?.dragPan.enable();
        break;
      case ControlMode.DrawLine:
        mapboxCanvas.style.cursor = "";
        this.map?.dragPan.enable();
        this.mapDraw?.deactivate();
        break;
      case ControlMode.DrawScribble:
        mapboxCanvas.style.cursor = "";
        this.map?.dragPan.enable();
        this.scribbleLastPos = null;
        break;
    }

    // enable the new mode
    switch (mode) {
      case ControlMode.View:
        break;
      case ControlMode.Eraser:
        mapboxCanvas.style.cursor = "cell";
        this.map?.dragPan.disable();
        break;
      case ControlMode.EraseBrush:
        mapboxCanvas.style.cursor =
          'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewport="0 0 24 24"><rect width="24" height="24" fill="white" fill-opacity="0.8"/></svg>\') 12 12, auto';
        this.map?.dragPan.disable();
        break;
      case ControlMode.DrawLine:
        mapboxCanvas.style.cursor = "crosshair";
        this.map?.dragPan.disable();
        this.mapDraw?.activate();
        break;
      case ControlMode.DrawScribble:
        mapboxCanvas.style.cursor = "crosshair";
        this.map?.dragPan.disable();
        break;
    }
    this.controlMode = mode;
  }

  private eraseAtPoint(lngLat: mapboxgl.LngLat) {
    if (!this.map) return;
    const point = this.map.project(lngLat);
    const size = 24; // 24px square
    const halfSize = size / 2;
    const p1 = new mapboxgl.Point(point.x - halfSize, point.y - halfSize);
    const p2 = new mapboxgl.Point(point.x + halfSize, point.y + halfSize);
    const c1 = this.map.unproject(p1);
    const c2 = this.map.unproject(p2);

    const bbox = new Bbox(
      Math.min(c1.lng, c2.lng),
      Math.min(c1.lat, c2.lat),
      Math.max(c1.lng, c2.lng),
      Math.max(c1.lat, c2.lat)
    );

    const newMap = this.fogMap.clearBbox(bbox);
    // Update map without adding to history for every small step
    this.updateFogMap(newMap, bbox, true);
  }
}
