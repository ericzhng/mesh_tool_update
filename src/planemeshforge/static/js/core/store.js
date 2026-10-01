// The single source of truth for mesh data on the client. Everything here is
// rebuilt wholesale from the `mesh_state` payload the server broadcasts
// after every change - the client never mutates mesh data itself, it only
// asks the server to (see net/client.js) and reacts to the result.
import { bus } from "./events.js";
import { SpatialHashGrid } from "./spatial-hash-grid.js";
import { resolveSurfaceElementIds } from "./surfaces.js";

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

        // Boundary edges of 2D elements (triangles/quads) - edges used by
        // exactly one element - the pickable "surfaces". Rebuilt on every
        // mesh:changed. Keyed by `${elementId}:${faceIndex}`.
        this.boundaryEdges = [];
        this.boundaryEdgeMap = new Map();

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

        this._reindexBoundaryEdges();
    }

    _reindexBoundaryEdges() {
        // Count every edge occurrence across all 2D elements (triangles,
        // quads); an edge used by exactly one element is a boundary face.
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

        this.boundaryEdges = [];
        this.boundaryEdgeMap = new Map();
        for (const faces of occurrences.values()) {
            if (faces.length !== 1) continue;
            const face = faces[0];
            const key = `${face.elementId}:${face.faceIndex}`;
            const edge = { key, elementId: face.elementId, faceIndex: face.faceIndex, a: face.a, b: face.b };
            this.boundaryEdges.push(edge);
            this.boundaryEdgeMap.set(key, edge);
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
        if (this.isolatedSet) {
            return !(this.isolatedSet.kind === kind && this.isolatedSet.name === name);
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
        for (const [name, ids] of Object.entries(this.mesh.node_sets)) {
            if (ids.includes(nodeId) && this.isSetHidden("node", name)) return false;
        }
        return true;
    }

    isElementVisible(elementId) {
        for (const [name, ids] of Object.entries(this.mesh.element_sets)) {
            if (ids.includes(elementId) && this.isSetHidden("element", name)) return false;
        }
        for (const [name, tokens] of Object.entries(this.mesh.surface_sets)) {
            if (!this.isSetHidden("surface", name)) continue;
            if (resolveSurfaceElementIds(tokens, this.mesh.element_sets).includes(elementId)) return false;
        }
        return true;
    }
}

export const store = new Store();
