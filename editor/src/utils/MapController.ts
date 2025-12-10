// TODO: consider reactify this?
import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { HistoryManager } from "./HistoryManager";
import { MapDraw } from "./MapDraw";
import { MapRenderer, MAPBOX_MAIN_CANVAS_LAYER } from "./MapRenderer";
import { GridRenderer } from "./GridRenderer";
import { Bbox } from "./CommonTypes";
import * as MapEraserUtils from "./MapEraserUtils";
import { DeleteBlockState, DrawingSession } from "./MapEraserUtils";

type MapStyle = "standard" | "satellite" | "hybrid" | "none";
type MapProjection = "globe" | "mercator";
type FogConcentration = "low" | "medium" | "high";

export enum ControlMode {
  View,
  DrawLine,
  DrawScribble,
  Eraser,
  DeleteBlock,
  DeletePixel,
}



export class MapController {
  // Constants
  private static readonly LAYER_IDS = {
    ERASER: 'eraser',
    ERASER_OUTLINE: 'eraser-outline',
    DELETE_PIXEL_CURSOR: 'delete-pixel-cursor',
  } as const;

  private static readonly ERASER_STYLE = {
    COLOR: '#969696',
    FILL_OPACITY: 0.5,
    LINE_WIDTH: 1,
  } as const;

  private static readonly DEFAULT_DELETE_PIXEL_SIZE = 40;

  // Instance fields
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
  private drawScribbleLastPos: mapboxgl.LngLat | null;
  private deletePixelLastPos: mapboxgl.LngLat | null;
  private scribbleStrokeBbox: Bbox | null;
  private deleteBlockCursor: mapboxgl.Marker | null;
  private deleteBlockState: DeleteBlockState;
  private eraserStrokeBbox: Bbox | null;
  private drawingSession: DrawingSession | null;
  private gridRenderer: GridRenderer;
  private _showGrid = false;
  private currentDeletePixelSize = MapController.DEFAULT_DELETE_PIXEL_SIZE;
  private deletePixelCursorLayerId = MapController.LAYER_IDS.DELETE_PIXEL_CURSOR;

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
    this.drawScribbleLastPos = null;
    this.deletePixelLastPos = null;
    this.scribbleStrokeBbox = null;
    this.deleteBlockCursor = null;
    this.deleteBlockState = this.resetDeleteBlockState();
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
    if (!this.map) return;
    const mapboxLanguage = this.resolvedLanguage === "zh" ? "zh-Hans" : "en";

