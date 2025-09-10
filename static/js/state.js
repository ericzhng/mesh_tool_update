let mesh = { nodes: [], connections: [] };
let nodesMap = new Map();
let spatialGrid = null;
let appState = {
    meshLoaded: false,
    meshDisplayed: false,
};

let view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, drawPending: false };
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
        console.log(`HistoryManager initialized. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
        this.updateButtons();
    }

    pushState() {
        const currentState = this.getCurrentState();

        if (this.pointer < this.history.length - 1) {
            this.history = this.history.slice(0, this.pointer + 1);
        }
        this.history.push(currentState);
        this.pointer++;
        this.saveToLocalStorage();
        console.log(`State pushed. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
        this.updateButtons();
    }

    undo() {
        if (this.pointer > 0) {
            this.pointer--;
            console.log(`Undo operation. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
            this.applyState();
        } else {
            console.log("Cannot undo. Pointer at start.");
        }
    }

    redo() {
        if (this.pointer < this.history.length - 1) {
            this.pointer++;
            console.log(`Redo operation. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
            this.applyState();
        } else {
            console.log("Cannot redo. Pointer at end.");
        }
    }

    applyState() {
        const stateToApply = JSON.parse(JSON.stringify(this.history[this.pointer]));

        this.state.mesh = stateToApply.mesh;
        this.state.view = stateToApply.view;
        this.state.appState = stateToApply.appState;

        this.callbacks.onStateApplied();
        this.saveToLocalStorage();
        console.log(`State applied. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
        this.updateButtons();
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
            console.log(`State loaded from localStorage. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
            this.applyState();
            return true;
        }
        console.log("No state found in localStorage.");
        return false;
    }

    getCurrentState() {
        return {
            mesh: JSON.parse(JSON.stringify(this.state.mesh)),
            view: JSON.parse(JSON.stringify(this.state.view)),
            appState: JSON.parse(JSON.stringify(this.state.appState)),
        };
    }

    updateButtons() {
        if (this.callbacks.onHistoryChange) {
            this.callbacks.onHistoryChange();
        }
    }
}

let historyManager;

function pushStateToHistory() {
    if (historyManager) {
        historyManager.pushState();
    }
}
window.pushStateToHistory = pushStateToHistory;