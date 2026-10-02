// World <-> screen coordinate transforms and camera state (pan/zoom/rotate).
// Owns the canvas's pixel size; nothing else resizes the canvas.
import { bus } from "../core/events.js";

class Viewport {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 40;
        this.rotation = 0;
        this.snapToGrid = false;
        this.gridSpacing = 1;
        this.snapToNode = false;
        this.showNodeLabels = false;
        this.showElementLabels = false;
        // Set by tool-manager when the active tool needs every node visible
        // for picking (e.g. element-creation tools), overriding the normal
        // Abaqus-style "nodes hidden until hovered" behavior.
        this.showAllNodes = false;
    }

    attach(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.resize();
        window.addEventListener("resize", () => this.resize());
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
        bus.emit("viewport:changed", this);
    }

    toScreen(world) {
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        const x = world.x * cos - world.y * sin;
        const y = world.x * sin + world.y * cos;
        return {
            x: x * this.scale + this.offsetX,
            y: -y * this.scale + this.offsetY,
        };
    }

    toWorld(screen) {
        const x = (screen.x - this.offsetX) / this.scale;
        const y = -(screen.y - this.offsetY) / this.scale;
        const cos = Math.cos(-this.rotation);
        const sin = Math.sin(-this.rotation);
        return {
            x: x * cos - y * sin,
            y: x * sin + y * cos,
        };
    }

    pan(dx, dy) {
        this.offsetX += dx;
        this.offsetY += dy;
        bus.emit("viewport:changed", this);
    }

    zoomAt(screenPoint, factor) {
        const before = this.toWorld(screenPoint);
        this.scale = Math.max(1, Math.min(4000, this.scale * factor));
        const after = this.toScreen(before);
        this.offsetX += screenPoint.x - after.x;
        this.offsetY += screenPoint.y - after.y;
        bus.emit("viewport:changed", this);
    }

    // Rotates about `screenPivot` (defaults to the center of the view) by
    // keeping whatever world point is currently under that pivot fixed on
    // screen - the same "anchor a point, transform around it" trick as
    // `zoomAt`. Rotating about the world origin instead would swing the
    // whole mesh off-screen unless the origin happened to be in view.
    rotateBy(deltaRad, screenPivot) {
        const pivot = screenPivot || { x: this.width / 2, y: this.height / 2 };
        const worldPivot = this.toWorld(pivot);
        this.rotation += deltaRad;
        const after = this.toScreen(worldPivot);
        this.offsetX += pivot.x - after.x;
        this.offsetY += pivot.y - after.y;
        bus.emit("viewport:changed", this);
    }

    // Fits the view to `points` without disturbing the current rotation -
    // the bounding box is computed in the already-rotated frame so "Fit to
    // View" after a rotation zooms/pans to fit, it doesn't snap back to
    // unrotated.
    fitToPoints(points, padding = 40) {
        if (!points.length) {
            this.offsetX = this.width / 2;
            this.offsetY = this.height / 2;
            this.scale = 40;
            bus.emit("viewport:changed", this);
            return;
        }
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        const rotated = points.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
        const xs = rotated.map(p => p.x);
        const ys = rotated.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const spanX = Math.max(maxX - minX, 1e-6);
        const spanY = Math.max(maxY - minY, 1e-6);
        const scaleX = (this.width - padding * 2) / spanX;
        const scaleY = (this.height - padding * 2) / spanY;
        this.scale = Math.max(1, Math.min(scaleX, scaleY));

        // Invert the rotation to recover the world point at the center of
        // the rotated bounding box, then reuse toScreen (offset temporarily
        // zeroed) so the offset math can't drift out of sync with it.
        const rx = (minX + maxX) / 2;
        const ry = (minY + maxY) / 2;
        const centerWorld = { x: rx * cos + ry * sin, y: -rx * sin + ry * cos };
        this.offsetX = 0;
        this.offsetY = 0;
        const centerScreen = this.toScreen(centerWorld);
        this.offsetX = this.width / 2 - centerScreen.x;
        this.offsetY = this.height / 2 - centerScreen.y;
        bus.emit("viewport:changed", this);
    }

    snap(value) {
        if (!this.snapToGrid) return value;
        return Math.round(value / this.gridSpacing) * this.gridSpacing;
    }

    snapPoint(world) {
        return { x: this.snap(world.x), y: this.snap(world.y) };
    }
}

export const viewport = new Viewport();
