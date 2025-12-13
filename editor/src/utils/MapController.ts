import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { FogMap } from "./FogMap";
import { HistoryManager } from "./HistoryManager";
import { MapDraw } from "./MapDraw";
import { MapRenderer, MAPBOX_MAIN_CANVAS_LAYER } from "./MapRenderer";
import { GridRenderer } from "./GridRenderer";
import { Bbox } from "./CommonTypes";

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
  private gridRenderer: GridRenderer;
  private _showGrid = false;
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
    const delPixelMode = this.modeManager?.getStrategy(ControlMode.DelPixel);
    if (delPixelMode && 'getDelPixelSize' in delPixelMode) {
      return (delPixelMode as any).getDelPixelSize();
    }
    return 5; // default
  }

  setDelPixelSize(size: number): void {
    const delPixelMode = this.modeManager?.getStrategy(ControlMode.DelPixel);
    if (delPixelMode && 'setDelPixelSize' in delPixelMode) {
      (delPixelMode as any).setDelPixelSize(size);
      this.onChange();
    }
  }

  getIsDeletingPixel(): boolean {
    // Check if currently in DelPixel mode and actively drawing
    return this.controlMode === ControlMode.DelPixel;
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
    // All modes are now managed by ModeManager
    this.modeManager?.setMode(newMode);
    this.controlMode = newMode;
  }

  // ============================================================================
  // Event Handling - Main Entry Points
  // ============================================================================
  handleMousePress(e: mapboxgl.MapMouseEvent): void {
    if (DEBUG) console.log(`[Mouse Press] at ${e.lngLat}`);

    // All modes are now managed by ModeManager
    this.modeManager?.handleMousePress(e);
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent): void {
    // All modes are now managed by ModeManager
    this.modeManager?.handleMouseMove(e);
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
    // All modes are now managed by ModeManager
    this.modeManager?.handleMouseRelease(e);
  }
}
