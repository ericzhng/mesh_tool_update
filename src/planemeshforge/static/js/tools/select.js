// The default tool: click to pick a node or element, box/lasso to
// multi-select, drag to move the current node selection. Dragging updates
// node positions locally for instant feedback and only tells the server
// once, on release.
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { hover } from "../core/hover.js";
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { pointInPolygon } from "../core/geometry.js";
import { hitNode, hitElement, pickRadiusWorld } from "../core/hit-test.js";

export const selectTool = {
    id: "select",
    label: "Select",
    cursor: "default",
    hint: "Click to select · drag to move · box/Alt+drag to lasso · Shift adds · Ctrl toggles",

    _drag: null, // { nodeIds, starts: Map(id -> {x,y}), pointerStart }
    _box: null, // { start, current, lasso: bool, points: [] }

    onDeactivate() {
        hover.clear();
    },

    onPointerDown(e, world) {
        const node = hitNode(world);
        if (node) {
            this._handleNodeHit(e, node, world);
            return;
        }
        const element = hitElement(world);
        if (element) {
            this._handleElementHit(e, element);
            return;
        }
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selection.clear();
        this._box = { start: world, current: world, lasso: e.altKey, points: [world] };
    },

    _handleNodeHit(e, node, world) {
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        if (e.ctrlKey || e.metaKey) {
            selection.toggleNode(node.id);
        } else if (e.shiftKey) {
            selection.addNodes([node.id]);
        } else if (!selection.nodeIds.has(node.id)) {
            selection.setNodes([node.id]);
        }
        if (additive && !selection.nodeIds.has(node.id)) return; // just removed by toggle

        const starts = new Map();
        for (const id of selection.nodeIds) {
            const n = store.node(id);
            if (n) starts.set(id, { x: n.x, y: n.y });
        }
        this._drag = { starts, pointerStart: world };
    },

    _handleElementHit(e, element) {
        if (e.ctrlKey || e.metaKey) selection.toggleElement(element.id);
        else if (e.shiftKey) selection.setElements([...selection.elementIds, element.id]);
        else selection.setElements([element.id]);
    },

    onPointerMove(e, world) {
        if (!this._drag && !this._box) {
            const node = hitNode(world);
            if (node) {
                hover.setNode(node.id);
            } else {
                const element = hitElement(world);
                if (element) hover.setElement(element.id);
                else hover.clear();
            }
        }
        if (this._drag) {
            const dx = world.x - this._drag.pointerStart.x;
            const dy = world.y - this._drag.pointerStart.y;
            const single = this._drag.starts.size === 1;
            for (const [id, start] of this._drag.starts) {
                const node = store.node(id);
                if (!node) continue;
                let target = { x: start.x + dx, y: start.y + dy };
                if (single && viewport.snapToNode) {
                    const nearest = hitNode(target);
                    if (nearest && nearest.id !== id) target = { x: nearest.x, y: nearest.y };
                    else target = viewport.snapPoint(target);
                } else {
                    target = viewport.snapPoint(target);
                }
                node.x = target.x;
                node.y = target.y;
            }
            return;
        }
        if (this._box) {
            this._box.current = world;
            if (this._box.lasso) this._box.points.push(world);
        }
    },

    onPointerUp(e, world) {
        if (this._drag) {
            const nodes = [...this._drag.starts.keys()].map(id => {
                const n = store.node(id);
                return { id, x: n.x, y: n.y };
            });
            this._drag = null;
            if (nodes.length) client.op("move_nodes", { nodes });
            return;
        }
        if (this._box) {
            this._finishBoxSelect(e);
            this._box = null;
        }
    },

    _finishBoxSelect(e) {
        const box = this._box;
        const moved = Math.hypot(box.current.x - box.start.x, box.current.y - box.start.y) > pickRadiusWorld() * 0.5;
        if (!moved) return;

        let hits;
        if (box.lasso) {
            hits = store.mesh.nodes.filter(n => store.isNodeVisible(n.id) && pointInPolygon(n, box.points));
        } else {
            const minX = Math.min(box.start.x, box.current.x);
            const maxX = Math.max(box.start.x, box.current.x);
            const minY = Math.min(box.start.y, box.current.y);
            const maxY = Math.max(box.start.y, box.current.y);
            hits = store.mesh.nodes.filter(
                n => store.isNodeVisible(n.id) && n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY
            );
        }
        const ids = hits.map(n => n.id);

        if (e.ctrlKey || e.metaKey) {
            const toRemove = ids.filter(id => selection.nodeIds.has(id));
            const toAdd = ids.filter(id => !selection.nodeIds.has(id));
            selection.removeNodes(toRemove);
            selection.addNodes(toAdd);
        } else if (e.shiftKey) {
            selection.addNodes(ids);
        } else {
            selection.setNodes(ids);
        }
    },

    onKeyDown(e) {
        if (e.key === "Escape") {
            this._drag = null;
            this._box = null;
            selection.clear();
        }
    },

    drawOverlay(ctx) {
        if (!this._box) return;
        ctx.save();
        ctx.strokeStyle = "var(--accent)".includes("var") ? getComputedStyle(document.documentElement).getPropertyValue("--accent") : "#1f6feb";
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
};
