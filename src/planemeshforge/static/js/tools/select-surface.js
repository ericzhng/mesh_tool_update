// Picks boundary edges of 2D elements ("surfaces") - click to pick one, box
// or Alt+drag lasso to pick several at once. Selected faces can be saved as
// a named surface set from the Sets panel.
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { viewport } from "../render/viewport.js";
import { pointInPolygon } from "../core/geometry.js";
import { hitEdge, pickRadiusWorld } from "../core/hit-test.js";

export const selectSurfaceTool = {
    id: "select-surface",
    label: "Select Surface",
    cursor: "default",
    hint: "Click a boundary edge to select · box/Alt+drag to lasso · Shift adds · Ctrl toggles",

    _box: null, // { start, current, lasso: bool, points: [] }

    onPointerDown(e, world) {
        const edge = hitEdge(world);
        if (edge) {
            this._handleEdgeHit(e, edge);
            return;
        }
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selection.clear();
        this._box = { start: world, current: world, lasso: e.altKey, points: [world] };
    },

    _handleEdgeHit(e, edge) {
        if (e.ctrlKey || e.metaKey) selection.toggleFace(edge.key);
        else if (e.shiftKey) selection.setFaces([...selection.faceKeys, edge.key]);
        else selection.setFaces([edge.key]);
    },

    onPointerMove(e, world) {
        if (!this._box) return;
        this._box.current = world;
        if (this._box.lasso) this._box.points.push(world);
    },

    onPointerUp(e) {
        if (!this._box) return;
        this._finishBoxSelect(e);
        this._box = null;
    },

    _finishBoxSelect(e) {
        const box = this._box;
        const moved = Math.hypot(box.current.x - box.start.x, box.current.y - box.start.y) > pickRadiusWorld() * 0.5;
        if (!moved) return;

        const within = point => (box.lasso ? pointInPolygon(point, box.points) : inBox(point, box));
        const hits = store.boundaryEdges.filter(edge => {
            if (!store.isElementVisible(edge.elementId)) return false;
            const a = store.node(edge.a);
            const b = store.node(edge.b);
            return a && b && within(a) && within(b);
        });
        const keys = hits.map(edge => edge.key);

        if (e.ctrlKey || e.metaKey) {
            const toRemove = keys.filter(key => selection.faceKeys.has(key));
            const toAdd = keys.filter(key => !selection.faceKeys.has(key));
            selection.removeFaces(toRemove);
            selection.addFaces(toAdd);
        } else if (e.shiftKey) {
            selection.addFaces(keys);
        } else {
            selection.setFaces(keys);
        }
    },

    onKeyDown(e) {
        if (e.key === "Escape") {
            this._box = null;
            selection.clear();
        }
    },

    drawOverlay(ctx) {
        this._drawPickableEdges(ctx);
        if (!this._box) return;
        ctx.save();
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#1f6feb";
        ctx.fillStyle = ctx.strokeStyle;
        ctx.globalAlpha = 0.12;
        ctx.lineWidth = 1;

        if (this._box.lasso) {
            const pts = this._box.points.map(p => viewport.toScreen(p));
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.stroke();
        } else {
            const a = viewport.toScreen(this._box.start);
            const b = viewport.toScreen(this._box.current);
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1;
            ctx.strokeRect(x, y, w, h);
        }
        ctx.restore();
    },

    _drawPickableEdges(ctx) {
        ctx.save();
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary") || "#888";
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        for (const edge of store.boundaryEdges) {
            if (selection.faceKeys.has(edge.key) || !store.isElementVisible(edge.elementId)) continue;
            const a = store.node(edge.a);
            const b = store.node(edge.b);
            if (!a || !b) continue;
            const pa = viewport.toScreen(a);
            const pb = viewport.toScreen(b);
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
        }
        ctx.restore();
    },
};

function inBox(point, box) {
    const minX = Math.min(box.start.x, box.current.x);
    const maxX = Math.max(box.start.x, box.current.x);
    const minY = Math.min(box.start.y, box.current.y);
    const maxY = Math.max(box.start.y, box.current.y);
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}
