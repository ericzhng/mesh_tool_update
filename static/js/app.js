const socket = io();

let isDeleting = false;

// --- SOCKET.IO HANDLERS ---

socket.on('mesh_data', data => {
    const meshData = data.mesh || data;
    const isDragging = data.isDragging || false;

    // console.log('Received meshData:', meshData); // Added for debugging

    mesh.nodes = meshData.nodes || [];
    mesh.connections = meshData.connections || [];
    mesh.elements = meshData.elements || [];
    
    nodesMap = new Map(mesh.nodes.map(n => [n.id, n]));

    if (mesh.nodes.length > 0) {
        const bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
        for (const node of mesh.nodes) {
            bounds.min[0] = Math.min(bounds.min[0], node.x);
            bounds.min[1] = Math.min(bounds.min[1], node.y);
            bounds.max[0] = Math.max(bounds.max[0], node.x);
            bounds.max[1] = Math.max(bounds.max[1], node.y);
        }
        const range = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
        const cellSize = range / Math.max(1, Math.sqrt(mesh.nodes.length) / 4);
        spatialGrid = new SpatialHashGrid(bounds, [cellSize, cellSize]);
        mesh.nodes.forEach(node => spatialGrid.insert(node));

        appState.meshLoaded = true;
        appState.meshDisplayed = true;
    } else {
        spatialGrid = null;
        appState.meshLoaded = false;
        appState.meshDisplayed = false;
        showMessage('Mesh cleared.', 'success');
    }

    if (!isDeleting && !isDragging) {
        centerAndDrawMesh(mesh);
    }
    isDeleting = false;

    scheduleDrawMesh();
    updateSummary(); // Removed argument

    // Push state to history
    if (historyManager) {
        historyManager.pushState();
    }
});

socket.on('mesh_summary', updateSummary);

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();

    const state = {
        get mesh() { return mesh; },
        set mesh(value) { mesh = value; },
        get view() { return view; },
        set view(value) { view = value; },
        get appState() { return appState; },
        set appState(value) { appState = value; },
    };

    const callbacks = {
        onStateApplied: () => {
            // console.log("onStateApplied callback triggered. Current mesh:", mesh);
            // Rebuild nodesMap and spatialGrid
            nodesMap = new Map(mesh.nodes.map(n => [n.id, n]));
            if (mesh.nodes.length > 0) {
                const bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
                for (const node of mesh.nodes) {
                    bounds.min[0] = Math.min(bounds.min[0], node.x);
                    bounds.min[1] = Math.min(bounds.min[1], node.y);
                    bounds.max[0] = Math.max(bounds.max[0], node.x);
                    bounds.max[1] = Math.max(bounds.max[1], node.y);
                }
                const range = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
                const cellSize = range / Math.max(1, Math.sqrt(mesh.nodes.length) / 4);
                spatialGrid = new SpatialHashGrid(bounds, [cellSize, cellSize]);
                mesh.nodes.forEach(node => spatialGrid.insert(node));
            } else {
                spatialGrid = null;
            }
            scheduleDrawMesh();
            updateSummary();
            // console.log("onStateApplied callback finished. Mesh after rebuild:", mesh);
        },
        onHistoryChange: () => {
            updateUndoRedoButtons();
        }
    };

    historyManager = new HistoryManager(state, callbacks);

    if (!historyManager.loadFromLocalStorage()) {
        fetch('/last_mesh').then(r => r.json()).then(data => {
            if (data.nodes && data.nodes.length) {
                mesh.nodes = data.nodes;
                mesh.connections = data.connections || [];
                mesh.elements = data.elements || [];
                nodesMap = new Map(mesh.nodes.map(n => [n.id, n]));
                const bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
                for (const node of mesh.nodes) {
                    bounds.min[0] = Math.min(bounds.min[0], node.x);
                    bounds.min[1] = Math.min(bounds.min[1], node.y);
                    bounds.max[0] = Math.max(bounds.max[0], node.x);
                    bounds.max[1] = Math.max(bounds.max[1], node.y);
                }
                const range = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
                const cellSize = range / Math.max(1, Math.sqrt(mesh.nodes.length) / 4);
                spatialGrid = new SpatialHashGrid(bounds, [cellSize, cellSize]);
                mesh.nodes.forEach(node => spatialGrid.insert(node));

                appState.meshLoaded = true;
                appState.meshDisplayed = true;
                centerAndDrawMesh(mesh);
                updateSummary();
                historyManager.pushState();
            }
        });
    }
});

// --- MESH OPERATIONS ---

function addNode() {
    const rect = canvas.getBoundingClientRect();
    const worldPos = toWorld(rect.width / 2, rect.height / 2);
    const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
    socket.emit('add_node', { id, x: worldPos.x, y: worldPos.y });
}

function deleteSelected() {
    if (selectedNode) {
        isDeleting = true;
        socket.emit('delete_node', { id: selectedNode.id });
        selectedNode = null;
    }
}

function addConnection() {
    // Placeholder for add connection functionality
    showMessage('Add Connection functionality not yet implemented.', 'info');
}

function removeConnection() {
    // Placeholder for remove connection functionality
    showMessage('Remove Connection functionality not yet implemented.', 'info');
}

function updateSummary() { // Removed argument
    const summaryDiv = document.getElementById('summary');
    summaryDiv.innerHTML = (mesh.nodes.length > 0 || mesh.connections.length > 0 || mesh.elements.length > 0) ? 
        `Nodes: <strong>${mesh.nodes.length}</strong>, Lines: <strong>${mesh.connections.length}</strong>, Elements: <strong>${mesh.elements.length}</strong>` : 'No mesh loaded';
}

// --- EVENT LISTENERS ---

document.getElementById('mesh-file').addEventListener('change', function() {
    if (this.files.length) {
        uploadMesh();
    }
});

document.getElementById('show-node-labels-checkbox').addEventListener('change', () => {
    scheduleDrawMesh();
});

document.getElementById('show-element-labels-checkbox').addEventListener('change', () => {
    scheduleDrawMesh();
});

window.addEventListener('click', e => {
    if (!document.getElementById('context-menu').contains(e.target)) {
        hideContextMenu();
    }
});

function toggleCheckboxAndRedraw(checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        scheduleDrawMesh();
    }
}

