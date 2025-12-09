// TODO: consider reactify this?
import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { HistoryManager } from "./HistoryManager";
import { MapDraw } from "./MapDraw";
import { MapRenderer, MAPBOX_MAIN_CANVAS_LAYER } from "./MapRenderer";
import { GridRenderer } from "./GridRenderer";
import { Bbox } from "./CommonTypes";
import * as MapEraserUtils from "./MapEraserUtils";
import { DeleteBlockState } from "./MapEraserUtils";

type MapStyle = "standard" | "satellite" | "hybrid" | "none";
type MapProjection = "globe" | "mercator";
type FogConcentration = "low" | "medium" | "high";

export enum ControlMode {
  View,
  Eraser,
  DeleteBlock,
  DeletePixel,
  DrawLine,
  DrawScribble,
}

interface DrawingSession {
  baseMap: fogMap.FogMap; // The state before drawing started
  modifiedBlocks: {
    [tileKey: string]: { [blockKey: string]: fogMap.Block | null };
  }; // Mutable Blocks
  blockCounts: { [tileKey: string]: { [blockKey: string]: number } };
  erasedArea: Bbox | null;
}

export class MapController {
  private static instance: MapController | null = null;
  private map: mapboxgl.Map | null;
  private mapRenderer: MapRenderer | null;
  public fogMap: fogMap.FogMap;
  private controlMode: ControlMode;
  private mapStyle: MapStyle;
  private mapProjection: MapProjection;
  private resolvedLanguage: string;
  private fogConcentration: FogConcentration;
  private mapDraw: MapDraw | null;
  private onChangeCallback: { [key: string]: () => void };
  public historyManager: HistoryManager;
  private eraserArea: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null;
  private scribbleLastPos: mapboxgl.LngLat | null;
  private scribbleStrokeBbox: Bbox | null;
  private deleteBlockCursor: mapboxgl.Marker | null;
  private deleteBlockState: DeleteBlockState;
  private eraserStrokeBbox: Bbox | null;
  private drawingSession: DrawingSession | null;
  private gridRenderer: GridRenderer;
  private _showGrid = false;
  private deletePixelSizes = [40, 10, 4];
  private currentDeletePixelSizeIndex = 0;
  private deletePixelCursorLayerId = "delete-pixel-cursor";

