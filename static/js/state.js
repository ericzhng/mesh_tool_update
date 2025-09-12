let mesh = { nodes: [], connections: [] };
let nodesMap = new Map();
let spatialGrid = null;
let appState = {
    meshLoaded: false,
    meshDisplayed: false,
    addNodeMode: false, // New state for adding nodes
    addConnectionMode: false, // New state for adding connections
    firstNodeForConnection: null, // Store the first selected node for connection
    isEditingMode: false, // New state to indicate if any editing mode is active,
    isNewImport: false, // Flag to indicate a new mesh has been imported
};

let view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, drawPending: false };
const rulerSize = 30;
const lod = {
    nodeThreshold: 0.8, // view.scale threshold to draw nodes as simple points
    labelThreshold: 12, // view.scale threshold to draw labels
};

let isPanning = false;
let isZooming = false;
let panStart = { x: 0, y: 0 };
let zoomStart = { y: 0, scale: 1, mouseX: 0, mouseY: 0 };
let isSelecting = false;
let selectStart = null;
let selectRect = null;
let projectFileHandle = null;
let staleFileHandle = null; // For holding handle retrieved from IndexedDB

/**
 * Updates the position of a node in the mesh and spatial grid.
 * @param {number} nodeId - The ID of the node to update.
 * @param {number} newX - The new X coordinate for the node.
 * @param {number} newY - The new Y coordinate for the node.
 */
function updateNodePosition(nodeId, newX, newY) {
    const node = nodesMap.get(nodeId);
    if (node) {
        // Remove from old position in spatial grid
        if (spatialGrid) {
            spatialGrid.remove(node);
        }

        node.x = newX;
        node.y = newY;

        // Insert into new position in spatial grid
        if (spatialGrid) {
            spatialGrid.insert(node);
        }
    }
}
window.updateNodePosition = updateNodePosition;

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

        this.callbacks.onStateApplied();
        this.saveToLocalStorage();
        console.log(`State applied. Pointer: ${this.pointer}, History Length: ${this.history.length}`);
        this.updateButtons();

        // After applying the state, sync it with the server
        socket.emit('sync_mesh', { mesh: this.state.mesh });
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