// This file is basically a wrapper around `@mapbox/mapbox-gl-draw`
// because we don't have type definitions for it.

/* eslint-disable */
// @ts-nocheck

import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { Bbox } from "./CommonTypes";
import * as fogMap from "./FogMap";
import { ModeContext } from "./modes/ModeStrategy";

const DEBUG = false;

export class MapDraw {
  private context: ModeContext;
  private mapboxDraw: MapboxDraw;

  constructor(context: ModeContext) {
    this.context = context;
    this.mapboxDraw = new MapboxDraw({
      displayControlsDefault: false,
      defaultMode: "draw_line_string",
      styles: [
        // ACTIVE (being drawn)
        // line stroke
        {
          id: "gl-draw-line",
          type: "line",
          filter: ["all", ["==", "$type", "LineString"], ["!=", "mode", "static"]],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#969696",
            "line-dasharray": [0.2, 2],
            "line-width": 2,
          },
        },
      ],
    });

    this.context.map.on("draw.create", (e: GeoJSON) => {
      // parse each line segments, apply to fogmap
      if (DEBUG) console.log(e.features);
      for (const geo of e.features) {
        if (geo.geometry.type == "LineString") {
          const coordinates = geo.geometry.coordinates;

          let [startLng, startLat] = coordinates[0];
          let newMap = this.context.fogMap;
          const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
          for (let j = 1; j < coordinates.length; ++j) {
            const [endLng, endLat] = coordinates[j];
            newMap = newMap.addLine(startLng, startLat, endLng, endLat);
            bounds.extend(coordinates[j]);
            [startLng, startLat] = [endLng, endLat];
          }
          const bbox = new Bbox(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth());
          this.context.updateFogMap(newMap, bbox);
          this.context.saveToHistory(newMap, bbox);
        }
      }
      this.mapboxDraw.trash(); // clean up the user drawing
    });
    this.context.map.on("draw.modechange", (_ev) => {
      this.mapboxDraw.changeMode("draw_line_string", {});
    });
  }

  activate() {
    this.context.map?.addControl(this.mapboxDraw, "bottom-left");
  }

  deactivate() {
    if (this.context.map.hasControl(this.mapboxDraw)) {
      this.context.map.removeControl(this.mapboxDraw);
    }
  }
}
