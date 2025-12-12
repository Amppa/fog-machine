import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { FogMap } from "./FogMap";
import { HistoryManager } from "./HistoryManager";
import { MapDraw } from "./MapDraw";
import { MapRenderer, MAPBOX_MAIN_CANVAS_LAYER } from "./MapRenderer";
import { GridRenderer } from "./GridRenderer";
import { Bbox } from "./CommonTypes";
import * as MapEraserUtils from "./MapEraserUtils";
import { DelBlockState, DrawingSession } from "./MapEraserUtils";
import { ModeManager, ModeContext, DelRectMode } from "./modes";

const DEBUG = false;

type MapStyle = "standard" | "satellite" | "hybrid" | "none";
type MapProjection = "globe" | "mercator";
type FogConcentration = "low" | "medium" | "high";

export enum ControlMode {
  View,
  DrawPolyline,
  DrawScribble,
  DelRect,
  DelBlock,
  DelPixel,
}

export class MapController {
  // ============================================================================
  // Constants
  // ============================================================================
  private static readonly DEFAULT_DEL_PIXEL_SIZE = 16; // 4x4 pixels

  private static readonly CURSOR_STYLES: Record<ControlMode, string> = {
    [ControlMode.View]: 'grab',
    [ControlMode.DrawPolyline]: 'crosshair',
    [ControlMode.DrawScribble]: 'crosshair',
    [ControlMode.DelRect]: 'cell',
    [ControlMode.DelBlock]: 'none',         // hide cursor, user defined cursor
    [ControlMode.DelPixel]: 'crosshair',    // show cursor and delete pixel cursor due to the pixel is really small
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
  private delPixelLastPos: mapboxgl.LngLat | null;
  private delBlockCursor: mapboxgl.Marker | null;
  private delBlockState: DelBlockState;
  private eraserStrokeBbox: Bbox | null;
  private drawingSession: DrawingSession | null;
  private gridRenderer: GridRenderer;
  private _showGrid = false;
  private currentDelPixelSize = MapController.DEFAULT_DEL_PIXEL_SIZE;
  private delPixelCursorLayerId = MapEraserUtils.LAYER_IDS.DEL_PIXEL_CURSOR;
  private modeManager: ModeManager | null;

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
    this.delPixelLastPos = null;
    this.delBlockCursor = null;
    this.delBlockState = this.resetDelBlockState();
    this.eraserStrokeBbox = null;
    this.drawingSession = null;
    this.gridRenderer = new GridRenderer();
    this.modeManager = null;
  }

