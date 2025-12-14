import * as fogMap from "../utils/FogMap";

interface Line {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PerfMetrics {
  tileCnt: number;
  blockCnt: number;
  duration: number;
}

// Get tile count from FogMap
function getTileCnt(map: fogMap.FogMap): number {
  return Object.keys(map.tiles).length;
}

// Get total block count from FogMap
function getBlockCnt(map: fogMap.FogMap): number {
  return Object.values(map.tiles).reduce((sum, tile) => sum + Object.keys(tile.blocks).length, 0);
}

// Get metrics from FogMap
function getMetrics(map: fogMap.FogMap, duration: number): PerfMetrics {
  return {
    tileCnt: getTileCnt(map),
    blockCnt: getBlockCnt(map),
    duration,
  };
}

// Measure execution time
function timeit(text: string, func: () => void): number {
  const start = performance.now();
  func();
  const end = performance.now();
  const duration = end - start;
  process.stdout.write(`${text} took ${duration.toFixed(2)} ms\n`);
  return duration;
}

// Log cumulative metrics
function logCumulative(metrics: PerfMetrics): void {
  process.stdout.write(`  → Cumulative Tiles: ${metrics.tileCnt}, Blocks: ${metrics.blockCnt}\n\n`);
}

// Log summary statistics
function logSummary(metrics: PerfMetrics, lineCnt: number): void {
  const avg = metrics.duration / lineCnt;
  const blocksPerTile = metrics.blockCnt / metrics.tileCnt;

  process.stdout.write("=== Summary ===\n");
  process.stdout.write(`Total Time: ${metrics.duration.toFixed(2)} ms\n`);
  process.stdout.write(`Average Time per Line: ${avg.toFixed(2)} ms\n`);
  process.stdout.write(`Final Tiles: ${metrics.tileCnt}\n`);
  process.stdout.write(`Final Blocks: ${metrics.blockCnt}\n`);
  process.stdout.write(`Blocks per Tile: ${blocksPerTile.toFixed(2)}\n\n`);
}

// Test data: 10 diverse lines with different characteristics
const DIVERSE_LINES: Line[] = [
  // Short diagonal line
  { name: "Line 1 (Short)", x1: 120.0, y1: 24.0, x2: 121.0, y2: 25.0 },
  // Medium horizontal line
  { name: "Line 2 (Horizontal)", x1: 100.0, y1: 30.0, x2: 105.0, y2: 30.5 },
  // Long diagonal line
  { name: "Line 3 (Long)", x1: 115.0, y1: 20.0, x2: 125.0, y2: 30.0 },
  // Vertical line
  { name: "Line 4 (Vertical)", x1: 121.5, y1: 10.0, x2: 121.8, y2: 20.0 },
  // Cross prime meridian (0° longitude)
  { name: "Line 5 (Cross 0° Lng)", x1: -5.0, y1: 50.0, x2: 5.0, y2: 55.0 },
  // Cross equator (0° latitude)
  { name: "Line 6 (Cross Equator)", x1: 100.0, y1: -10.0, x2: 110.0, y2: 10.0 },
  // Southern hemisphere diagonal
  { name: "Line 7 (South)", x1: 140.0, y1: -30.0, x2: 150.0, y2: -20.0 },
  // Cross both 0° lng and lat
  { name: "Line 8 (Cross 0,0)", x1: -10.0, y1: -10.0, x2: 10.0, y2: 10.0 },
  // Steep angle line
  { name: "Line 9 (Steep)", x1: 80.0, y1: 5.0, x2: 82.0, y2: 15.0 },
  // Wide angle line
  { name: "Line 10 (Wide)", x1: 50.0, y1: 40.0, x2: 70.0, y2: 42.0 },
];

const SINGLE_LONG_LINE: Line[] = [
  { name: "Very Long Line (10 degree span)", x1: 115.0, y1: 20.0, x2: 125.0, y2: 30.0 },
];

// Run line drawing test and return metrics
function runLineTest(lines: Line[], showCumulative = true): PerfMetrics {
  let map = fogMap.FogMap.empty;
  let totalDuration = 0;

  lines.forEach((line) => {
    const duration = timeit(`${line.name}`, () => {
      map = map.addLine(line.x1, line.y1, line.x2, line.y2);
    });

    totalDuration += duration;

    if (showCumulative) {
      const metrics = getMetrics(map, duration);
      logCumulative(metrics);
    }
  });

  return getMetrics(map, totalDuration);
}

describe("Performance Test - DrawLine", () => {
  test("should measure performance of drawing 10 diverse lines", () => {
    process.stdout.write("\n=== Performance Test: Drawing 10 Diverse Lines ===\n\n");

    const metrics = runLineTest(DIVERSE_LINES);
    logSummary(metrics, DIVERSE_LINES.length);

    // Verify expected results
    expect(metrics.tileCnt).toBe(270);
    expect(metrics.blockCnt).toBe(33265);
  });

  test("should measure performance of single very long line", () => {
    process.stdout.write("\n=== Performance Test: Single Very Long Line ===\n\n");

    const metrics = runLineTest(SINGLE_LONG_LINE, false);
    const blocksPerTile = metrics.blockCnt / metrics.tileCnt;

    process.stdout.write(`  → Tiles: ${metrics.tileCnt}, Blocks: ${metrics.blockCnt}\n`);
    process.stdout.write(`  → Blocks per Tile: ${blocksPerTile.toFixed(2)}\n\n`);

    // Verify expected results
    expect(metrics.tileCnt).toBe(30);
    expect(metrics.blockCnt).toBe(3803);
  });
});

export {};
