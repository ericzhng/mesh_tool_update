let mesh = { nodes: [], connections: [] };
let nodesMap = new Map();
let spatialGrid = null;
let appState = {
    meshLoaded: false,
    meshDisplayed: false,
};

let view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
let drawPending = false;
const rulerSize = 30;
const lod = {
    nodeThreshold: 0.8, // view.scale threshold to draw nodes as simple points
    labelThreshold: 12, // view.scale threshold to draw labels
};

let selectedNode = null;
let draggingNode = null;
let isDraggingNode = false;
let dragOffset = { x: 0, y: 0 };
let isPanning = false;
let isZooming = false;
let panStart = { x: 0, y: 0 };
let zoomStart = { y: 0, scale: 1, mouseX: 0, mouseY: 0 };
let isSelecting = false;
let selectStart = null;
let selectRect = null;
let projectFileHandle = null;

class HistoryManager {
    constructor(state, callbacks) {
        this.history = [];
        this.pointer = -1;
        this.state = state;
        this.callbacks = callbacks;
    }

    pushState() {
        const currentState = this.getCurrentState();
        if (this.pointer >= 0 && JSON.stringify(currentState) === JSON.stringify(this.history[this.pointer])) {
            return;
        }

        if (this.pointer < this.history.length - 1) {
            this.history = this.history.slice(0, this.pointer + 1);
        }
        this.history.push(currentState);
        this.pointer++;
        this.saveToLocalStorage();
    }

    undo() {
        if (this.pointer > 0) {
            this.pointer--;
            this.applyState();
        }
    }

    redo() {
        if (this.pointer < this.history.length - 1) {
            this.pointer++;
            this.applyState();
        }
    }

    applyState() {
        const stateToApply = JSON.parse(JSON.stringify(this.history[this.pointer]));
        this.state.mesh = stateToApply.mesh;
        this.state.view = stateToApply.view;
        this.state.appState = stateToApply.appState;

        this.callbacks.onStateApplied();
        this.saveToLocalStorage();
    }

    saveToLocalStorage() {
        if (this.history.length > 0) {
            localStorage.setItem('meshProjectState', JSON.stringify(this.history[this.pointer]));
        }
    }

    loadFromLocalStorage() {
        const savedState = localStorage.getItem('meshProjectState');
        if (savedState) {
            const state = JSON.parse(savedState);
            this.history = [state];
            this.pointer = 0;
            this.applyState();
            return true;
        }
        return false;
    }

    getCurrentState() {
        return {
            mesh: this.state.mesh,
            view: this.state.view,
            appState: this.state.appState,
        };
    }
}

let historyManager;