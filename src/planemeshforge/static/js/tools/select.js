// The default tool: click to pick a node, element, or edge ("surface");
// box/lasso to multi-select; drag to move the current node selection.
// One smart selection, no mode/filter to switch: a single click resolves
// by priority (node > edge > element - a boundary-line click reads as "the
// edge", an interior click as "the element"), and a box/lasso drag gathers
// all three kinds from the same region in one pass. selection.js keeps the
// three kinds as independent sets, so a combined box-select can carry
// nodes, elements, and edges at once - e.g. to split into separate node/
// element/surface sets afterward (see the Sets panel).
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { hover } from "../core/hover.js";
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { pointInPolygon } from "../core/geometry.js";
import { hitNode, hitElement, hitEdge, pickRadiusWorld } from "../core/hit-test.js";

export const selectTool = {
    id: "select",
    label: "Select",
    cursor: "default",
    hint: "Click to select a node/edge/element · drag to move · box/Alt+drag to lasso · Shift adds · Ctrl toggles",

    _drag: null, // { nodeIds, starts: Map(id -> {x,y}), pointerStart }
    _box: null, // { start, current, lasso: bool, points: [] }

    onDeactivate() {
        hover.clear();
        this._drag = null;
        this._box = null;
    },

    onPointerDown(e, world) {
        const node = hitNode(world);
        if (node) {
            this._handleNodeHit(e, node, world);
            return;
        }
        const edge = hitEdge(world);
        if (edge) {
            this._handleEdgeHit(e, edge);
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
        else if (e.shiftKey) selection.addElements([element.id]);
        else selection.setElements([element.id]);
    },

    _handleEdgeHit(e, edge) {
        if (e.ctrlKey || e.metaKey) selection.toggleFace(edge.key);
        else if (e.shiftKey) selection.addFaces([edge.key]);
        else selection.setFaces([edge.key]);
    },

    onPointerMove(e, world) {
        if (!this._drag && !this._box) {
            const node = hitNode(world);
            if (node) {
                hover.setNode(node.id);
            } else {
                const edge = hitEdge(world);
                if (edge) {
                    hover.setFace(edge.key);
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
            this._finishBoxSelect(e);
            this._box = null;
        }
    },

    _finishBoxSelect(e) {
        const box = this._box;
        const moved = Math.hypot(box.current.x - box.start.x, box.current.y - box.start.y) > pickRadiusWorld() * 0.5;
        if (!moved) return;

        const within = point => (box.lasso ? pointInPolygon(point, box.points) : inBox(point, box));

        const nodeHits = store.mesh.nodes.filter(n => store.isNodeVisible(n.id) && within(n));
        const nodeIds = nodeHits.map(n => n.id);

        const elementHits = store.mesh.elements.filter(el => {
            if (!store.isElementVisible(el.id)) return false;
            return el.node_ids.every(id => {
                const n = store.node(id);
                return n && within(n);
            });
        });
        const elementIds = elementHits.map(el => el.id);

        const edgeHits = store.edgeFaces.filter(edge => {
            if (!store.isEdgeVisible(edge)) return false;
            const a = store.node(edge.a);
            const b = store.node(edge.b);
            return a && b && within(a) && within(b);
        });
        const faceKeys = edgeHits.map(edge => edge.key);

        if (e.ctrlKey || e.metaKey) {
            toggleHits(selection.nodeIds, nodeIds, selection.addNodes.bind(selection), selection.removeNodes.bind(selection));
            toggleHits(
                selection.elementIds,
                elementIds,
                selection.addElements.bind(selection),
                selection.removeElements.bind(selection)
            );
            toggleHits(selection.faceKeys, faceKeys, selection.addFaces.bind(selection), selection.removeFaces.bind(selection));
        } else if (e.shiftKey) {
            selection.addNodes(nodeIds);
            selection.addElements(elementIds);
            selection.addFaces(faceKeys);
        } else {
            selection.replaceAll({ nodes: nodeIds, elements: elementIds, faces: faceKeys });
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

// Ctrl/box-select toggles each hit within its own kind: already-selected
// hits drop out, new ones get added - same "toggle" semantics as a single
// ctrl-click, just applied to a whole box's worth of hits at once.
function toggleHits(currentSet, hitIds, add, remove) {
    const toRemove = hitIds.filter(id => currentSet.has(id));
    const toAdd = hitIds.filter(id => !currentSet.has(id));
    remove(toRemove);
    add(toAdd);
}
