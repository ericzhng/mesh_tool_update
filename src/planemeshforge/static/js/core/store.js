// The single source of truth for mesh data on the client. Everything here is
// rebuilt wholesale from the `mesh_state` payload the server broadcasts
// after every change - the client never mutates mesh data itself, it only
// asks the server to (see net/client.js) and reacts to the result.
import { bus } from "./events.js";
import { SpatialHashGrid } from "./spatial-hash-grid.js";
import { resolveSurfaceFaces } from "./surfaces.js";

const EMPTY_MESH = { nodes: [], elements: [], node_sets: {}, element_sets: {}, surface_sets: {} };

class Store {
    constructor() {
        this.mesh = EMPTY_MESH;
        this.summary = { num_nodes: 0, num_elements: 0, num_node_sets: 0, num_element_sets: 0, num_surface_sets: 0 };
        this.canUndo = false;
        this.canRedo = false;

        this.nodesMap = new Map();
        this.elementsMap = new Map();
        this.elementsByNode = new Map();
        this.spatialGrid = new SpatialHashGrid({ min: [-1000, -1000] }, [50, 50]);

        // Every edge of every 2D element (triangle/quad), one entry per
        // owning element - a boundary edge (used by exactly one element)
        // yields one entry, an internal edge shared by two elements yields
        // two (one per side, since Abaqus surfaces reference a specific
        // element face). These are the pickable "surfaces". Rebuilt on
        // every mesh:changed. Keyed by `${elementId}:${faceIndex}`.
        this.edgeFaces = [];
        this.edgeFaceMap = new Map();

        this.elementTypes = {};

        // Per-set visibility, keyed by `${kind}:${name}` (kind = "node" | "element").
        this.hiddenSets = new Set();
        this.isolatedSet = null; // { kind, name } | null
    }

    setElementTypes(types) {
        this.elementTypes = types || {};
    }

    applyState(state) {
        this.mesh = state.mesh || EMPTY_MESH;
        this.summary = state.summary || this.summary;
        this.canUndo = !!state.can_undo;
        this.canRedo = !!state.can_redo;
        this._reindex();
        bus.emit("mesh:changed", this);
    }

    _reindex() {
        this.nodesMap = new Map(this.mesh.nodes.map(n => [n.id, n]));
        this.elementsMap = new Map(this.mesh.elements.map(e => [e.id, e]));

        this.elementsByNode = new Map();
        for (const el of this.mesh.elements) {
            for (const nid of el.node_ids) {
                if (!this.elementsByNode.has(nid)) this.elementsByNode.set(nid, []);
                this.elementsByNode.get(nid).push(el.id);
            }
        }

        const xs = this.mesh.nodes.map(n => n.x);
        const ys = this.mesh.nodes.map(n => n.y);
        const minX = xs.length ? Math.min(...xs) - 10 : -1000;
        const minY = ys.length ? Math.min(...ys) - 10 : -1000;
        const span = Math.max(1, xs.length ? Math.max(...xs) - Math.min(...xs) : 100, ys.length ? Math.max(...ys) - Math.min(...ys) : 100);
        const cell = Math.max(0.5, span / 40);
        this.spatialGrid = new SpatialHashGrid({ min: [minX, minY] }, [cell, cell]);
        for (const node of this.mesh.nodes) this.spatialGrid.insert(node);

        this._reindexEdgeFaces();
    }

    _reindexEdgeFaces() {
        // Group every edge occurrence across all 2D elements (triangles,
        // quads) by its node pair, so each occurrence can be flagged
        // boundary (used by exactly one element) or internal (shared by
        // two) - both are kept as separately pickable element faces.
        const occurrences = new Map(); // sorted node-pair key -> [{elementId, faceIndex}]
        for (const el of this.mesh.elements) {
            const n = el.node_ids.length;
            if (n < 3) continue;
            for (let i = 0; i < n; i++) {
                const a = el.node_ids[i];
                const b = el.node_ids[(i + 1) % n];
                const key = a < b ? `${a}:${b}` : `${b}:${a}`;
                if (!occurrences.has(key)) occurrences.set(key, []);
                occurrences.get(key).push({ elementId: el.id, faceIndex: i, a, b });
            }
        }

        this.edgeFaces = [];
        this.edgeFaceMap = new Map();
        for (const faces of occurrences.values()) {
            const boundary = faces.length === 1;
            for (const face of faces) {
                const key = `${face.elementId}:${face.faceIndex}`;
                const edge = { key, elementId: face.elementId, faceIndex: face.faceIndex, a: face.a, b: face.b, boundary };
                this.edgeFaces.push(edge);
                this.edgeFaceMap.set(key, edge);
            }
        }
    }

