export class Bbox {
  west: number;
  south: number;
  east: number;
  north: number;

  constructor(west: number, south: number, east: number, north: number) {
    this.west = west;
    this.south = south;
    this.east = east;
    this.north = north;
  }

  /**
   * Create a Bbox from a single point (zero-area bbox)
   */
  static fromPoint(lngLat: { lng: number; lat: number }): Bbox {
    return new Bbox(lngLat.lng, lngLat.lat, lngLat.lng, lngLat.lat);
  }

  /** 
   *  static functions to create a new box
   */

  static fromTwoPoints(point1: { lng: number; lat: number }, point2: { lng: number; lat: number }): Bbox {
    return new Bbox(
      Math.min(point1.lng, point2.lng),
      Math.min(point1.lat, point2.lat),
      Math.max(point1.lng, point2.lng),
      Math.max(point1.lat, point2.lat)
    );
  }

  static fromBounds(bounds: { west: number; south: number; east: number; north: number }): Bbox {
    return new Bbox(bounds.west, bounds.south, bounds.east, bounds.north);
  }

  static merge(bbox1: Bbox, bbox2: Bbox): Bbox {
    return new Bbox(
      Math.min(bbox1.west, bbox2.west),
      Math.min(bbox1.south, bbox2.south),
      Math.max(bbox1.east, bbox2.east),
      Math.max(bbox1.north, bbox2.north)
    );
  }

  /** 
   * Extend this bbox to include the point
   * NOTE: This mutates the bbox in place
   */
  extend(point: { lng: number; lat: number }): void {
    this.west = Math.min(this.west, point.lng);
    this.south = Math.min(this.south, point.lat);
    this.east = Math.max(this.east, point.lng);
    this.north = Math.max(this.north, point.lat);
  }
}

// NOTE: this does not handle wraparound
function _isBboxOverlap(a: Bbox, b: Bbox) {
  return a.north >= b.south && b.north >= a.south && a.east >= b.west && b.east >= a.west;
}
