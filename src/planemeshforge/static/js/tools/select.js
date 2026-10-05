// The default tool: click to pick a node, element, or edge ("surface");
// box/lasso to multi-select; drag to move the current node selection.
// A persistent filter - `V` for nodes/elements, `S` for edges - decides
// which kind a click or box resolves to, Abaqus/HyperMesh-style: one tool,
// one set of box/lasso/drag/shift/ctrl mechanics, with the filter just
// narrowing what counts as a hit. Switching filters doesn't touch the
// current selection, so you can grab some nodes, flip to the edge filter,
// and add edges without losing them - selection.js itself still only holds
// one kind at a time, so adding an edge after nodes replaces them, same as
// clicking a node after edges would.
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { hover } from "../core/hover.js";
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { pointInPolygon } from "../core/geometry.js";
import { hitNode, hitElement, hitEdge, pickRadiusWorld } from "../core/hit-test.js";

export const selectTool = {
    id: "select",
    cursor: "default",
    // "point" = nodes/elements (the historical default-tool behavior),
    // "edge" = surfaces (the historical select-surface-tool behavior).
    filter: "point",

    _drag: null, // { nodeIds, starts: Map(id -> {x,y}), pointerStart }
    _box: null, // { start, current, lasso: bool, points: [] }

    get label() {
        return this.filter === "edge" ? "Select Surface" : "Select";
    },

    get hint() {
        return this.filter === "edge"
            ? "Click an edge to select · box/Alt+drag to lasso · Shift adds · Ctrl toggles"
            : "Click to select · drag to move · box/Alt+drag to lasso · Shift adds · Ctrl toggles";
    },

    setFilter(filter) {
        if (this.filter === filter) return;
        this.filter = filter;
        this._drag = null;
        this._box = null;
        hover.clear();
    },

    onDeactivate() {
        hover.clear();
        this._drag = null;
        this._box = null;
    },

    onPointerDown(e, world) {
        if (this.filter === "edge") {
            const edge = hitEdge(world);
            if (edge) {
                this._handleEdgeHit(e, edge);
                return;
            }
        } else {
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

    _handleEdgeHit(e, edge) {
        if (e.ctrlKey || e.metaKey) selection.toggleFace(edge.key);
        else if (e.shiftKey) selection.setFaces([...selection.faceKeys, edge.key]);
        else selection.setFaces([edge.key]);
    },

    onPointerMove(e, world) {
        if (!this._drag && !this._box) {
            if (this.filter === "edge") {
                const edge = hitEdge(world);
                if (edge) hover.setFace(edge.key);
                else hover.clear();
            } else {
                const node = hitNode(world);
                if (node) {
                    hover.setNode(node.id);
                } else {
                    const element = hitElement(world);
                    if (element) hover.setElement(element.id);
                    else hover.clear();
                }
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
            if (this.filter === "edge") this._finishBoxSelectEdges(e);
            else this._finishBoxSelectNodes(e);
            this._box = null;
        }
    },

    _finishBoxSelectNodes(e) {
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

    _finishBoxSelectEdges(e) {
        const box = this._box;
        const moved = Math.hypot(box.current.x - box.start.x, box.current.y - box.start.y) > pickRadiusWorld() * 0.5;
        if (!moved) return;

        const within = point => (box.lasso ? pointInPolygon(point, box.points) : inBox(point, box));
        const hits = store.edgeFaces.filter(edge => {
            if (!store.isEdgeVisible(edge)) return false;
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
            this._drag = null;
            this._box = null;
            selection.clear();
        }
    },

    drawOverlay(ctx) {
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
};

function inBox(point, box) {
    const minX = Math.min(box.start.x, box.current.x);
    const maxX = Math.max(box.start.x, box.current.x);
    const minY = Math.min(box.start.y, box.current.y);
    const maxY = Math.max(box.start.y, box.current.y);
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}