    this.map?.getStyle().layers.forEach((thisLayer) => {
      if (thisLayer.id.indexOf("-label") > 0) {
        this.map?.setLayoutProperty(thisLayer.id, "text-field", [
          "get",
          "name_" + mapboxLanguage,
        ]);
      }
    });
  }

  mapboxStyleURL(): string {
    const styleMap: Record<MapStyle, string> = {
      standard: "mapbox://styles/mapbox/streets-v11",
      none: "mapbox://styles/mapbox/streets-v11",
      satellite: "mapbox://styles/mapbox/satellite-v9",
      hybrid: "mapbox://styles/mapbox/satellite-streets-v11",
    };
    return styleMap[this.mapStyle];
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
    this.map?.setFog({});
    this.setMapboxLanguage();
  }

  private getFogMap = (): fogMap.FogMap => {
    return this.fogMap;
  };

  private handleDrawUpdate = (newMap: fogMap.FogMap, areaChanged: Bbox | "all"): void => {
    this.updateFogMap(newMap, areaChanged);
  };

  private getFogOpacity = (): number => {
    const opacityMap: Record<FogConcentration, number> = {
      high: 0.8,
      medium: 0.6,
      low: 0.4,
    };
    return opacityMap[this.fogConcentration];
  };

  private initMapDraw(map: mapboxgl.Map): void {
    this.mapDraw = new MapDraw(
      map,
      this.getFogMap,
      this.handleDrawUpdate
    );
  }

  private initMapRenderer(map: mapboxgl.Map): void {
    this.mapRenderer = new MapRenderer(
      map,
      0,
      this.getFogMap,
      this.getFogOpacity
    );
  }

  setMapStyle(style: MapStyle): void {
    if (style !== this.mapStyle) {
      if (style === "none") {
        this.mapStyle = style;
        this.setMapVisibility("none");
      } else {
        if (this.mapStyle === "none") {
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
    if (projection !== this.mapProjection) {
      this.mapProjection = projection;
      this.map?.setProjection(projection);
      this.mapRenderer?.maybeRenderOnce();
    }
  }

  getMapProjection(): MapProjection {
    return this.mapProjection;
  }

  setFogConcentration(fogConcentration: FogConcentration): void {
    if (fogConcentration !== this.fogConcentration) {
      this.fogConcentration = fogConcentration;
      this.redrawArea("all");
    }
  }

  getFogConcentration(): FogConcentration {
    return this.fogConcentration;
  }

  private onChange() {
    Object.values(this.onChangeCallback).forEach((callback) => callback());
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
    if (resolvedLanguage !== this.resolvedLanguage) {
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
    this.onChange();
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
    switch (this.controlMode) {
      case ControlMode.View:
        break;
      case ControlMode.DrawLine:
        // pass. -> setControlMode(ControlMode.DrawLine) -> @mapbox/mapbox-gl-draw
        break;
      case ControlMode.DrawScribble:
        this.handleDrawScribblePress(e);
        break;
      case ControlMode.Eraser:
        this.handleEraserPress(e);
        break;
      case ControlMode.DeleteBlock:
        this.handleDeleteBlockPress(e);
        break;
      case ControlMode.DeletePixel:
        this.handleDeletePixelPress(e);
        break;
      default:
        break;
    }
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
    switch (this.controlMode) {
      case ControlMode.View:
        break;
      case ControlMode.DrawLine:
        break;
      case ControlMode.DrawScribble:
        this.handleDrawScribbleRelease(e);
        break;
      case ControlMode.Eraser:
        this.handleEraserRelease(e);
        break;
      case ControlMode.DeleteBlock:
        this.handleDeleteBlockRelease(e);
        break;
      case ControlMode.DeletePixel:
        this.handleDeletePixelRelease(e);
        break;
      default:
        break;
    }
  }

  private resetDeleteBlockState(): DeleteBlockState {
    return {
      blocks: {},
      features: [],
      bbox: null,
    };
  }

  private handleDrawScribblePress(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.drawScribbleLastPos = e.lngLat;
    this.scribbleStrokeBbox = Bbox.fromPoint(e.lngLat);
  }



  private handleEraserPress(e: mapboxgl.MapMouseEvent): void {
    if (!this.eraserArea) {
      MapEraserUtils.initEraserLayers(
        this.map,
        MapController.LAYER_IDS.ERASER,
        MapController.LAYER_IDS.ERASER_OUTLINE,
        MapController.ERASER_STYLE.COLOR,
        MapController.ERASER_STYLE.FILL_OPACITY,
        MapController.ERASER_STYLE.LINE_WIDTH
      );

      const eraserSource = this.map?.getSource(
        MapController.LAYER_IDS.ERASER
      ) as mapboxgl.GeoJSONSource | null;
      if (eraserSource) {
        const startPoint = new mapboxgl.LngLat(e.lngLat.lng, e.lngLat.lat);
        this.eraserArea = [startPoint, eraserSource];
      }
    }
  }

  private handleDeleteBlockPress(e: mapboxgl.MapMouseEvent): void {
    this.deleteBlockState = this.resetDeleteBlockState();
    this.handleDeleteBlockInteraction(e.lngLat);
  }

  private handleDeletePixelPress(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.deletePixelLastPos = e.lngLat;
    this.eraserStrokeBbox = Bbox.fromPoint(e.lngLat);

    this.drawingSession = {
      baseMap: this.fogMap,
      modifiedBlocks: {},
      blockCounts: {},
      erasedArea: Bbox.fromPoint(e.lngLat),
    };

    // Initial interaction on press
    this.handleDeletePixelInteraction(e.lngLat);
    this.onChange();
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent): void {
    switch (this.controlMode) {
      case ControlMode.View:
        break;
      case ControlMode.DrawLine:
        break;
      case ControlMode.DrawScribble:
        this.handleDrawScribbleMove(e);
        break;
      case ControlMode.Eraser:
        this.handleEraserMove(e);
        break;
      case ControlMode.DeleteBlock:
        this.handleDeleteBlockMove(e);
        break;
      case ControlMode.DeletePixel:
        this.handleDeletePixelMove(e);
        break;
      default:
        break;
    }
  }

  private handleEraserMove(e: mapboxgl.MapMouseEvent): void {
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

  private handleDrawScribbleMove(e: mapboxgl.MapMouseEvent): void {
    if (!this.drawScribbleLastPos) return;

    const currentPos = e.lngLat;
    const newMap = this.fogMap.addLine(
      this.drawScribbleLastPos.lng,
      this.drawScribbleLastPos.lat,
      currentPos.lng,
      currentPos.lat
    );

    const segmentBbox = Bbox.fromTwoPoints(this.drawScribbleLastPos, currentPos);

    if (this.scribbleStrokeBbox) {
      this.scribbleStrokeBbox = Bbox.merge(this.scribbleStrokeBbox, segmentBbox);
    }

    this.updateFogMap(newMap, segmentBbox, true);
    this.drawScribbleLastPos = currentPos;
  }

  private handleDeleteBlockMove(e: mapboxgl.MapMouseEvent): void {
    if (e.originalEvent.buttons === 1) {
      this.handleDeleteBlockInteraction(e.lngLat);
    }
    this.updateDeleteBlockCursor(e.lngLat);
  }

  private handleDeletePixelMove(e: mapboxgl.MapMouseEvent): void {
    MapEraserUtils.updateDeletePixelCursorLayer(
      this.map,
      this.deletePixelCursorLayerId,
      e.lngLat,
      this.currentDeletePixelSize
    );
    if (e.originalEvent.buttons === 1 && this.deletePixelLastPos) {
      this.handleDeletePixelInteraction(e.lngLat);
    }
  }



  private handleEraserRelease(e: mapboxgl.MapMouseEvent): void {
    if (!this.map || !this.eraserArea) return;
    const [startPoint, eraserSource] = this.eraserArea;
    const bounds = Bbox.fromTwoPoints(e.lngLat, startPoint);

    MapEraserUtils.cleanupEraserLayers(
      this.map,
      MapController.LAYER_IDS.ERASER,
      MapController.LAYER_IDS.ERASER_OUTLINE
    );

    const newMap = this.fogMap.clearBbox(bounds);
    this.updateFogMap(newMap, bounds);

    this.eraserArea = null;
  }

  private handleDrawScribbleRelease(e: mapboxgl.MapMouseEvent): void {
    if (this.scribbleStrokeBbox) {
      this.historyManager.append(this.fogMap, this.scribbleStrokeBbox);
    }
    this.drawScribbleLastPos = null;
    this.scribbleStrokeBbox = null;
    this.map?.dragPan.enable();
  }

  private handleDeleteBlockRelease(e: mapboxgl.MapMouseEvent): void {
    const newMap = this.fogMap.removeBlocks(this.deleteBlockState.blocks);
    this.updateFogMap(newMap, this.deleteBlockState.bbox || "all");

    this.deleteBlockState = this.resetDeleteBlockState();
    MapEraserUtils.updatePendingDeleteLayer(
      this.map,
      this.deleteBlockState.features
    );
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
    this.deletePixelLastPos = null;
    if (this.showGrid) {
      this.updateGridLayer();
    }
    this.map?.dragPan.enable();
    this.onChange();
  }

  getIsDeletingPixel(): boolean {
    return this.drawingSession !== null;
  }

  getDeletePixelSize(): number {
    return this.currentDeletePixelSize;
  }

  setDeletePixelSize(size: number): void {
    if (size > 0) {
      this.currentDeletePixelSize = size;
      if (this.controlMode === ControlMode.DeletePixel && this.deletePixelLastPos) {
        MapEraserUtils.updateDeletePixelCursorLayer(
          this.map,
          this.deletePixelCursorLayerId,
          this.deletePixelLastPos,
          this.currentDeletePixelSize
        );
      }
      this.onChange();
    }
  }

  setControlMode(newMode: ControlMode): void {
    const mapboxCanvas = this.map?.getCanvasContainer();
    if (!mapboxCanvas) return;

    // disable the current active mode
    switch (this.controlMode) {
      case ControlMode.View:
        break;
      case ControlMode.DrawLine:
        this.mapDraw?.deactivate();
        break;
      case ControlMode.DrawScribble:
        this.drawScribbleLastPos = null;
        break;
      case ControlMode.Eraser:
        if (this.eraserArea) {
          MapEraserUtils.cleanupEraserLayers(
            this.map,
            MapController.LAYER_IDS.ERASER,
            MapController.LAYER_IDS.ERASER_OUTLINE
          );
          this.eraserArea = null;
        }
        break;
      case ControlMode.DeleteBlock:
        this.showGrid = false;
        MapEraserUtils.cleanupDeleteBlockLayers(this.map);
        this.deleteBlockCursor?.remove();
        this.deleteBlockCursor = null;
        this.deleteBlockState = this.resetDeleteBlockState();
        break;
      case ControlMode.DeletePixel:
        MapEraserUtils.cleanupDeletePixelLayer(
          this.map,
          this.deletePixelCursorLayerId
        );
        break;
    }

    // enable the new mode
    switch (newMode) {
      case ControlMode.View:
        mapboxCanvas.style.cursor = "grab";
        this.map?.dragPan.enable();
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

        MapEraserUtils.initDeletePixelCursorLayer(this.map, this.deletePixelCursorLayerId);
        break;
    }
    this.controlMode = newMode;
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
      MapEraserUtils.updatePendingDeleteLayer(
        this.map,
        this.deleteBlockState.features
      );
    }
  }

  private handleDeletePixelInteraction(lngLat: mapboxgl.LngLat) {
    if (!this.map || !this.deletePixelLastPos || !this.drawingSession) return;

    const result = MapEraserUtils.handleDeletePixelInteraction(
      this.fogMap,
      this.drawingSession,
      this.deletePixelLastPos,
      lngLat,
      this.currentDeletePixelSize
    );

    if (result && result.changed) {
      this.updateFogMap(result.newMap, result.segmentBbox, true, true);
    }

    this.deletePixelLastPos = lngLat;
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
