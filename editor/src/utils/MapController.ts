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
  // ============================================================================
  // Constants
  // ============================================================================
  private static readonly DEFAULT_DELETE_PIXEL_SIZE = 16; // 4x4 pixels

  private static readonly CURSOR_STYLES: Record<ControlMode, string> = {
    [ControlMode.View]: 'grab',
    [ControlMode.DrawLine]: 'crosshair',
    [ControlMode.DrawScribble]: 'crosshair',
    [ControlMode.Eraser]: 'cell',
    [ControlMode.DeleteBlock]: 'none',         // hide cursor, user defined cursor
    [ControlMode.DeletePixel]: 'crosshair',    // show cursor and delete pixel cursor due to the pixel is really small
  } as const;

  // ============================================================================
  // Instance Fields
  // ============================================================================
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
  private deletePixelCursorLayerId = MapEraserUtils.LAYER_IDS.DELETE_PIXEL_CURSOR;

  // ============================================================================
  // Constructor and Factory
  // ============================================================================
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

  // ============================================================================
  // Helper Functions (used by constructor and other methods)
  // ============================================================================
  private resetDeleteBlockState(): DeleteBlockState {
    return {
      blocks: {},
      features: [],
      bbox: null,
    };
  }

  // ============================================================================
  // Callback Functions (arrow functions for binding)
  // ============================================================================
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

  // ============================================================================
  // Initialization Methods
  // ============================================================================
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
    this.initEraserLayers(map);
  }

  unregisterMap(_map: mapboxgl.Map): void {
    // TODO
  }

  private initMapStyle(): void {
    // Set the default atmosphere style for globe mode
    this.map?.setFog({});
    this.setMapboxLanguage();
  }

  private initMapDraw(map: mapboxgl.Map): void {
    this.mapDraw = new MapDraw(
      map,
      this.getFogMap,
      this.handleDrawUpdate
    );
  }

  private initEraserLayers(map: mapboxgl.Map): void {
    MapEraserUtils.initEraserLayers(
      map,
      MapEraserUtils.LAYER_IDS.ERASER,
      MapEraserUtils.LAYER_IDS.ERASER_OUTLINE
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

  setResolvedLanguage(resolvedLanguage: string) {
    if (resolvedLanguage !== this.resolvedLanguage) {
      this.resolvedLanguage = resolvedLanguage;
      this.setMapboxLanguage();
    }
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

  // ============================================================================
  // Configuration and State Management (Getters/Setters)
  // ============================================================================
  getMapStyle(): MapStyle {
    return this.mapStyle;
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

  getMapProjection(): MapProjection {
    return this.mapProjection;
  }

  setMapProjection(projection: MapProjection): void {
    if (projection !== this.mapProjection) {
      this.mapProjection = projection;
      this.map?.setProjection(projection);
      this.mapRenderer?.maybeRenderOnce();
    }
  }

  getFogConcentration(): FogConcentration {
    return this.fogConcentration;
  }

  setFogConcentration(fogConcentration: FogConcentration): void {
    if (fogConcentration !== this.fogConcentration) {
      this.fogConcentration = fogConcentration;
      this.redrawArea("all");
    }
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

  getIsDeletingPixel(): boolean {
    return this.drawingSession !== null;
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

  fitBounds(bounds: Bbox): void {
    this.map?.fitBounds(
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

  // ============================================================================
  // Callback Management
  // ============================================================================
  registerOnChangeCallback(key: string, callback: () => void) {
    this.onChangeCallback[key] = callback;
    this.onChange();
  }

  unregisterOnChangeCallback(key: string) {
    delete this.onChangeCallback[key];
  }

  private onChange() {
    Object.values(this.onChangeCallback).forEach((callback) => callback());
  }

  // ============================================================================
  // FogMap Update Logic
  // ============================================================================
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

  replaceFogMap(newMap: fogMap.FogMap): void {
    this.historyManager = new HistoryManager(fogMap.FogMap.empty);
    this.updateFogMap(newMap, "all");
  }

  redrawArea(area: Bbox | "all"): void {
    this.mapRenderer?.redrawArea(area);
  }

  undo(): void {
    this.historyManager.undo(this.applyFogMapUpdate.bind(this));
  }

  redo(): void {
    this.historyManager.redo(this.applyFogMapUpdate.bind(this));
  }

  // ============================================================================
  // Grid Management
  // ============================================================================
  toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }

  private updateGridLayer(): void {
    if (!this.map) return;
    this.gridRenderer.update(this.map, this.fogMap, this.showGrid);
  }

  private handleZoomEnd(): void {
    if (this.showGrid) {
      this.updateGridLayer();
    }
  }

  // ============================================================================
  // Control Mode Management
  // ============================================================================
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
        MapEraserUtils.setEraserLayersVisibility(
          this.map,
          MapEraserUtils.LAYER_IDS.ERASER,
          MapEraserUtils.LAYER_IDS.ERASER_OUTLINE,
          false
        );
        this.eraserArea = null;
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
    if (newMode === ControlMode.View)
      this.map?.dragPan.enable();
    else
      this.map?.dragPan.disable();

    switch (newMode) {
      case ControlMode.View:
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.View];
        break;
      case ControlMode.DrawLine:
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.DrawLine];
        this.mapDraw?.activate();
        break;
      case ControlMode.DrawScribble:
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.DrawScribble];
        break;
      case ControlMode.Eraser:
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.Eraser];
        MapEraserUtils.setEraserLayersVisibility(
          this.map,
          MapEraserUtils.LAYER_IDS.ERASER,
          MapEraserUtils.LAYER_IDS.ERASER_OUTLINE,
          true
        );
        break;
      case ControlMode.DeleteBlock:
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.DeleteBlock];
        this.showGrid = true;
        break;
      case ControlMode.DeletePixel:
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.DeletePixel];
        MapEraserUtils.initDeletePixelCursorLayer(this.map, this.deletePixelCursorLayerId);
        break;
    }
    this.controlMode = newMode;
  }

  // ============================================================================
  // Event Handling - Main Entry Points
  // ============================================================================
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

  // ============================================================================
  // DrawScribble Mode Handlers
  // ============================================================================
  private handleDrawScribblePress(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.drawScribbleLastPos = e.lngLat;
    this.scribbleStrokeBbox = Bbox.fromPoint(e.lngLat);
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

  private handleDrawScribbleRelease(e: mapboxgl.MapMouseEvent): void {
    if (this.scribbleStrokeBbox) {
      this.historyManager.append(this.fogMap, this.scribbleStrokeBbox);
    }
    this.drawScribbleLastPos = null;
    this.scribbleStrokeBbox = null;
    this.map?.dragPan.enable();
  }

  // ============================================================================
  // Eraser Mode Handlers
  // ============================================================================
  private handleEraserPress(e: mapboxgl.MapMouseEvent): void {
    if (!this.eraserArea) {
      const eraserSource = this.map?.getSource(
        MapEraserUtils.LAYER_IDS.ERASER
      ) as mapboxgl.GeoJSONSource | null;

      if (eraserSource) {
        const startPoint = new mapboxgl.LngLat(e.lngLat.lng, e.lngLat.lat);
        this.eraserArea = [startPoint, eraserSource];
      }
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

  private handleEraserRelease(e: mapboxgl.MapMouseEvent): void {
    if (!this.map || !this.eraserArea) return;
    const [startPoint, eraserSource] = this.eraserArea;
    const bounds = Bbox.fromTwoPoints(e.lngLat, startPoint);

    // 清空 layer 資料
    eraserSource.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[]],
      },
    });

    const newMap = this.fogMap.clearBbox(bounds);
    this.updateFogMap(newMap, bounds);

    this.eraserArea = null;
  }

  // ============================================================================
  // DeleteBlock Mode Handlers
  // ============================================================================
  private handleDeleteBlockPress(e: mapboxgl.MapMouseEvent): void {
    this.deleteBlockState = this.resetDeleteBlockState();
    this.handleDeleteBlockInteraction(e.lngLat);
  }

  private handleDeleteBlockMove(e: mapboxgl.MapMouseEvent): void {
    if (e.originalEvent.buttons === 1) {
      this.handleDeleteBlockInteraction(e.lngLat);
    }
    this.updateDeleteBlockCursor(e.lngLat);
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

  // ============================================================================
  // DeletePixel Mode Handlers
  // ============================================================================
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
    this.onChange();
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
}
