// A secondary, read-only highlight independent of `selection` - used by the
// set editor to call out specific ids (e.g. the token under the textarea
// caret, or a typed "Highlight" field) without disturbing the actual pick
// buffer those ids may currently be part of.
import { bus } from "./events.js";

class Highlight {
    constructor() {
        this.nodeIds = new Set();
        this.elementIds = new Set();
        this.faceKeys = new Set();
    }

    set({ nodes = [], elements = [], faces = [] } = {}) {
        this.nodeIds = new Set(nodes);
        this.elementIds = new Set(elements);
        this.faceKeys = new Set(faces);
        bus.emit("highlight:changed", this);
    }

    clear() {
        if (!this.nodeIds.size && !this.elementIds.size && !this.faceKeys.size) return;
        this.nodeIds = new Set();
        this.elementIds = new Set();
        this.faceKeys = new Set();
        bus.emit("highlight:changed", this);
    }

    isEmpty() {
        return this.nodeIds.size === 0 && this.elementIds.size === 0 && this.faceKeys.size === 0;
    }
}

export const highlight = new Highlight();
