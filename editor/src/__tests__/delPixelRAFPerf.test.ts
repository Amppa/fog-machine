import { DelPixelMode } from "../utils/modes/DelPixelMode";
import * as fogMap from "../utils/FogMap";
import { Bbox } from "../utils/CommonTypes";
import mapboxgl from "mapbox-gl";

// Mock ModeContext
interface MockContext {
    fogMap: fogMap.FogMap;
    updateFogMap: (newMap: fogMap.FogMap, bbox: Bbox | "all", skipHistory: boolean, skipRender?: boolean) => void;
    onChange: () => void;
    map: any;
    gridRenderer: any;
}

describe("RAF Batch Processing Performance Test", () => {
    let mode: DelPixelMode;
    let updateCount: number;
    let mockContext: MockContext;

    beforeEach(() => {
        // Mock DOM for cursor indicator
        (global as any).document = {
            createElement: jest.fn(() => ({
                style: {},
                className: '',
            })),
        };

        // Mock mapboxgl.Marker
        (mapboxgl as any).Marker = jest.fn().mockImplementation(() => ({
            setLngLat: jest.fn().mockReturnThis(),
            addTo: jest.fn().mockReturnThis(),
            remove: jest.fn(),
            getElement: jest.fn(() => ({ style: {} })),
        }));

        mode = new DelPixelMode();
        updateCount = 0;

        // Create a simple map with some fog
        let map = fogMap.FogMap.empty;
        // Draw a dense area
        for (let lat = 23.95; lat <= 24.05; lat += 0.001) {
            map = map.addLine(119.95, lat, 120.05, lat);
        }

        // Mock context
        mockContext = {
            fogMap: map,
            updateFogMap: (newMap: fogMap.FogMap) => {
                updateCount++;
                mockContext.fogMap = newMap;
            },
            onChange: jest.fn(),
            map: {
                dragPan: {
                    disable: jest.fn(),
                    enable: jest.fn(),
                },
                getZoom: () => 12,
                getCenter: () => ({ lng: 120, lat: 24 }),
                project: (lngLat: any) => ({ x: 100, y: 100 }),
                unproject: (point: any) => ({ lng: 120, lat: 24 }),
                flyTo: jest.fn(),
                addControl: jest.fn(),
                removeControl: jest.fn(),
                hasControl: () => false,
            },
            gridRenderer: {
                update: jest.fn(),
            },
        };

        mode.activate(mockContext as any);
    });

    test("should reduce UI update frequency with RAF batching", async () => {
        process.stdout.write("\n=== RAF Batch Processing Test ===\n\n");

        const mouseMoveCount = 100;
        const startLng = 119.98;
        const startLat = 24.0;
        const endLng = 120.02;
        const endLat = 24.0;

        // Simulate mouse press
        const pressEvent = {
            lngLat: new mapboxgl.LngLat(startLng, startLat),
            originalEvent: { buttons: 1 },
        } as any;

        mode.handleMousePress(pressEvent, mockContext as any);
        const pressUpdateCount = updateCount;

        process.stdout.write(`Mouse Press: ${pressUpdateCount} update(s)\n`);

        // Simulate many mouse move events (like real usage)
        const moveStartTime = performance.now();

        for (let i = 0; i < mouseMoveCount; i++) {
            const progress = i / mouseMoveCount;
            const lng = startLng + (endLng - startLng) * progress;
            const lat = startLat + (endLat - startLat) * progress;

            const moveEvent = {
                lngLat: new mapboxgl.LngLat(lng, lat),
                originalEvent: { buttons: 1 },
            } as any;

            mode.handleMouseMove(moveEvent, mockContext as any);
        }

        // Wait for RAF to complete (multiple frames)
        await new Promise(resolve => setTimeout(resolve, 100));

        const moveEndTime = performance.now();
        const moveDuration = moveEndTime - moveStartTime;
        const moveUpdateCount = updateCount - pressUpdateCount;

        process.stdout.write(`Mouse Move (${mouseMoveCount} events): ${moveUpdateCount} update(s) in ${moveDuration.toFixed(2)} ms\n`);

        // Simulate mouse release
        const releaseEvent = {
            lngLat: new mapboxgl.LngLat(endLng, endLat),
            originalEvent: { buttons: 0 },
        } as any;

        mode.handleMouseRelease(releaseEvent, mockContext as any);

        // Wait for final RAF
        await new Promise(resolve => setTimeout(resolve, 50));

        const releaseUpdateCount = updateCount - pressUpdateCount - moveUpdateCount;

        process.stdout.write(`Mouse Release: ${releaseUpdateCount} update(s)\n\n`);

        // Summary
        const totalUpdates = updateCount;
        const updateReduction = ((mouseMoveCount - moveUpdateCount) / mouseMoveCount * 100).toFixed(1);

        process.stdout.write("=== Summary ===\n");
        process.stdout.write(`Total mouse events: ${mouseMoveCount + 2} (1 press + ${mouseMoveCount} moves + 1 release)\n`);
        process.stdout.write(`Total UI updates: ${totalUpdates}\n`);
        process.stdout.write(`Update reduction: ${updateReduction}% (${mouseMoveCount} → ${moveUpdateCount})\n`);
        process.stdout.write(`Average updates per frame: ${(moveUpdateCount / (moveDuration / 16)).toFixed(2)}\n\n`);

        // Assertions
        expect(totalUpdates).toBeGreaterThan(0);

        // RAF should significantly reduce update count
        // Without RAF: ~100 updates (one per mousemove)
        // With RAF: ~6-10 updates (one per animation frame at 60fps over 100ms)
        expect(moveUpdateCount).toBeLessThan(mouseMoveCount);
        expect(moveUpdateCount).toBeLessThan(20); // Should be much less than 100

        process.stdout.write(`✅ RAF batching is working! Reduced from ${mouseMoveCount} to ${moveUpdateCount} updates\n\n`);
    });

    test("should compare performance: with RAF vs without RAF simulation", async () => {
        process.stdout.write("\n=== Performance Comparison ===\n\n");

        const mouseMoveCount = 50;

        // Test WITH RAF (current implementation)
        updateCount = 0;
        const withRAFStart = performance.now();

        const pressEvent = {
            lngLat: new mapboxgl.LngLat(120, 24),
            originalEvent: { buttons: 1 },
        } as any;

        mode.handleMousePress(pressEvent, mockContext as any);

        for (let i = 0; i < mouseMoveCount; i++) {
            const moveEvent = {
                lngLat: new mapboxgl.LngLat(120 + i * 0.0001, 24),
                originalEvent: { buttons: 1 },
            } as any;
            mode.handleMouseMove(moveEvent, mockContext as any);
        }

        await new Promise(resolve => setTimeout(resolve, 100));

        const releaseEvent = {
            lngLat: new mapboxgl.LngLat(120.005, 24),
            originalEvent: { buttons: 0 },
        } as any;
        mode.handleMouseRelease(releaseEvent, mockContext as any);

        await new Promise(resolve => setTimeout(resolve, 50));

        const withRAFEnd = performance.now();
        const withRAFUpdates = updateCount;
        const withRAFDuration = withRAFEnd - withRAFStart;

        process.stdout.write(`WITH RAF:\n`);
        process.stdout.write(`  Updates: ${withRAFUpdates}\n`);
        process.stdout.write(`  Duration: ${withRAFDuration.toFixed(2)} ms\n`);
        process.stdout.write(`  Updates/Event: ${(withRAFUpdates / mouseMoveCount).toFixed(2)}\n\n`);

        // Expected results
        expect(withRAFUpdates).toBeLessThan(mouseMoveCount / 2);

        process.stdout.write(`✅ RAF reduces UI updates by ~${((1 - withRAFUpdates / mouseMoveCount) * 100).toFixed(0)}%\n\n`);
    });
});

export { };
