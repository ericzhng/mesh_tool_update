const socket = io();

let isDeleting = false;
let lastEmittedConnection = null; // New: To store the last connection emitted to the server

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
        if (appState.isNewImport) { // Only show success message on a new import
            showMessage('Mesh loaded successfully.', 'success');
        }
    } else {
        spatialGrid = null;
        appState.meshLoaded = false;
        appState.meshDisplayed = false;
        showMessage('Mesh cleared.', 'success');
    }

    if (appState.isNewImport) {
        centerAndDrawMesh(mesh);
        appState.isNewImport = false; // Reset the flag
    }
    isDeleting = false;

    // Highlight the newly added connection if applicable
    if (window.lastEmittedConnection) {
        const newConnection = mesh.connections.find(c =>
            (c.source === window.lastEmittedConnection.source && c.target === window.lastEmittedConnection.target) ||
            (c.source === window.lastEmittedConnection.target && c.target === window.lastEmittedConnection.source)
        );
        if (newConnection) {
            window.setHighlightedConnection(newConnection.id);
        }
        window.lastEmittedConnection = null; // Reset after processing
    }

    scheduleDrawMesh();
    window.updateSummary({ num_nodes: mesh.nodes.length, num_lines: mesh.connections.length, num_elements: mesh.elements.length });
});

socket.on('mesh_summary', window.updateSummary);

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', async () => {
    resizeCanvas();

    console.log('DOM Content Loaded. Retrieving project file handle...');
    staleFileHandle = await retrieveFileHandle(); // Assign to stale handle
    // console.log('Stale file handle after retrieval:', staleFileHandle);
    if (staleFileHandle) {
        // We don't grant permission here, so we just notify the user that we know about the file.
        showMessage(`Previously saved to: ${staleFileHandle.name}. Click Save to commit changes.`, 'info');
    }

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
            window.updateSummary({ num_nodes: mesh.nodes.length, num_lines: mesh.connections.length, num_elements: mesh.elements.length });
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
            } else {
                // If no nodes, ensure mesh is empty and state is correct
                mesh.nodes = [];
                mesh.connections = [];
                mesh.elements = [];
                nodesMap = new Map();
                spatialGrid = null;
                appState.meshLoaded = false;
                appState.meshDisplayed = false;
            }
            centerAndDrawMesh(mesh); // Always call after initial load
            window.updateSummary({ num_nodes: mesh.nodes.length, num_lines: mesh.connections.length, num_elements: mesh.elements.length });
            historyManager.pushState();
        });
    }

    // Reset editing modes on page load to ensure a clean state
    appState.addNodeMode = false;
    appState.addConnectionMode = false;
    appState.removeNodeMode = false;
    appState.isEditingMode = false;
    appState.firstNodeForConnection = null;
    updateEditModeIndicator(); // Update the UI to reflect the reset modes
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
    } else if (appState.removeNodeMode) { // New: Remove Node Mode
        indicator.textContent = 'Remove Node Mode | Select nodes to remove | Press Enter to Exit';
        indicator.classList.remove('hidden');
        canvas.style.cursor = 'crosshair';
    } else if (appState.removeConnectionMode) { // New: Remove Connection Mode
        indicator.textContent = 'Remove Connection Mode | Click on a connection to remove it | Press Enter to Exit';
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
        appState.removeNodeMode = false; // Ensure other modes are off
        appState.firstNodeForConnection = null;
    }
    
    updateEditModeIndicator();
}
window.addNode = addNode;

function removeNode() { // New function for remove node mode
    appState.removeNodeMode = !appState.removeNodeMode;
    appState.isEditingMode = appState.removeNodeMode;

    if (appState.removeNodeMode) {
        appState.addNodeMode = false; // Ensure other modes are off
        appState.addConnectionMode = false;
        appState.firstNodeForConnection = null;
    }
    window.selectedNodes = []; // Clear selection when entering/exiting remove mode
    updateEditModeIndicator();
}
window.removeNode = removeNode;

function deleteSelected() {
    if (window.selectedNodes.length > 0) {
        isDeleting = true;
        const nodeIdsToDelete = window.selectedNodes.map(node => node.id);
        socket.emit('delete_nodes_bulk', { ids: nodeIdsToDelete }, () => {
            // This callback is executed after the server confirms the deletion
            window.selectedNodes = []; // Clear selection after deletion
            showMessage(`Deleted ${nodeIdsToDelete.length} node(s).`, 'success');
            pushStateToHistory();
            isDeleting = false;
        });
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
        appState.removeNodeMode = false; // Ensure other modes are off
        appState.firstNodeForConnection = null;
    } else {
        appState.firstNodeForConnection = null;
    }

    updateEditModeIndicator();
}
window.addConnection = addConnection;

function removeConnection() {
    appState.removeConnectionMode = !appState.removeConnectionMode;
    appState.isEditingMode = appState.removeConnectionMode;

    if (appState.removeConnectionMode) {
        appState.addNodeMode = false;
        appState.addConnectionMode = false;
        appState.removeNodeMode = false; // Ensure other modes are off
        appState.firstNodeForConnection = null;
        showMessage('Remove Connection Mode | Click on a connection to remove it | Press Enter to Exit', 'info');
    } else {
        showMessage('Exited Remove Connection Mode', 'info');
    }
    window.selectedNodes = []; // Clear selection when entering/exiting remove mode
    updateEditModeIndicator();
}
window.removeConnection = removeConnection;

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

function createDelaunayTriangulation() {
    console.log('createDelaunayTriangulation called. Selected nodes:', window.selectedNodes.map(n => n.id)); // Added console.log
    if (window.selectedNodes.length < 3) {
        showMessage('Select at least 3 nodes to create a Delaunay triangulation.', 'error');
        return;
    }

    const points = window.selectedNodes.map(node => [node.x, node.y]);
    const delaunay = d3.Delaunay.from(points);

    const newConnections = [];
    const existingConnections = new Set(mesh.connections.map(c => {
        const source = Math.min(c.source, c.target);
        const target = Math.max(c.source, c.target);
        return `${source}-${target}`;
    }));

    let connectionIdCounter = mesh.connections.length > 0 ? Math.max(...mesh.connections.map(c => c.id)) + 1 : 1;

    for (let i = 0; i < points.length; i++) {
        for (const j of delaunay.neighbors(i)) {
            const node1 = window.selectedNodes[i];
            const node2 = window.selectedNodes[j];

            const sourceId = Math.min(node1.id, node2.id);
            const targetId = Math.max(node1.id, node2.id);
            const connectionKey = `${sourceId}-${targetId}`;

            if (!existingConnections.has(connectionKey)) {
                newConnections.push({
                    id: connectionIdCounter++,
                    source: node1.id,
                    target: node2.id
                });
                existingConnections.add(connectionKey);
            }
        }
    }

    if (newConnections.length > 0) {
        socket.emit('add_triangulation_connections', { connections: newConnections });
        showMessage(`Added ${newConnections.length} new triangulation connections.`, 'success');
        // Update local mesh immediately for responsiveness
        // mesh.connections.push(...newConnections);
        // scheduleDrawMesh();
        pushStateToHistory(); // Record this action in history
    } else {
        showMessage('No new triangulation connections were generated.', 'info');
    }
}
window.createDelaunayTriangulation = createDelaunayTriangulation;
