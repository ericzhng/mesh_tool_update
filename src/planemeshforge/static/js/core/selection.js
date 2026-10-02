// Current selection of node/element ids. Tools and panels read/write this;
// nothing else holds selection state.
import { bus } from "./events.js";
import { store } from "./store.js";

class Selection {
    constructor() {
        this.nodeIds = new Set();
        this.elementIds = new Set();
        this.faceKeys = new Set(); // `${elementId}:${faceIndex}` - boundary edges ("surfaces")
    }

    clear() {
        this.nodeIds.clear();
        this.elementIds.clear();
        this.faceKeys.clear();
        this._changed();
    }

    isEmpty() {
        return this.nodeIds.size === 0 && this.elementIds.size === 0 && this.faceKeys.size === 0;
    }

    setNodes(ids) {
        this.nodeIds = new Set(ids);
        this.elementIds.clear();
        this.faceKeys.clear();
        this._changed();
    }

    setElements(ids) {
        this.elementIds = new Set(ids);
        this.nodeIds.clear();
        this.faceKeys.clear();
        this._changed();
    }

    setFaces(keys) {
        this.faceKeys = new Set(keys);
        this.nodeIds.clear();
        this.elementIds.clear();
        this._changed();
    }

    addFaces(keys) {
        keys.forEach(key => this.faceKeys.add(key));
        this._changed();
    }

    removeFaces(keys) {
        keys.forEach(key => this.faceKeys.delete(key));
        this._changed();
    }

    toggleFace(key) {
        if (this.faceKeys.has(key)) this.faceKeys.delete(key);
        else this.faceKeys.add(key);
        this._changed();
    }

    toggleNode(id) {
        if (this.nodeIds.has(id)) this.nodeIds.delete(id);
        else this.nodeIds.add(id);
        this._changed();
    }

    addNodes(ids) {
        ids.forEach(id => this.nodeIds.add(id));
        this._changed();
    }

    removeNodes(ids) {
        ids.forEach(id => this.nodeIds.delete(id));
        this._changed();
    }

    toggleElement(id) {
        if (this.elementIds.has(id)) this.elementIds.delete(id);
        else this.elementIds.add(id);
        this._changed();
    }

    selectAll() {
        this.nodeIds = new Set(store.mesh.nodes.map(n => n.id));
        this.elementIds.clear();
        this.faceKeys.clear();
        this._changed();
    }

    _changed() {
        bus.emit("selection:changed", this);
    }
}

export const selection = new Selection();

// Keep the selection consistent when the mesh changes underneath it (e.g.
// deleted nodes/elements should drop out of the selection automatically).
bus.on("mesh:changed", () => {
    let changed = false;
    for (const id of selection.nodeIds) {
        if (!store.nodesMap.has(id)) {
            selection.nodeIds.delete(id);
            changed = true;
        }
    }
    for (const id of selection.elementIds) {
        if (!store.elementsMap.has(id)) {
            selection.elementIds.delete(id);
            changed = true;
        }
    }
    for (const key of selection.faceKeys) {
        if (!store.edgeFaceMap.has(key)) {
            selection.faceKeys.delete(key);
            changed = true;
        }
    }
    if (changed) selection._changed();
});