  static create(): MapController {
    if (MapController.instance) {
      if (DEBUG) console.warn(
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
  private resetDelBlockState(): DelBlockState {
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
    this.initDelRectLayers(map);
    this.initModeManager(map);
    this.initMapDraw(map);
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
    // Set MapDraw instance to DrawPolylineMode
    this.modeManager?.setMapDraw(this.mapDraw);
  }

  private initDelRectLayers(map: mapboxgl.Map): void {
    DelRectMode.initLayers(map);
  }

  private initModeManager(map: mapboxgl.Map): void {
    const context: ModeContext = {
      map: map,
      get fogMap() {
        return MapController.instance?.fogMap || FogMap.empty;
      },
      gridRenderer: this.gridRenderer,
      historyManager: this.historyManager,
      updateFogMap: this.updateFogMap.bind(this),
      onChange: this.onChange.bind(this),
    };
    this.modeManager = new ModeManager(context);
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

  getDelPixelSize(): number {
    return this.currentDelPixelSize;
  }

  setDelPixelSize(size: number): void {
    if (size > 0) {
      this.currentDelPixelSize = size;
      if (this.controlMode === ControlMode.DelPixel && this.delPixelLastPos) {
        MapEraserUtils.updateDelPixelCursorLayer(
          this.map,
          this.delPixelCursorLayerId,
          this.delPixelLastPos,
          this.currentDelPixelSize
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
    // Use ModeManager for View, DelRect, DrawPolyline, DrawScribble, and DelBlock modes
    if (newMode === ControlMode.View ||
      newMode === ControlMode.DelRect ||
      newMode === ControlMode.DrawPolyline ||
      newMode === ControlMode.DrawScribble ||
      newMode === ControlMode.DelBlock) {
      this.modeManager?.setMode(newMode);
      this.controlMode = newMode;
      return;
    }

    // Legacy mode switching for other modes
    const mapboxCanvas = this.map?.getCanvasContainer();
    if (!mapboxCanvas) return;

    // disable the current active mode
    switch (this.controlMode) {
      case ControlMode.View:
      case ControlMode.DelRect:
      case ControlMode.DrawPolyline:
      case ControlMode.DrawScribble:
      case ControlMode.DelBlock:
        // Deactivate via ModeManager
        this.modeManager?.setMode(ControlMode.View);
        break;
      case ControlMode.DelPixel:
        MapEraserUtils.cleanupDelPixelLayer(
          this.map,
          this.delPixelCursorLayerId
        );
        break;
    }

    // enable the new mode (dragPan control)
    this.map?.dragPan.disable();

    switch (newMode) {
      case ControlMode.DelPixel: {
        mapboxCanvas.style.cursor = MapController.CURSOR_STYLES[ControlMode.DelPixel];

        // Auto zoom (pixel is too small to operate)
        const currentZoom = this.map?.getZoom();
        if (currentZoom !== undefined && currentZoom < 11) {
          const center = this.map?.getCenter();
          if (center) {
            this.map?.flyTo({
              zoom: 11,
              center: [center.lng, center.lat],
              essential: true,
            });
          }
        }

        MapEraserUtils.initDelPixelCursorLayer(this.map, this.delPixelCursorLayerId);
        break;
      }
    }
    this.controlMode = newMode;
  }

  // ============================================================================
  // Event Handling - Main Entry Points
  // ============================================================================
  handleMousePress(e: mapboxgl.MapMouseEvent): void {
    if (DEBUG) console.log(`[Mouse Press] at ${e.lngLat}`);

    // Use ModeManager for View, DelRect, DrawPolyline, DrawScribble, and DelBlock modes
    if (this.controlMode === ControlMode.View ||
      this.controlMode === ControlMode.DelRect ||
      this.controlMode === ControlMode.DrawPolyline ||
      this.controlMode === ControlMode.DrawScribble ||
      this.controlMode === ControlMode.DelBlock) {
      this.modeManager?.handleMousePress(e);
      return;
    }

    // Legacy event handling for other modes
    switch (this.controlMode) {
      case ControlMode.DelPixel:
        this.handleDelPixelPress(e);
        break;
      default:
        break;
    }
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent): void {
    // Use ModeManager for View, DelRect, DrawPolyline, DrawScribble, and DelBlock modes
    if (this.controlMode === ControlMode.View ||
      this.controlMode === ControlMode.DelRect ||
      this.controlMode === ControlMode.DrawPolyline ||
      this.controlMode === ControlMode.DrawScribble ||
      this.controlMode === ControlMode.DelBlock) {
      this.modeManager?.handleMouseMove(e);
      return;
    }

    // Legacy event handling for other modes
    switch (this.controlMode) {
      case ControlMode.DelPixel:
        this.handleDelPixelMove(e);
        break;
      default:
        break;
    }
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
    // Use ModeManager for View, DelRect, DrawPolyline, DrawScribble, and DelBlock modes
    if (this.controlMode === ControlMode.View ||
      this.controlMode === ControlMode.DelRect ||
      this.controlMode === ControlMode.DrawPolyline ||
      this.controlMode === ControlMode.DrawScribble ||
      this.controlMode === ControlMode.DelBlock) {
      this.modeManager?.handleMouseRelease(e);
      return;
    }

    // Legacy event handling for other modes
    switch (this.controlMode) {
      case ControlMode.DelPixel:
        this.handleDelPixelRelease(e);
        break;
      default:
        break;
    }
  }



  // ============================================================================
  // Eraser Mode Handlers
  // ============================================================================
  private handleEraserPress(e: mapboxgl.MapMouseEvent): void {
    if (!this.eraserArea) {
      const eraserSource = this.map?.getSource(
        MapEraserUtils.LAYER_IDS.DEL_RECT
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
  // DelPixel Mode Handlers
  // ============================================================================
  private handleDelPixelPress(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.delPixelLastPos = e.lngLat;
    this.eraserStrokeBbox = Bbox.fromPoint(e.lngLat);

    this.drawingSession = {
      baseMap: this.fogMap,
      modifiedBlocks: {},
      blockCounts: {},
      erasedArea: Bbox.fromPoint(e.lngLat),
    };

    // Initial interaction on press
    this.handleDelPixelInteraction(e.lngLat);
    this.onChange();
  }

  private handleDelPixelMove(e: mapboxgl.MapMouseEvent): void {
    MapEraserUtils.updateDelPixelCursorLayer(
      this.map,
      this.delPixelCursorLayerId,
      e.lngLat,
      this.currentDelPixelSize
    );
    if (e.originalEvent.buttons === 1 && this.delPixelLastPos) {
      this.handleDelPixelInteraction(e.lngLat);
    }
  }

  private handleDelPixelRelease(_e: mapboxgl.MapMouseEvent): void {
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
    this.delPixelLastPos = null;
    this.onChange();
  }

  private handleDelPixelInteraction(lngLat: mapboxgl.LngLat) {
    if (!this.map || !this.delPixelLastPos || !this.drawingSession) return;

    const result = MapEraserUtils.handleDelPixelInteraction(
      this.fogMap,
      this.drawingSession,
      this.delPixelLastPos,
      lngLat,
      this.currentDelPixelSize
    );

    if (result && result.changed) {
      this.updateFogMap(result.newMap, result.segmentBbox, true, true);
    }

    this.delPixelLastPos = lngLat;
  }
}
