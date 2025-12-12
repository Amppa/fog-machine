import mapboxgl from "mapbox-gl";
import { ModeStrategy, ModeContext } from "./ModeStrategy";

/**
 * View Mode (Default mode)
 * Allows user to pan and zoom the map
 */
export class ViewMode implements ModeStrategy {
    activate(_context: ModeContext): void {
        // No special activation needed
    }

    deactivate(_context: ModeContext): void {
        // No special deactivation needed
    }

    handleMousePress(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        // No action on mouse press
    }

    handleMouseMove(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        // No action on mouse move
    }

    handleMouseRelease(_e: mapboxgl.MapMouseEvent, _context: ModeContext): void {
        // No action on mouse release
    }

    getCursorStyle(): string {
        return 'grab';
    }

    shouldDisableDragPan(): boolean {
        return false;
    }
}
