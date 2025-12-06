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
  EraserScribble,
  DrawLine,
  DrawScribble,
  DeleteBlock,
}

export class MapController {
  private static instance: MapController | null = null;
  private map: mapboxgl.Map | null;
  private mapRenderer: MapRenderer | null;
  public fogMap: fogMap.FogMap;
  public historyManager: HistoryManager;
  private controlMode: ControlMode;
  private eraserArea: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null;
  private scribbleLastPos: mapboxgl.LngLat | null;
  private scribbleStrokeBbox: Bbox | null;
  private mapDraw: MapDraw | null;
  private onChangeCallback: { [key: string]: () => void };
  private mapStyle: MapStyle;
  private mapProjection: MapProjection;
  private resolvedLanguage: string;
  private fogConcentration: FogConcentration;
  private deleteBlockCursor: [mapboxgl.LngLat, mapboxgl.GeoJSONSource] | null;
  private pendingDeleteBlocks: { [tileKey: string]: Set<string> };
  private pendingDeleteFeatures: GeoJSON.Feature<GeoJSON.Polygon>[];
  private pendingDeleteBbox: Bbox | null;
  private eraserStrokeBbox: Bbox | null;

  private constructor() {
    this.map = null;
    this.fogMap = fogMap.FogMap.empty;
    this.controlMode = ControlMode.View;
    this.eraserArea = null;
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
    this.deleteBlockCursor = null;
    this.pendingDeleteBlocks = {};
    this.pendingDeleteFeatures = [];
    this.pendingDeleteBbox = null;
    this.eraserStrokeBbox = null;
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

  private showGrid = false;

  private updateGridLayer(): void {
    const blocksLayerId = "blocks-layer";
    const blocksSourceId = "blocks-source";
    const tilesLayerId = "tiles-layer";
    const tilesSourceId = "tiles-source";

    if (!this.map) return;

    if (!this.showGrid) {
      if (this.map.getLayer(blocksLayerId)) this.map.removeLayer(blocksLayerId);
      if (this.map.getSource(blocksSourceId))
        this.map.removeSource(blocksSourceId);
      if (this.map.getLayer(tilesLayerId)) this.map.removeLayer(tilesLayerId);
      if (this.map.getSource(tilesSourceId))
        this.map.removeSource(tilesSourceId);
      return;
    }

    const blockFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    const tileFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    const tiles = this.fogMap.tiles;
    const TILE_WIDTH = fogMap.TILE_WIDTH;

    Object.values(tiles).forEach((tile) => {
      // Tile boundary
      const tx0 = tile.x;
      const ty0 = tile.y;
      const tx1 = tile.x + 1;
      const ty1 = tile.y + 1;

      const tnw = fogMap.Tile.XYToLngLat(tx0, ty0);
      const tne = fogMap.Tile.XYToLngLat(tx1, ty0);
      const tse = fogMap.Tile.XYToLngLat(tx1, ty1);
      const tsw = fogMap.Tile.XYToLngLat(tx0, ty1);

      tileFeatures.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[tnw, tsw, tse, tne, tnw]],
        },
        properties: {},
      });

