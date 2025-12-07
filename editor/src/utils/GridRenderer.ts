import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";

export class GridRenderer {
  private readonly BLOCKS_LAYER_ID = "blocks-layer";
  private readonly BLOCKS_SOURCE_ID = "blocks-source";
  private readonly TILES_LAYER_ID = "tiles-layer";
  private readonly TILES_SOURCE_ID = "tiles-source";

  private activeTileCount = 0;
  private activeBlockCount = 0;

  public getStats() {
    return {
      tiles: this.activeTileCount,
      blocks: this.activeBlockCount,
    };
  }

  public update(
    map: mapboxgl.Map,
    currentFogMap: fogMap.FogMap,
    showGrid: boolean
  ): void {
    if (!showGrid) {
      this.remove(map);
      return;
    }

    const zoom = map.getZoom();

    if (zoom > 8.5) {
      this.showTile(map, currentFogMap);
      this.showBlock(map, currentFogMap);
    } else if (zoom > 6) {
      this.showTile(map, currentFogMap);
      this.clearBlockLayer(map);
    } else {
      this.clearTileLayer(map);
      this.clearBlockLayer(map);
    }
  }

  public remove(map: mapboxgl.Map): void {
    if (map.getLayer(this.BLOCKS_LAYER_ID))
      map.removeLayer(this.BLOCKS_LAYER_ID);
    if (map.getSource(this.BLOCKS_SOURCE_ID))
      map.removeSource(this.BLOCKS_SOURCE_ID);
    if (map.getLayer(this.TILES_LAYER_ID)) map.removeLayer(this.TILES_LAYER_ID);
    if (map.getSource(this.TILES_SOURCE_ID))
      map.removeSource(this.TILES_SOURCE_ID);

    this.activeTileCount = 0;
    this.activeBlockCount = 0;
  }

  private showTile(map: mapboxgl.Map, currentFogMap: fogMap.FogMap): void {
    const tileFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    const tiles = currentFogMap.tiles;

    Object.values(tiles).forEach((tile) => {
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
    });

    this.activeTileCount = tileFeatures.length;

    this.updateLayerData(
      map,
      this.TILES_SOURCE_ID,
      this.TILES_LAYER_ID,
      tileFeatures,
      "#8822D8"
    );
  }

  private showBlock(map: mapboxgl.Map, currentFogMap: fogMap.FogMap): void {
    const blockFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    const tiles = currentFogMap.tiles;
    const TILE_WIDTH = fogMap.TILE_WIDTH;

    Object.values(tiles).forEach((tile) => {
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

    this.activeBlockCount = blockFeatures.length;

    this.updateLayerData(
      map,
      this.BLOCKS_SOURCE_ID,
      this.BLOCKS_LAYER_ID,
      blockFeatures,
      "#00AAFF"
    );
  }

  private clearTileLayer(map: mapboxgl.Map): void {
    this.activeTileCount = 0;
    this.updateLayerData(
      map,
      this.TILES_SOURCE_ID,
      this.TILES_LAYER_ID,
      [],
      "#8822D8"
    );
  }

  private clearBlockLayer(map: mapboxgl.Map): void {
    this.activeBlockCount = 0;
    this.updateLayerData(
      map,
      this.BLOCKS_SOURCE_ID,
      this.BLOCKS_LAYER_ID,
      [],
      "#00AAFF"
    );
  }

  private updateLayerData(
    map: mapboxgl.Map,
    sourceId: string,
    layerId: string,
    features: GeoJSON.Feature<GeoJSON.Polygon>[],
    color: string
  ): void {
    const data: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: "FeatureCollection",
      features: features,
    };

    const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(sourceId, {
        type: "geojson",
        data: data,
      });
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": color,
          "line-width": 1,
        },
      });
    }
  }
}