  private constructor() {
    this.map = null;
    this.mapRenderer = null;
    this.fogMap = fogMap.FogMap.empty;
    this.controlMode = ControlMode.View;

    this.mapStyle = "standard";
    this.mapProjection = "mercator";
    this.resolvedLanguage = "en";
    this.fogConcentration = "medium";
    this.mapDraw = null;
    this.onChangeCallback = {};
    this.historyManager = new HistoryManager(this.fogMap);
    this.eraserArea = null;
    this.scribbleLastPos = null;
    this.scribbleStrokeBbox = null;
    this.deleteBlockCursor = null;
    this.deleteBlockCursor = null;
    this.deleteBlockState = {
      blocks: {},
      features: [],
      bbox: null,
    };
    this.eraserStrokeBbox = null;
    this.drawingSession = null;
    this.gridRenderer = new GridRenderer();
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

  private initMapStyle(): void {
    // Set the default atmosphere style for globe mode
    if (!this.map) return;
    this.map.setFog({});
    this.setMapboxLanguage();
  }

  private initMapDraw(map: mapboxgl.Map): void {
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

  private initMapRenderer(map: mapboxgl.Map): void {
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
    this.map.on("styledata", this.initMapStyle.bind(this));
    this.map.on("mousedown", this.handleMousePress.bind(this));
    this.map.on("mouseup", this.handleMouseRelease.bind(this));
    this.map.on("mousemove", this.handleMouseMove.bind(this));
    this.map.on("zoomend", this.handleZoomEnd.bind(this));

    this.setControlMode(this.controlMode);
    this.onChange();
    this.resolvedLanguage = resolvedLanguage;
    this.initMapRenderer(map);
    this.initMapDraw(map);
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

  get showGrid(): boolean {
    return this._showGrid;
  }

  set showGrid(value: boolean) {
    if (this._showGrid !== value) {
      this._showGrid = value;
      this.updateGridLayer();
    }
  }

  private handleZoomEnd(): void {
    if (this.showGrid) {
      this.updateGridLayer();
    }
  }

  private updateGridLayer(): void {
    if (!this.map) return;
    this.gridRenderer.update(this.map, this.fogMap, this.showGrid);
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }

  redrawArea(area: Bbox | "all"): void {
    this.mapRenderer?.redrawArea(area);
  }

  private applyFogMapUpdate(
    newMap: fogMap.FogMap,
    areaChanged: Bbox | "all",
    skipGridUpdate = false
  ) {
    this.fogMap = newMap;
    this.redrawArea(areaChanged);
    if (!skipGridUpdate && this.showGrid) {
      this.updateGridLayer();
    }

    if (this.onChange) {
      this.onChange();
    }
  }

  private updateFogMap(
    newMap: fogMap.FogMap,
    areaChanged: Bbox | "all",
    skipHistory = false,
    skipGridUpdate = false
  ): void {
    if (this.fogMap !== newMap) {
      if (!skipHistory) {
        this.historyManager.append(newMap, areaChanged);
      }
      this.applyFogMapUpdate(newMap, areaChanged, skipGridUpdate);
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

  handleMousePress(e: mapboxgl.MapMouseEvent): void {
    console.log(`[Mouse Press] at ${e.lngLat}`);
    if (this.controlMode === ControlMode.Eraser) {
      this.handleEraserPress(e);
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.handleDeleteBlockPress(e);
    } else if (this.controlMode === ControlMode.DeletePixel) {
      this.handleDeletePixelPress(e);
    } else if (this.controlMode === ControlMode.DrawLine) {
      // pass. -> setControlMode(ControlMode.DrawLine) -> @mapbox/mapbox-gl-draw 
    } else if (this.controlMode === ControlMode.DrawScribble) {
      this.handleDrawScribblePress(e);
    }
  }

  private handleEraserPress(e: mapboxgl.MapMouseEvent): void {
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
  }

  private handleDrawScribblePress(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.scribbleLastPos = e.lngLat;
    this.scribbleStrokeBbox = new Bbox(
      e.lngLat.lng,
      e.lngLat.lat,
      e.lngLat.lng,
      e.lngLat.lat
    );
  }

  private handleDeleteBlockPress(e: mapboxgl.MapMouseEvent): void {
    this.deleteBlockState = {
      blocks: {},
      features: [],
      bbox: null,
    };
    this.handleDeleteBlockInteraction(e.lngLat);
  }

  private handleDeletePixelPress(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.scribbleLastPos = e.lngLat;
    this.eraserStrokeBbox = new Bbox(
      e.lngLat.lng,
      e.lngLat.lat,
      e.lngLat.lng,
      e.lngLat.lat
    );

    this.drawingSession = {
      baseMap: this.fogMap,
      modifiedBlocks: {},
      blockCounts: {},
      erasedArea: new Bbox(
        e.lngLat.lng,
        e.lngLat.lat,
        e.lngLat.lng,
        e.lngLat.lat
      ),
    };

    // Initial interaction on press
    this.handleDeletePixelInteraction(e.lngLat);
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser) {
      this.handleEraserMove(e);
    } else if (this.controlMode === ControlMode.DrawScribble) {
      this.handleDrawScribbleMove(e);
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.handleDeleteBlockMove(e);
    } else if (this.controlMode === ControlMode.DeletePixel) {
      this.handleDeletePixelMove(e);
    }
  }

  private handleEraserMove(e: mapboxgl.MapMouseEvent): void {
    if (!this.eraserArea) return;
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
  }

  private handleDrawScribbleMove(e: mapboxgl.MapMouseEvent): void {
    if (!this.scribbleLastPos) return;

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

  private handleDeleteBlockMove(e: mapboxgl.MapMouseEvent): void {
    if (e.originalEvent.buttons === 1) {
      this.handleDeleteBlockInteraction(e.lngLat);
    }
    this.updateDeleteBlockCursor(e.lngLat);
  }

  private handleDeletePixelMove(e: mapboxgl.MapMouseEvent): void {
    this.updateDeletePixelCursor(e.lngLat);
    if (e.originalEvent.buttons === 1 && this.scribbleLastPos) {
      this.handleDeletePixelInteraction(e.lngLat);
    }
  }

  private updateDeletePixelCursor(lngLat: mapboxgl.LngLat) {
    if (!this.map) return;
    const source = this.map.getSource(this.deletePixelCursorLayerId) as mapboxgl.GeoJSONSource;
    if (source) {
      const size = this.deletePixelSizes[this.currentDeletePixelSizeIndex];
      const polygon = MapEraserUtils.getEraserCursorPolygon(lngLat, size);
      source.setData({
        type: "Feature",
        geometry: polygon,
        properties: {},
      });
    }
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
    console.log(`[Mouse Release] at ${e.lngLat}`);
    if (this.controlMode === ControlMode.Eraser) {
      this.handleEraserRelease(e);
    } else if (this.controlMode === ControlMode.DrawScribble) {
      this.handleDrawScribbleRelease(e);
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.handleDeleteBlockRelease(e);
    } else if (this.controlMode === ControlMode.DeletePixel) {
      this.handleDeletePixelRelease(e);
    }
  }

  private handleEraserRelease(e: mapboxgl.MapMouseEvent): void {
    if (!this.eraserArea) return;
    const startPoint = this.eraserArea[0];
    const west = Math.min(e.lngLat.lng, startPoint.lng);
    const north = Math.max(e.lngLat.lat, startPoint.lat);
    const east = Math.max(e.lngLat.lng, startPoint.lng);
    const south = Math.min(e.lngLat.lat, startPoint.lat);

    this.map?.removeLayer("eraser");
    this.map?.removeLayer("eraser-outline");
    this.map?.removeSource("eraser");

    const bbox = new Bbox(west, south, east, north);

    const newMap = this.fogMap.clearBbox(bbox);
    this.updateFogMap(newMap, bbox);

    this.eraserArea = null;
  }

  private handleDrawScribbleRelease(e: mapboxgl.MapMouseEvent): void {
    if (this.scribbleStrokeBbox) {
      this.historyManager.append(this.fogMap, this.scribbleStrokeBbox);
    }
    this.scribbleLastPos = null;
    this.scribbleStrokeBbox = null;
    this.map?.dragPan.enable();
  }

  private handleDeleteBlockRelease(e: mapboxgl.MapMouseEvent): void {
    const newMap = this.fogMap.removeBlocks(this.deleteBlockState.blocks);
    this.updateFogMap(newMap, this.deleteBlockState.bbox || "all");

    this.deleteBlockState = {
      blocks: {},
      features: [],
      bbox: null,
    };
    this.updatePendingDeleteLayer();
  }

  private handleDeletePixelRelease(e: mapboxgl.MapMouseEvent): void {
    if (this.drawingSession) {
      // Finalize the session
      // We should already have the visual state in this.fogMap thanks to mouseMove updates
      // So this.fogMap IS the final map.

      if (this.drawingSession.erasedArea) {
        this.historyManager.append(
          this.fogMap,
          this.drawingSession.erasedArea
        );
      }
      this.drawingSession = null;
    }
    this.scribbleLastPos = null;
    if (this.showGrid) {
      this.updateGridLayer();
    }
    this.map?.dragPan.enable();
  }

  setControlMode(mode: ControlMode): void {
    const mapboxCanvas = this.map?.getCanvasContainer();
    if (!mapboxCanvas) return;

    // disable the current active mode
    switch (this.controlMode) {
      case ControlMode.View:
        break;
      case ControlMode.Eraser:
        if (this.eraserArea) {
          this.map?.removeLayer("eraser");
          this.map?.removeLayer("eraser-outline");
          this.map?.removeSource("eraser");
          this.eraserArea = null;
        }
        break;
      case ControlMode.DeleteBlock:
        this.showGrid = false;
        MapEraserUtils.cleanupDeleteBlockLayers(this.map);
        this.deleteBlockCursor?.remove();
        this.deleteBlockCursor = null;
        this.deleteBlockState = {
          blocks: {},
          features: [],
          bbox: null,
        };
        break;
      case ControlMode.DeletePixel:
        if (this.map?.getLayer(this.deletePixelCursorLayerId)) {
          this.map?.removeLayer(this.deletePixelCursorLayerId);
        }
        if (this.map?.getSource(this.deletePixelCursorLayerId)) {
          this.map?.removeSource(this.deletePixelCursorLayerId);
        }
        break;
      case ControlMode.DrawLine:
        this.mapDraw?.deactivate();
        break;
      case ControlMode.DrawScribble:
        this.scribbleLastPos = null;
        break;
    }

    // enable the new mode
    switch (mode) {
      case ControlMode.View:
        mapboxCanvas.style.cursor = "grab";
        this.map?.dragPan.enable();
        break;
      case ControlMode.Eraser:
        mapboxCanvas.style.cursor = "cell";
        this.map?.dragPan.disable();
        break;
      case ControlMode.DeleteBlock:
        mapboxCanvas.style.cursor = "none";   // hide mouse cursor, show blue rectangle
        this.map?.dragPan.disable();
        this.showGrid = true;
        break;
      case ControlMode.DeletePixel:
        mapboxCanvas.style.cursor = "crosshair";
        this.map?.dragPan.disable();
        this.currentDeletePixelSizeIndex = 0;
        MapEraserUtils.initDeletePixelCursorLayer(this.map, this.deletePixelCursorLayerId);
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

  private updatePendingDeleteLayer() {
    MapEraserUtils.updatePendingDeleteLayer(
      this.map,
      this.deleteBlockState.features
    );
  }

  private updateDeleteBlockCursor(lngLat: mapboxgl.LngLat) {
    this.deleteBlockCursor = MapEraserUtils.updateDeleteBlockCursor(
      this.map,
      this.deleteBlockCursor,
      lngLat
    );
  }

  private handleDeleteBlockInteraction(lngLat: mapboxgl.LngLat) {
    if (!this.map) return;
    const result = MapEraserUtils.handleDeleteBlockInteraction(
      this.map,
      this.fogMap,
      this.deleteBlockState,
      lngLat
    );

    this.deleteBlockState = result.newState;

    if (result.changed) {
      this.updatePendingDeleteLayer();
    }
  }

  private handleDeletePixelInteraction(lngLat: mapboxgl.LngLat) {
    if (!this.map || !this.scribbleLastPos || !this.drawingSession) return;

    const result = MapEraserUtils.handleDeletePixelInteraction(
      this.fogMap,
      this.drawingSession,
      this.scribbleLastPos,
      lngLat,
      this.deletePixelSizes[this.currentDeletePixelSizeIndex]
    );

    if (result && result.changed) {
      this.updateFogMap(result.newMap, result.segmentBbox, true, true);
    }

    this.scribbleLastPos = lngLat;
  }

  getCenter(): { lng: number; lat: number; zoom: number } | null {
    const center = this.map?.getCenter();
    const zoom = this.map?.getZoom();
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
    this.map?.flyTo(options);
  }
}
