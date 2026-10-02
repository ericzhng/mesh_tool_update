// Owns canvas pointer/keyboard wiring and the active tool. Panning
// (middle-mouse or space+drag) and wheel-zoom work no matter which tool is
// active; everything else is delegated to the tool.
import { bus } from "../core/events.js";
import { viewport } from "../render/viewport.js";
import { scheduleDraw, setToolOverlay } from "../render/renderer.js";

class ToolManager {
    constructor() {
        this.tools = new Map();
        this.active = null;
        this._panning = false;
        this._spaceHeld = false;
        this._lastScreen = null;
    }

    register(tool) {
        this.tools.set(tool.id, tool);
    }

    activate(id) {
        if (this.active?.id === id) return;
        this.active?.onDeactivate?.();
        this.active = this.tools.get(id) || null;
        this.active?.onActivate?.();
        viewport.showAllNodes = !!this.active?.showsAllNodes;
        if (this.canvas) this.canvas.style.cursor = this.active?.cursor || "default";
        setToolOverlay(ctx => this.active?.drawOverlay?.(ctx));
        bus.emit("tool:changed", this.active);
        scheduleDraw();
    }

    attach(canvas) {
        this.canvas = canvas;

        canvas.addEventListener("pointerdown", e => this._onPointerDown(e));
        canvas.addEventListener("pointermove", e => this._onPointerMove(e));
        window.addEventListener("pointerup", e => this._onPointerUp(e));
        canvas.addEventListener("wheel", e => this._onWheel(e), { passive: false });
        canvas.addEventListener("contextmenu", e => e.preventDefault());

        window.addEventListener("keydown", e => {
            if (e.code === "Space") this._spaceHeld = true;
            this.active?.onKeyDown?.(e);
        });
        window.addEventListener("keyup", e => {
            if (e.code === "Space") this._spaceHeld = false;
        });
    }

    _screenPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onPointerDown(e) {
        const screen = this._screenPoint(e);
        this._lastScreen = screen;
        if (e.button === 1 || (e.button === 0 && this._spaceHeld)) {
            this._panning = true;
            return;
        }
        this.active?.onPointerDown?.(e, viewport.toWorld(screen), screen);
        scheduleDraw();
    }

    _onPointerMove(e) {
        const screen = this._screenPoint(e);
        if (this._panning && this._lastScreen) {
            viewport.pan(screen.x - this._lastScreen.x, screen.y - this._lastScreen.y);
            scheduleDraw();
        } else {
            this.active?.onPointerMove?.(e, viewport.toWorld(screen), screen);
            scheduleDraw();
        }
        this._lastScreen = screen;
    }

    _onPointerUp(e) {
        if (this._panning) {
            this._panning = false;
            return;
        }
        const screen = this._lastScreen || this._screenPoint(e);
        this.active?.onPointerUp?.(e, viewport.toWorld(screen), screen);
        scheduleDraw();
    }

    _onWheel(e) {
        e.preventDefault();
        const screen = this._screenPoint(e);
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        viewport.zoomAt(screen, factor);
        scheduleDraw();
    }
}

export const toolManager = new ToolManager();
