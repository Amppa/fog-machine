// TODO: consider reactify this?
import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";
import { HistoryManager } from "./HistoryManager";
import { MapDraw } from "./MapDraw";
import { MapRenderer, MAPBOX_MAIN_CANVAS_LAYER } from "./MapRenderer";
import { GridRenderer } from "./GridRenderer";
import { Bbox } from "./CommonTypes";

type MapStyle = "standard" | "satellite" | "hybrid" | "none";
type MapProjection = "globe" | "mercator";
type FogConcentration = "low" | "medium" | "high";

export enum ControlMode {
  View,
  Eraser,
  EraserScribble,
  DrawLine,
  DrawScribble,
  DeleteBlock,
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
  private deleteBlockCursor: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null;
  private pendingDeleteBlocks: { [tileKey: string]: Set<string> };
  private pendingDeleteFeatures: GeoJSON.Feature<GeoJSON.Polygon>[];
  private pendingDeleteBbox: Bbox | null;
  private eraserStrokeBbox: Bbox | null;
  private drawingSession: DrawingSession | null;
  private gridRenderer: GridRenderer;
  private _showGrid = false;

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
    this.pendingDeleteBlocks = {};
    this.pendingDeleteFeatures = [];
    this.pendingDeleteBbox = null;
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
    this.map.on("mousedown", this.handleMouseClick.bind(this));
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

  debugGridInfo(): void {
    if (this.map && this.showGrid) {
      const zoom = this.map.getZoom();
      const stats = this.gridRenderer.getStats();
      console.log(
        `Zoom Level: ${zoom.toFixed(2)}\n
        Total Tiles: ${stats.tiles.total},
        Blocks: ${stats.blocks.total}\n
        Visiable Tiles: ${stats.tiles.visible},
        Blocks: ${stats.blocks.visible}`
      );
    }
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.debugGridInfo();
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

  handleMouseClick(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser) {
      this.handleEraserClick(e);
    } else if (this.controlMode === ControlMode.DrawScribble) {
      this.handleDrawScribbleClick(e);
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.handleDeleteBlockClick(e);
    } else if (this.controlMode === ControlMode.EraserScribble) {
      this.handleEraserScribbleClick(e);
    }
  }

  private handleEraserClick(e: mapboxgl.MapMouseEvent): void {
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
  }

  private handleDrawScribbleClick(e: mapboxgl.MapMouseEvent): void {
    this.map?.dragPan.disable();
    this.scribbleLastPos = e.lngLat;
    this.scribbleStrokeBbox = new Bbox(
      e.lngLat.lng,
      e.lngLat.lat,
      e.lngLat.lng,
      e.lngLat.lat
    );
  }

  private handleDeleteBlockClick(e: mapboxgl.MapMouseEvent): void {
    this.pendingDeleteBlocks = {};
    this.pendingDeleteFeatures = [];
    this.pendingDeleteBbox = null;
    this.handleDeleteBlockInteraction(e.lngLat);
  }

  private handleEraserScribbleClick(e: mapboxgl.MapMouseEvent): void {
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
  }

