import mapboxgl from "mapbox-gl";
import * as fogMap from "./FogMap";

export class GridRenderer {
  private readonly BLOCKS_LAYER_ID = "blocks-layer";
  private readonly BLOCKS_SOURCE_ID = "blocks-source";
  private readonly TILES_LAYER_ID = "tiles-layer";
  private readonly TILES_SOURCE_ID = "tiles-source";

  private readonly TILE_COLOR = "#8822D8";
  private readonly BLOCK_COLOR = "#00AAFF";

  private stats = {
    tiles: { visible: 0, total: 0 },
    blocks: { visible: 0, total: 0 },
  };

  public getStats() {
    return this.stats;
  }

  public debugInfo(map: mapboxgl.Map): void {
    const zoom = map.getZoom();
    const stats = this.stats;
    console.log(
      `Show Tiles and Blocks. Zoom Level = ${zoom.toFixed(3)}\n`,
      `Total Tiles: ${stats.tiles.total}, Blocks: ${stats.blocks.total}\n`,
      `Visiable Tiles: ${stats.tiles.visible}, Blocks: ${stats.blocks.visible}`
    );
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
    this.debugInfo(map);
  }

  public remove(map: mapboxgl.Map): void {
    if (map.getLayer(this.BLOCKS_LAYER_ID))
      map.removeLayer(this.BLOCKS_LAYER_ID);
    if (map.getSource(this.BLOCKS_SOURCE_ID))
      map.removeSource(this.BLOCKS_SOURCE_ID);
    if (map.getLayer(this.TILES_LAYER_ID)) map.removeLayer(this.TILES_LAYER_ID);
    if (map.getSource(this.TILES_SOURCE_ID))
      map.removeSource(this.TILES_SOURCE_ID);

    this.stats = {
      tiles: { visible: 0, total: 0 },
      blocks: { visible: 0, total: 0 },
    };
  }

  private showTile(map: mapboxgl.Map, currentFogMap: fogMap.FogMap): void {
    const tileFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    const tiles = currentFogMap.tiles;

    const bounds = map.getBounds();
    const mapWest = bounds.getWest();
    const mapEast = bounds.getEast();
    const mapNorth = bounds.getNorth();
    const mapSouth = bounds.getSouth();

    let totalCount = 0;
    let visibleCount = 0;

    Object.values(tiles).forEach((tile) => {
      totalCount++;
      const tx0 = tile.x;
      const ty0 = tile.y;
      const tx1 = tile.x + 1;
      const ty1 = tile.y + 1;

      const tnw = fogMap.Tile.XYToLngLat(tx0, ty0);
      const tne = fogMap.Tile.XYToLngLat(tx1, ty0);
      const tse = fogMap.Tile.XYToLngLat(tx1, ty1);
      const tsw = fogMap.Tile.XYToLngLat(tx0, ty1);

      // tnw, tne, etc are [lng, lat]
      const tileMinLng = Math.min(tnw[0], tne[0], tse[0], tsw[0]);
      const tileMaxLng = Math.max(tnw[0], tne[0], tse[0], tsw[0]);
      const tileMinLat = Math.min(tnw[1], tne[1], tse[1], tsw[1]);
      const tileMaxLat = Math.max(tnw[1], tne[1], tse[1], tsw[1]);

      // Check if tile is completely outside the viewport
      const overlaps = !(
        tileMinLng > mapEast ||
        tileMaxLng < mapWest ||
        tileMinLat > mapNorth ||
        tileMaxLat < mapSouth
      );

      if (overlaps) {
        visibleCount++;
        tileFeatures.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[tnw, tsw, tse, tne, tnw]],
          },
          properties: {},
        });
      }
    });

    this.stats.tiles = { visible: visibleCount, total: totalCount };

    this.updateLayerData(
      map,
      this.TILES_SOURCE_ID,
      this.TILES_LAYER_ID,
      tileFeatures,
      this.TILE_COLOR
    );
  }

  private showBlock(map: mapboxgl.Map, currentFogMap: fogMap.FogMap): void {
    const blockFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    const tiles = currentFogMap.tiles;
    const TILE_WIDTH = fogMap.TILE_WIDTH;

    const bounds = map.getBounds();
    const mapWest = bounds.getWest();
    const mapEast = bounds.getEast();
    const mapNorth = bounds.getNorth();
    const mapSouth = bounds.getSouth();

    let totalCount = 0;
    let visibleCount = 0;

    Object.values(tiles).forEach((tile) => {
      Object.values(tile.blocks).forEach((block) => {
        totalCount++;
        const x0 = tile.x + block.x / TILE_WIDTH;
        const y0 = tile.y + block.y / TILE_WIDTH;
        const x1 = tile.x + (block.x + 1) / TILE_WIDTH;
        const y1 = tile.y + (block.y + 1) / TILE_WIDTH;

        const nw = fogMap.Tile.XYToLngLat(x0, y0);
        const ne = fogMap.Tile.XYToLngLat(x1, y0);
        const se = fogMap.Tile.XYToLngLat(x1, y1);
        const sw = fogMap.Tile.XYToLngLat(x0, y1);

        const blockMinLng = Math.min(nw[0], ne[0], se[0], sw[0]);
        const blockMaxLng = Math.max(nw[0], ne[0], se[0], sw[0]);
        const blockMinLat = Math.min(nw[1], ne[1], se[1], sw[1]);
        const blockMaxLat = Math.max(nw[1], ne[1], se[1], sw[1]);

        const overlaps = !(
          blockMinLng > mapEast ||
          blockMaxLng < mapWest ||
          blockMinLat > mapNorth ||
          blockMaxLat < mapSouth
        );

        if (overlaps) {
          visibleCount++;
          blockFeatures.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[nw, sw, se, ne, nw]],
            },
            properties: {},
          });
        }
      });
    });

    this.stats.blocks = { visible: visibleCount, total: totalCount };

    this.updateLayerData(
      map,
      this.BLOCKS_SOURCE_ID,
      this.BLOCKS_LAYER_ID,
      blockFeatures,
      this.BLOCK_COLOR
    );
  }

  private clearTileLayer(map: mapboxgl.Map): void {
    this.stats.tiles = { visible: 0, total: 0 };
    this.updateLayerData(
      map,
      this.TILES_SOURCE_ID,
      this.TILES_LAYER_ID,
      [],
      this.TILE_COLOR
    );
  }

  private clearBlockLayer(map: mapboxgl.Map): void {
    this.stats.blocks = { visible: 0, total: 0 };
    this.updateLayerData(
      map,
      this.BLOCKS_SOURCE_ID,
      this.BLOCKS_LAYER_ID,
      [],
      this.BLOCK_COLOR
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