    node(id) {
        return this.nodesMap.get(id);
    }

    element(id) {
        return this.elementsMap.get(id);
    }

    // ---- set visibility (client-side only; not persisted to the server) ----

    setKey(kind, name) {
        return `${kind}:${name}`;
    }

    isSetHidden(kind, name) {
        // Isolate only ever affects sets of its own kind - isolating a
        // surface set must not hide an unrelated node set, and vice versa.
        if (this.isolatedSet && this.isolatedSet.kind === kind) {
            return this.isolatedSet.name !== name;
        }
        return this.hiddenSets.has(this.setKey(kind, name));
    }

    toggleSetVisibility(kind, name) {
        this.isolatedSet = null;
        const key = this.setKey(kind, name);
        if (this.hiddenSets.has(key)) this.hiddenSets.delete(key);
        else this.hiddenSets.add(key);
        bus.emit("visibility:changed", this);
    }

    isolateSet(kind, name) {
        if (this.isolatedSet && this.isolatedSet.kind === kind && this.isolatedSet.name === name) {
            this.isolatedSet = null;
        } else {
            this.isolatedSet = { kind, name };
        }
        bus.emit("visibility:changed", this);
    }

    isNodeVisible(nodeId) {
        // True isolate (Blender's "hide unselected"): show only members of
        // the isolated set, not just "un-hide the other named sets".
        if (this.isolatedSet?.kind === "node") {
            return (this.mesh.node_sets[this.isolatedSet.name] || []).includes(nodeId);
        }
        for (const [name, ids] of Object.entries(this.mesh.node_sets)) {
            if (ids.includes(nodeId) && this.isSetHidden("node", name)) return false;
        }
        return true;
    }

    isElementVisible(elementId) {
        // Surface sets are edges, not elements - hiding/isolating one must
        // only affect the edge line itself (see isEdgeVisible), never the
        // element(s) it belongs to.
        if (this.isolatedSet?.kind === "element") {
            return (this.mesh.element_sets[this.isolatedSet.name] || []).includes(elementId);
        }
        for (const [name, ids] of Object.entries(this.mesh.element_sets)) {
            if (ids.includes(elementId) && this.isSetHidden("element", name)) return false;
        }
        return true;
    }

    // A pickable element face (from `edgeFaces`/`edgeFaceMap`) is visible
    // when its owning element is visible, and it isn't hidden/excluded by
    // surface-set hide or isolate.
    isEdgeVisible(edge) {
        return this.isElementVisible(edge.elementId) && !this._isEdgeExcludedBySurfaceSets(edge);
    }

    // True when the edge's own surface set is hidden (not isolated-out -
    // that case highlights the isolated set instead, see isEdgeIsolated,
    // and leaves every other edge's normal appearance alone), but its
    // element is otherwise visible - the renderer draws these as a dim
    // "ghost" (there, but turned off) instead of just vanishing, since the
    // element's own border would otherwise retrace the exact same line and
    // make the hide toggle look like it did nothing.
    isEdgeGhosted(edge) {
        if (this.isolatedSet?.kind === "surface") return false;
        return this.isElementVisible(edge.elementId) && this._isEdgeExcludedBySurfaceSets(edge);
    }

    // True when a surface set is isolated and this edge is one of its
    // members - the renderer highlights these in the isolate color instead
    // of letting them blend into the element's own plain border.
    isEdgeIsolated(edge) {
        if (this.isolatedSet?.kind !== "surface") return false;
        const tokens = this.mesh.surface_sets[this.isolatedSet.name] || [];
        return resolveSurfaceFaces(tokens, this.mesh.element_sets, this.edgeFaces).includes(edge.key);
    }

    _isEdgeExcludedBySurfaceSets(edge) {
        if (this.isolatedSet?.kind === "surface") {
            const tokens = this.mesh.surface_sets[this.isolatedSet.name] || [];
            return !resolveSurfaceFaces(tokens, this.mesh.element_sets, this.edgeFaces).includes(edge.key);
        }
        for (const [name, tokens] of Object.entries(this.mesh.surface_sets)) {
            if (!this.isSetHidden("surface", name)) continue;
            if (resolveSurfaceFaces(tokens, this.mesh.element_sets, this.edgeFaces).includes(edge.key)) return true;
        }
        return false;
    }
}

export const store = new Store();
