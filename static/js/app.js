const socket = io();

let isDeleting = false;

// --- SOCKET.IO HANDLERS ---

socket.on('mesh_data', data => {
    const meshData = data.mesh || data;
    const isDragging = data.isDragging || false;
    const draggingNodeId = data.draggingNodeId || null;

    // console.log('Received meshData:', meshData); // Added for debugging

    if (isDragging && draggingNodeId !== null) {
        // During dragging, only update nodes that are NOT part of the current selection
        // The selected nodes' positions are already updated locally in the mousemove handler
        const selectedNodeIds = new Set(window.selectedNodes.map(n => n.id));
        const updatedNodesMap = new Map(meshData.nodes.map(n => [n.id, n]));
        for (const localNode of mesh.nodes) {
            if (!selectedNodeIds.has(localNode.id)) {
                const serverNode = updatedNodesMap.get(localNode.id);
                if (serverNode) {
                    localNode.x = serverNode.x;
                    localNode.y = serverNode.y;
                }
            }
        }
        // Also update connections and elements as they are not affected by local drag
        mesh.connections = meshData.connections || [];
        mesh.elements = meshData.elements || [];
    } else {
        // If not dragging, or no specific dragging node, update all mesh data normally
        mesh.nodes = meshData.nodes || [];
        mesh.connections = meshData.connections || [];
        mesh.elements = meshData.elements || [];
    }
    
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
        if (!isDragging) { // Only show message if not a dragging update
            showMessage('Mesh loaded successfully.', 'success');
        }
    } else {
        spatialGrid = null;
        appState.meshLoaded = false;
        appState.meshDisplayed = false;
        showMessage('Mesh cleared.', 'success');
    }

    // The following condition would recenter the view after many operations (like node drags)
    // which is undesirable. The user can recenter manually with the Home button.
    // if (!isDeleting && !isDragging && !appState.isEditingMode) {
    //     centerAndDrawMesh(mesh);
    // }
    isDeleting = false;

    scheduleDrawMesh();
    updateSummary(); // Removed argument
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

function updateEditModeIndicator() {
    const indicator = document.getElementById('edit-mode-indicator');
    if (!indicator) return;

    if (appState.addNodeMode) {
        indicator.textContent = 'Add Node Mode | Press Enter to Exit';
        indicator.classList.remove('hidden');
        canvas.style.cursor = 'crosshair';
    } else if (appState.addConnectionMode) {
        indicator.textContent = 'Add Connection Mode | Press Enter to Exit';
        indicator.classList.remove('hidden');
        canvas.style.cursor = 'crosshair';
    } else {
        indicator.classList.add('hidden');
        canvas.style.cursor = 'default';
    }
}
window.updateEditModeIndicator = updateEditModeIndicator;

function addNode() {
    appState.addNodeMode = !appState.addNodeMode;
    appState.isEditingMode = appState.addNodeMode;

    if (appState.addNodeMode) {
        appState.addConnectionMode = false;
        appState.firstNodeForConnection = null;
    }
    
    updateEditModeIndicator();
}
window.addNode = addNode;

function deleteSelected() {
    if (window.selectedNodes.length > 0) {
        isDeleting = true;
        const nodeIdsToDelete = window.selectedNodes.map(node => node.id);
        socket.emit('delete_nodes_bulk', { ids: nodeIdsToDelete }); // New bulk delete event
        window.selectedNodes = []; // Clear selection after deletion
        showMessage(`Deleted ${nodeIdsToDelete.length} node(s).`, 'success');
    } else {
        showMessage('No nodes selected for deletion.', 'info');
    }
}
window.deleteSelected = deleteSelected;

function addConnection() {
    appState.addConnectionMode = !appState.addConnectionMode;
    appState.isEditingMode = appState.addConnectionMode;

    if (appState.addConnectionMode) {
        appState.addNodeMode = false;
        appState.firstNodeForConnection = null;
    } else {
        appState.firstNodeForConnection = null;
    }

    updateEditModeIndicator();
}
window.addConnection = addConnection;

function removeConnection() {
    // Placeholder for remove connection functionality
    showMessage('Remove Connection functionality not yet implemented.', 'info');
}
window.removeConnection = removeConnection;

function updateSummary() { // Removed argument
    const summaryDiv = document.getElementById('summary');
    summaryDiv.innerHTML = (mesh.nodes.length > 0 || mesh.connections.length > 0 || mesh.elements.length > 0) ? 
        `Nodes: <strong>${mesh.nodes.length}</strong>, Lines: <strong>${mesh.connections.length}</strong>, Elements: <strong>${mesh.elements.length}</strong>` : 'No mesh loaded';
}
window.updateSummary = updateSummary;

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
window.toggleCheckboxAndRedraw = toggleCheckboxAndRedraw;