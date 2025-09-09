const socket = io();

let isDeleting = false;

// --- SOCKET.IO HANDLERS ---

socket.on('mesh_data', data => {
    mesh = data;
    mesh.elements = data.elements; // Populate elements array
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

    if (!isDeleting) {
        centerAndDrawMesh(mesh);
    }
    isDeleting = false;

    scheduleDrawMesh();
    updateSummary(get_mesh_summary());
});

socket.on('mesh_summary', updateSummary);

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();
    fetch('/last_mesh').then(r => r.json()).then(data => {
        if (data.nodes && data.nodes.length) {
            appState.meshLoaded = true;
        }
    });
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

function get_mesh_summary() {
    return {
        num_nodes: mesh.nodes.length,
        num_connections: mesh.connections.length,
    };
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

document.getElementById('rotate-cw').addEventListener('click', () => {
    rotateView(Math.PI / 2);
});

document.getElementById('rotate-ccw').addEventListener('click', () => {
    rotateView(-Math.PI / 2);
});
