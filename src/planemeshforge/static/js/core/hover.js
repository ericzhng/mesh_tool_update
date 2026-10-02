// What the cursor is currently over, independent of selection - tools write
// to this on every pointer move, the renderer reads it to draw a Blender-
// style hover preview before the user clicks. Plain mutable singleton: no
// event wiring needed since tool-manager already redraws on every move.
class Hover {
    constructor() {
        this.nodeId = null;
        this.elementId = null;
        this.faceKey = null;
    }

    setNode(id) {
        this.nodeId = id;
        this.elementId = null;
        this.faceKey = null;
    }

    setElement(id) {
        this.elementId = id;
        this.nodeId = null;
        this.faceKey = null;
    }

    setFace(key) {
        this.faceKey = key;
        this.nodeId = null;
        this.elementId = null;
    }

    clear() {
        this.nodeId = null;
        this.elementId = null;
        this.faceKey = null;
    }
}

export const hover = new Hover();
