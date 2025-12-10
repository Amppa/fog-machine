// ============================================================================
// Types
// ============================================================================
type MapCoordinate = { lat: number; lng: number; zoom?: number };

// ============================================================================
// Helper Functions
// ============================================================================
function parseCoordinates(
  parts: string[],
  latIndex = 0,
  lngIndex = 1
): { lat: number; lng: number } | null {
  if (parts.length < Math.max(latIndex, lngIndex) + 1) {
    return null;
  }
  const lat = parseFloat(parts[latIndex]);
  const lng = parseFloat(parts[lngIndex]);
  return isValidCoordinate(lat, lng) ? { lat, lng } : null;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ============================================================================
// Parser Functions (Alphabetical Order)
// ============================================================================
function parseAppleMapsUrl(urlObj: URL): MapCoordinate | null {
  // Note: Apple Maps URLs often don't have zoom level

  // Try 'center' parameter
  const center = urlObj.searchParams.get("center");
  if (center) {
    const parts = center.split(",");
    const coords = parseCoordinates(parts);
    if (coords) return coords;
  }

  // Try 'coordinate' parameter
  const coordinate = urlObj.searchParams.get("coordinate");
  if (coordinate) {
    const parts = coordinate.split(",");
    const coords = parseCoordinates(parts);
    if (coords) return coords;
  }

  return null;
}

// e.g. https://www.bing.com/maps?cp=37.457689%7E126.506001&lvl=13.6&style=r
function parseBingMapsUrl(urlObj: URL): MapCoordinate | null {
  const cp = urlObj.searchParams.get("cp");
  if (!cp) return null;

  const parts = cp.split("~");
  const coords = parseCoordinates(parts);
  if (!coords) return null;

  // Try to get zoom level
  const lvl = urlObj.searchParams.get("lvl");
  const zoom = lvl ? parseFloat(lvl) : undefined;

  return { ...coords, zoom };
}


// e.g. https://www.google.com/maps/@35.6330087,139.8825402,15.89z/data=!5m1!1e2?authuser=0&entry=ttu&g_ep=EgoyMDI1MTIwNy4wIKXMDSoASAFQAw%3D%3D
function parseGoogleMapsUrl(urlObj: URL): MapCoordinate | null {
  const atPart = urlObj.pathname.split("/@")[1];
  if (!atPart) return null;

  const parts = atPart.split(",");
  const coords = parseCoordinates(parts);
  if (!coords) return null;

  // Try to get zoom level (format: "14z")
  let zoom: number | undefined;
  if (parts.length >= 3 && parts[2].endsWith("z")) {
    const zoomValue = parseFloat(parts[2].slice(0, -1));
    if (!isNaN(zoomValue)) {
      zoom = zoomValue;
    }
  }

  return { ...coords, zoom };
}

// e.g. https://www.openstreetmap.org/#map=12/1.3680/103.9818
function parseOpenStreetMapUrl(urlObj: URL): MapCoordinate | null {
  const hash = urlObj.hash;
  if (!hash.startsWith("#map=")) return null;

  const parts = hash.split("/");
  if (parts.length < 3) return null;

  // parts[0] is "#map=14", parts[1] is lat, parts[2] is lng
  const zoomPart = parts[0].split("=")[1];
  const zoom = parseFloat(zoomPart);
  const lat = parseFloat(parts[1]);
  const lng = parseFloat(parts[2]);

  return isValidCoordinate(lat, lng) ? { lat, lng, zoom } : null;
}

// ============================================================================
// Main Function
// ============================================================================
export function parseMapUrl(url: string): MapCoordinate | null {
  try {
    const urlObj = new URL(url);

    // Google Maps
    if (
      urlObj.hostname.includes("google.com") &&
      urlObj.pathname.startsWith("/maps")
    ) {
      return parseGoogleMapsUrl(urlObj);
    }

    // Apple Maps
    if (urlObj.hostname.includes("apple.com")) {
      return parseAppleMapsUrl(urlObj);
    }

    // OpenStreetMap
    if (urlObj.hostname.includes("openstreetmap.org")) {
      return parseOpenStreetMapUrl(urlObj);
    }

    // Bing Maps
    if (urlObj.hostname.includes("bing.com")) {
      return parseBingMapsUrl(urlObj);
    }

    return null;
  } catch (e) {
    // Invalid URL or parsing error
    return null;
  }
}