      // Block boundaries
      Object.values(tile.blocks).forEach((block) => {
        const x0 = tile.x + block.x / TILE_WIDTH;
        const y0 = tile.y + block.y / TILE_WIDTH;
        const x1 = tile.x + (block.x + 1) / TILE_WIDTH;
        const y1 = tile.y + (block.y + 1) / TILE_WIDTH;

        const nw = fogMap.Tile.XYToLngLat(x0, y0);
        const ne = fogMap.Tile.XYToLngLat(x1, y0);
        const se = fogMap.Tile.XYToLngLat(x1, y1);
        const sw = fogMap.Tile.XYToLngLat(x0, y1);

        blockFeatures.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[nw, sw, se, ne, nw]],
          },
          properties: {},
        });
      });
    });

    // Update Blocks Layer
    const blocksData: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: "FeatureCollection",
      features: blockFeatures,
    };

    const blocksSource = this.map.getSource(
      blocksSourceId
    ) as mapboxgl.GeoJSONSource;
    if (blocksSource) {
      blocksSource.setData(blocksData);
    } else {
      this.map.addSource(blocksSourceId, {
        type: "geojson",
        data: blocksData,
      });
      this.map.addLayer({
        id: blocksLayerId,
        type: "line",
        source: blocksSourceId,
        paint: {
          "line-color": "#00AAFF", // Sky Blue
          "line-width": 1,
        },
      });
    }

    // Update Tiles Layer
    const tilesData: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: "FeatureCollection",
      features: tileFeatures,
    };

    const tilesSource = this.map.getSource(
      tilesSourceId
    ) as mapboxgl.GeoJSONSource;
    if (tilesSource) {
      tilesSource.setData(tilesData);
    } else {
      this.map.addSource(tilesSourceId, {
        type: "geojson",
        data: tilesData,
      });
      this.map.addLayer({
        id: tilesLayerId,
        type: "line",
        source: tilesSourceId,
        paint: {
          "line-color": "#8822D8", // Thistle (Light Purple)
          "line-width": 1,
        },
      });
    }
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.updateGridLayer();
  }

  redrawArea(area: Bbox | "all"): void {
    this.mapRenderer?.redrawArea(area);
  }

  private applyFogMapUpdate(newMap: fogMap.FogMap, areaChanged: Bbox | "all") {
    this.fogMap = newMap;
    this.redrawArea(areaChanged);
    this.updateGridLayer();

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
    } else if (this.controlMode === ControlMode.DrawScribble) {
      this.map?.dragPan.disable();
      this.scribbleLastPos = e.lngLat;
      this.scribbleStrokeBbox = new Bbox(
        e.lngLat.lng,
        e.lngLat.lat,
        e.lngLat.lng,
        e.lngLat.lat
      );
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      this.pendingDeleteBlocks = {};
      this.pendingDeleteFeatures = [];
      this.pendingDeleteBbox = null;
      this.handleDeleteBlockInteraction(e.lngLat);
    } else if (this.controlMode === ControlMode.EraserScribble) {
      this.map?.dragPan.disable();
      this.handleEraserScribbleInteraction(e.lngLat);
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
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      if (e.originalEvent.buttons === 1) {
        this.handleDeleteBlockInteraction(e.lngLat);
      }
      this.updateDeleteBlockCursor(e.lngLat);
    } else if (this.controlMode === ControlMode.EraserScribble) {
      if (e.originalEvent.buttons === 1) {
        this.handleEraserScribbleInteraction(e.lngLat);
      }
      this.updateDeleteBlockCursor(e.lngLat);
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
      this.controlMode === ControlMode.DrawScribble &&
      this.scribbleLastPos
    ) {
      if (this.scribbleStrokeBbox) {
        this.historyManager.append(this.fogMap, this.scribbleStrokeBbox);
      }
      this.scribbleLastPos = null;
      this.scribbleStrokeBbox = null;
      this.map?.dragPan.enable();
    } else if (this.controlMode === ControlMode.DeleteBlock) {
      const newMap = this.fogMap.removeBlocks(this.pendingDeleteBlocks);
      this.updateFogMap(newMap, this.pendingDeleteBbox || "all");

      this.pendingDeleteBlocks = {};
      this.pendingDeleteFeatures = [];
      this.pendingDeleteBbox = null;
      this.updatePendingDeleteLayer();
    } else if (this.controlMode === ControlMode.EraserScribble) {
      if (this.eraserStrokeBbox) {
        this.historyManager.append(this.fogMap, this.eraserStrokeBbox);
        this.eraserStrokeBbox = null;
      }
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
        this.updateGridLayer();
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
        this.updateGridLayer();
        if (this.deleteBlockCursor) {
          const layerId = "delete-block-cursor";
          if (this.map?.getLayer(layerId)) this.map?.removeLayer(layerId);
          if (this.map?.getLayer(layerId + "-outline"))
            this.map?.removeLayer(layerId + "-outline");
          if (this.map?.getSource(layerId)) this.map?.removeSource(layerId);
          this.deleteBlockCursor = null;
        }
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
        this.updateGridLayer();
        break;
      case ControlMode.EraserScribble:
        mapboxCanvas.style.cursor = "none";
        this.map?.dragPan.disable();
        this.showGrid = true;
        this.updateGridLayer();
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

    // Define cursor size 20px
    const point = this.map.project(lngLat);
    const halfSize = 10; // 20px total
    const nwPoint = new mapboxgl.Point(point.x - halfSize, point.y - halfSize);
    const nePoint = new mapboxgl.Point(point.x + halfSize, point.y - halfSize);
    const sePoint = new mapboxgl.Point(point.x + halfSize, point.y + halfSize);
    const swPoint = new mapboxgl.Point(point.x - halfSize, point.y + halfSize);

    const tnw = this.map.unproject(nwPoint);
    const tne = this.map.unproject(nePoint);
    const tse = this.map.unproject(sePoint);
    const tsw = this.map.unproject(swPoint);

    // Convert LngLat object to array [lng, lat]
    const cnw = [tnw.lng, tnw.lat];
    const cne = [tne.lng, tne.lat];
    const cse = [tse.lng, tse.lat];
    const csw = [tsw.lng, tsw.lat];

    const data: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[cnw, csw, cse, cne, cnw]], // CCW
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
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#FFFFFF",
          "fill-opacity": 0.3,
        },
      });
      this.map.addLayer({
        id: layerId + "-outline",
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 1,
        },
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
    if (!this.map) return;

    const point = this.map.project(lngLat);
    const halfSize = 10;
    const nwPoint = new mapboxgl.Point(point.x - halfSize, point.y - halfSize);
    const sePoint = new mapboxgl.Point(point.x + halfSize, point.y + halfSize);

    const tnw = this.map.unproject(nwPoint);
    const tse = this.map.unproject(sePoint);

    const west = Math.min(tnw.lng, tse.lng);
    const east = Math.max(tnw.lng, tse.lng);
    const north = Math.max(tnw.lat, tse.lat);
    const south = Math.min(tnw.lat, tse.lat);

    const bbox = new Bbox(west, south, east, north);

    const newMap = this.fogMap.clearBbox(bbox);
    this.updateFogMap(newMap, bbox, true);

    if (!this.eraserStrokeBbox) {
      this.eraserStrokeBbox = bbox;
    } else {
      this.eraserStrokeBbox = new Bbox(
        Math.min(this.eraserStrokeBbox.west, bbox.west),
        Math.min(this.eraserStrokeBbox.south, bbox.south),
        Math.max(this.eraserStrokeBbox.east, bbox.east),
        Math.max(this.eraserStrokeBbox.north, bbox.north)
      );
    }
  }
}