  handleMouseMove(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser && this.eraserArea) {
      this.handleEraserMove(e);
    } else if (
      this.controlMode === ControlMode.DrawScribble &&
      this.scribbleLastPos
    ) {
      this.handleDrawScribbleMove(e);
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.handleDeleteBlockMove(e);
    } else if (this.controlMode === ControlMode.EraserScribble) {
      this.handleEraserScribbleMove(e);
    }
  }

  private handleEraserMove(e: mapboxgl.MapMouseEvent): void {
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
    }
  }

  private handleDrawScribbleMove(e: mapboxgl.MapMouseEvent): void {
    if (this.scribbleLastPos) {
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

  private handleDeleteBlockMove(e: mapboxgl.MapMouseEvent): void {
    if (e.originalEvent.buttons === 1) {
      this.handleDeleteBlockInteraction(e.lngLat);
    }
    this.updateDeleteBlockCursor(e.lngLat);
  }

  private handleEraserScribbleMove(e: mapboxgl.MapMouseEvent): void {
    if (e.originalEvent.buttons === 1 && this.scribbleLastPos) {
      this.handleEraserScribbleInteraction(e.lngLat);
    }
  }

  handleMouseRelease(e: mapboxgl.MapMouseEvent): void {
    if (this.controlMode === ControlMode.Eraser && this.eraserArea) {
      this.handleEraserRelease(e);
    } else if (
      this.controlMode === ControlMode.DrawScribble &&
      this.scribbleLastPos
    ) {
      this.handleDrawScribbleRelease(e);
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.handleDeleteBlockRelease(e);
    } else if (this.controlMode === ControlMode.EraserScribble) {
      this.handleEraserScribbleRelease(e);
    }
  }

  private handleEraserRelease(e: mapboxgl.MapMouseEvent): void {
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
    }
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
    const newMap = this.fogMap.removeBlocks(this.pendingDeleteBlocks);
    this.updateFogMap(newMap, this.pendingDeleteBbox || "all");

    this.pendingDeleteBlocks = {};
    this.pendingDeleteFeatures = [];
    this.pendingDeleteBbox = null;
    this.updatePendingDeleteLayer();
    this.map?.dragPan.enable();
  }

  private handleEraserScribbleRelease(e: mapboxgl.MapMouseEvent): void {
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
      case ControlMode.DeleteBlock: {
        mapboxCanvas.style.cursor = "";
        this.map?.dragPan.enable();
        this.showGrid = false;
        if (this.deleteBlockCursor) {
          const layerId = "delete-block-cursor";
          if (this.map?.getLayer(layerId)) this.map?.removeLayer(layerId);
          if (this.map?.getLayer(layerId + "-outline"))
            this.map?.removeLayer(layerId + "-outline");
          if (this.map?.getSource(layerId)) this.map?.removeSource(layerId);
          this.deleteBlockCursor = null;
        }
        // Cleanup pending layer
        const pendingLayerId = "pending-delete-layer";
        if (this.map?.getLayer(pendingLayerId))
          this.map?.removeLayer(pendingLayerId);
        if (this.map?.getSource(pendingLayerId))
          this.map?.removeSource(pendingLayerId);
        this.pendingDeleteBlocks = {};
        this.pendingDeleteFeatures = [];
        this.pendingDeleteBbox = null;
        break;
      }
      case ControlMode.EraserScribble: {
        mapboxCanvas.style.cursor = "";
        this.map?.dragPan.enable();
        this.showGrid = false;
        break;
      }
    }

    // enable the new mode
    switch (mode) {
      case ControlMode.View:
        break;
      case ControlMode.Eraser:
        mapboxCanvas.style.cursor = "cell";
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
      case ControlMode.DeleteBlock:
        mapboxCanvas.style.cursor = "none";
        this.map?.dragPan.disable();
        this.showGrid = true;
        break;
      case ControlMode.EraserScribble:
        mapboxCanvas.style.cursor = "crosshair";
        this.map?.dragPan.disable();
        this.showGrid = true;
        break;
    }
    this.controlMode = mode;
  }

  private updatePendingDeleteLayer() {
    if (!this.map) return;
    const layerId = "pending-delete-layer";
    const sourceId = "pending-delete-layer";

    const data: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: "FeatureCollection",
      features: this.pendingDeleteFeatures,
    };

    const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(data);
    } else {
      this.map.addSource(sourceId, {
        type: "geojson",
        data: data,
      });
      this.map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#2200CC",
          "line-width": 2,
        },
      });
    }
  }

  private updateDeleteBlockCursor(lngLat: mapboxgl.LngLat) {
    if (!this.map) return;
    const layerId = "delete-block-cursor";
    const sourceId = "delete-block-cursor";
    const imageId = "red-square-cursor";

    // Ensure the red square image exists
    // (It might be created by Eraser first, or not. Check again.)
    if (!this.map.hasImage(imageId)) {
      const size = 20;
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const isBorder =
            x === 0 || x === size - 1 || y === 0 || y === size - 1;
          data[i] = 255;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = isBorder ? 255 : 128; // 0.5 opacity fill, solid border
        }
      }
      this.map.addImage(imageId, { width: size, height: size, data: data });
    }

    // Use Point geometry for fixed-size icon
    const data: GeoJSON.Feature<GeoJSON.Point> = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lngLat.lng, lngLat.lat],
      },
      properties: {},
    };

    if (!this.deleteBlockCursor) {
      this.map.addSource(sourceId, {
        type: "geojson",
        data: data,
      });
      this.map.addLayer({
        id: layerId,
        type: "symbol",
        source: sourceId,
        layout: {
          "icon-image": imageId,
          "icon-size": 1, // 20px / 20px = 1.0
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {},
      });
      const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource;
      this.deleteBlockCursor = [lngLat, source];
    } else {
      const source = this.deleteBlockCursor[1];
      source.setData(data);
      this.deleteBlockCursor[0] = lngLat;
    }
  }

  private handleDeleteBlockInteraction(lngLat: mapboxgl.LngLat) {
    if (!this.map) return;

    // Calculate bbox from 20px cursor logic
    const point = this.map.project(lngLat);
    const halfSize = 10;
    const nwPoint = new mapboxgl.Point(point.x - halfSize, point.y - halfSize);
    const sePoint = new mapboxgl.Point(point.x + halfSize, point.y + halfSize);

    const tnw = this.map.unproject(nwPoint);
    const tse = this.map.unproject(sePoint);

    // Construct bbox from the corner LngLats
    const west = Math.min(tnw.lng, tse.lng);
    const east = Math.max(tnw.lng, tse.lng);
    const north = Math.max(tnw.lat, tse.lat);
    const south = Math.min(tnw.lat, tse.lat);

    const bbox = new Bbox(west, south, east, north);

    const keys = this.fogMap.getBlocks(bbox);
    const TILE_WIDTH = fogMap.TILE_WIDTH;
    let changed = false;

    keys.forEach(({ tileKey, blockKey }) => {
      if (!this.pendingDeleteBlocks[tileKey]) {
        this.pendingDeleteBlocks[tileKey] = new Set();
      }
      if (!this.pendingDeleteBlocks[tileKey].has(blockKey)) {
        this.pendingDeleteBlocks[tileKey].add(blockKey);
        changed = true;

        const tile = this.fogMap.tiles[tileKey];
        if (tile && tile.blocks[blockKey]) {
          const block = tile.blocks[blockKey];
          const x0 = tile.x + block.x / TILE_WIDTH;
          const y0 = tile.y + block.y / TILE_WIDTH;
          const x1 = tile.x + (block.x + 1) / TILE_WIDTH;
          const y1 = tile.y + (block.y + 1) / TILE_WIDTH;

          const nw = fogMap.Tile.XYToLngLat(x0, y0);
          const ne = fogMap.Tile.XYToLngLat(x1, y0);
          const se = fogMap.Tile.XYToLngLat(x1, y1);
          const sw = fogMap.Tile.XYToLngLat(x0, y1);

          const cnw = [nw[0], nw[1]];
          const cne = [ne[0], ne[1]];
          const cse = [se[0], se[1]];
          const csw = [sw[0], sw[1]];

          this.pendingDeleteFeatures.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[cnw, csw, cse, cne, cnw]],
            },
            properties: {},
          });

          // Update pendingDeleteBbox
          const bWest = Math.min(nw[0], ne[0], se[0], sw[0]);
          const bEast = Math.max(nw[0], ne[0], se[0], sw[0]);
          const bNorth = Math.max(nw[1], ne[1], se[1], sw[1]);
          const bSouth = Math.min(nw[1], ne[1], se[1], sw[1]);

          if (!this.pendingDeleteBbox) {
            this.pendingDeleteBbox = new Bbox(bWest, bSouth, bEast, bNorth);
          } else {
            this.pendingDeleteBbox = new Bbox(
              Math.min(this.pendingDeleteBbox.west, bWest),
              Math.min(this.pendingDeleteBbox.south, bSouth),
              Math.max(this.pendingDeleteBbox.east, bEast),
              Math.max(this.pendingDeleteBbox.north, bNorth)
            );
          }
        }
      }
    });

    if (changed) {
      this.updatePendingDeleteLayer();
    }
  }

  private handleEraserScribbleInteraction(lngLat: mapboxgl.LngLat) {
    if (!this.map || !this.scribbleLastPos || !this.drawingSession) return;

    const currentPos = lngLat;
    const [x0, y0] = fogMap.FogMap.LngLatToGlobalXY(
      this.scribbleLastPos.lng,
      this.scribbleLastPos.lat
    );
    const [x1, y1] = fogMap.FogMap.LngLatToGlobalXY(
      currentPos.lng,
      currentPos.lat
    );

    const TILE_WIDTH = fogMap.TILE_WIDTH;
    const BITMAP_WIDTH = fogMap.BITMAP_WIDTH;
    const BITMAP_WIDTH_OFFSET = fogMap.BITMAP_WIDTH_OFFSET; // 6
    const ALL_OFFSET = fogMap.TILE_WIDTH_OFFSET + BITMAP_WIDTH_OFFSET; // 13

    // Trace line and update mutable bitmaps
    const points = Array.from(fogMap.FogMap.traceLine(x0, y0, x1, y1));
    let changed = false;

    const erasePixel = (gx: number, gy: number) => {
      const tileX = gx >> ALL_OFFSET;
      const tileY = gy >> ALL_OFFSET;
      const tileKey = fogMap.FogMap.makeKeyXY(tileX, tileY);

      const blockX = (gx >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
      const blockY = (gy >> BITMAP_WIDTH_OFFSET) % TILE_WIDTH;
      const blockKey = fogMap.FogMap.makeKeyXY(blockX, blockY);

      let block = this.drawingSession!.modifiedBlocks[tileKey]?.[blockKey];

      // If block is explicitly set to null, it means it's deleted. Skip.
      if (block === null) return;

      if (!block) {
        const tile = this.drawingSession!.baseMap.tiles[tileKey];
        const originalBlock = tile?.blocks[blockKey];

        // If block doesn't exist in original map, we don't need to create it for erasing.
        if (!originalBlock) return;

        block = fogMap.Block.create(blockX, blockY, originalBlock.dump());

        if (!this.drawingSession!.modifiedBlocks[tileKey]) {
          this.drawingSession!.modifiedBlocks[tileKey] = {};
          this.drawingSession!.blockCounts[tileKey] = {};
        }
        this.drawingSession!.modifiedBlocks[tileKey][blockKey] = block;
        this.drawingSession!.blockCounts[tileKey][blockKey] = block.count();
      }

      const localX = gx % BITMAP_WIDTH;
      const localY = gy % BITMAP_WIDTH;

      const bitOffset = 7 - (localX % 8);
      const i = Math.floor(localX / 8);
      const j = localY;
      const index = i + j * 8;

      // Check if pixel is currently ON
      const isSet = (block.bitmap[index] & (1 << bitOffset)) !== 0;

      if (isSet) {
        // Clear the bit
        block.bitmap[index] &= ~(1 << bitOffset);

        // Decrement count
        this.drawingSession!.blockCounts[tileKey][blockKey]--;

        // Check if block is empty
        if (this.drawingSession!.blockCounts[tileKey][blockKey] <= 0) {
          this.drawingSession!.modifiedBlocks[tileKey][blockKey] = null;
        }

        // Mark as changed
        changed = true;
      }
    };

    const ERASER_SIZE = 8;
    const offsetStart = -Math.floor(ERASER_SIZE / 2); // -4
    const offsetEnd = Math.ceil(ERASER_SIZE / 2); // +4

    for (const [x, y] of points) {
      for (let dx = offsetStart; dx < offsetEnd; dx++) {
        for (let dy = offsetStart; dy < offsetEnd; dy++) {
          erasePixel(x + dx, y + dy);
        }
      }
    }

    if (changed) {
      // Construct new FogMap using updateBlocks
      // We update THIS.FOGMAP but we do NOT update drawingSession.baseMap
      const newMap = this.fogMap.updateBlocks(
        this.drawingSession.modifiedBlocks
      );

      // Update BBox
      // TODO: anti-meridian handling if needed
      const segmentBbox = new Bbox(
        Math.min(this.scribbleLastPos.lng, currentPos.lng),
        Math.min(this.scribbleLastPos.lat, currentPos.lat),
        Math.max(this.scribbleLastPos.lng, currentPos.lng),
        Math.max(this.scribbleLastPos.lat, currentPos.lat)
      );

      if (this.drawingSession.erasedArea) {
        const b = this.drawingSession.erasedArea;
        this.drawingSession.erasedArea = new Bbox(
          Math.min(b.west, segmentBbox.west),
          Math.min(b.south, segmentBbox.south),
          Math.max(b.east, segmentBbox.east),
          Math.max(b.north, segmentBbox.north)
        );
      }

      // Update display with skipGridUpdate=true for speed
      this.updateFogMap(newMap, segmentBbox, true, true);
    }

    this.scribbleLastPos = currentPos;
  }
}
