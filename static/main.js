
const socket = io();

// App state
let mesh = { nodes: [], connections: [] };
let appState = {
    meshLoaded: false, // Is a mesh file loaded on the server?
    meshDisplayed: false, // Is the mesh currently drawn on the canvas?
};

// Canvas and rendering state
const canvas = document.getElementById('mesh-canvas');
const ctx = canvas.getContext('2d');
let view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
let drawPending = false;

// UI Elements
const showMeshBtn = document.getElementById('show-mesh-btn');
const clearMeshBtn = document.getElementById('clear-mesh-btn');
const fileNameDiv = document.getElementById('file-name');
const summaryDiv = document.getElementById('summary');
const messageDiv = document.getElementById('message');

// Interaction state
let selectedNode = null;
let draggingNode = null;
let dragOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let isSelecting = false;
let selectStart = null;
let selectRect = null;
let mousePos = null;
let connectionStartNode = null;
let contextMenu = null;

// --- UTILITY FUNCTIONS ---

function showMessage(msg, type = 'info', duration = 3000) {
    messageDiv.textContent = msg;
    messageDiv.className = 'show';

    if (type === 'error') {
        messageDiv.style.backgroundColor = 'var(--danger)';
    } else if (type === 'success') {
        messageDiv.style.backgroundColor = 'var(--accent-dark)';
    } else {
        messageDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
    }

    setTimeout(() => {
        messageDiv.className = '';
    }, duration);
}

function updateButtonStates() {
    showMeshBtn.disabled = !appState.meshLoaded || appState.meshDisplayed;
    clearMeshBtn.disabled = !appState.meshDisplayed;
}

function updateSummary(summary) {
    if (summary.num_nodes > 0 || summary.num_connections > 0) {
        summaryDiv.innerHTML = `Nodes: <strong>${summary.num_nodes}</strong>, Connections: <strong>${summary.num_connections}</strong>`;
    } else {
        summaryDiv.textContent = 'No mesh loaded';
    }
}

// --- CORE API FUNCTIONS ---

function triggerFileInput() {
    document.getElementById('mesh-file').click();
}

document.getElementById('mesh-file').addEventListener('change', function() {
    if (this.files.length) {
        fileNameDiv.textContent = this.files[0].name;
        uploadMesh();
    } else {
        fileNameDiv.textContent = 'No file chosen';
    }
});

function uploadMesh() {
    const fileInput = document.getElementById('mesh-file');
    if (!fileInput.files.length) {
        showMessage('Please select a file first.', 'error');
        return;
    }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    fetch('/load', { method: 'POST', body: formData })
        .then(response => {
            if (response.ok) {
                showMessage('Mesh loaded. Click "Show Mesh" to display.', 'success');
                appState.meshLoaded = true;
                appState.meshDisplayed = false;
                updateButtonStates();
            } else {
                response.text().then(text => showMessage(`Error: ${text}`, 'error'));
                appState.meshLoaded = false;
                updateButtonStates();
            }
        })
        .catch(err => {
            showMessage(`Upload error: ${err}`, 'error');
            appState.meshLoaded = false;
            updateButtonStates();
        });
}

function showMesh() {
    if (!appState.meshLoaded) {
        showMessage('Please load a mesh file first.', 'error');
        return;
    }
    if (appState.meshDisplayed) {
        showMessage('Mesh is already displayed.', 'info');
        return;
    }

    fetch('/last_mesh')
        .then(r => r.json())
        .then(data => {
            if (data.nodes && data.nodes.length > 0) {
                mesh = data;
                centerAndDrawMesh();
                showMessage('Mesh displayed.', 'success');
                appState.meshDisplayed = true;
                updateButtonStates();
                socket.emit('get_summary');
            } else {
                showMessage('Loaded mesh has no nodes to display.', 'error');
                appState.meshDisplayed = false;
                updateButtonStates();
            }
        })
        .catch(() => {
            showMessage('Could not fetch mesh data from server.', 'error');
            appState.meshDisplayed = false;
            updateButtonStates();
        });
}

function clearMesh() {
    if (!appState.meshDisplayed) {
        showMessage('There is no mesh to clear.', 'error');
        return;
    }
    socket.emit('clear_mesh');
}

function exportMatrix() {
    if (!appState.meshDisplayed) {
        showMessage('Please load and show a mesh before exporting.', 'error');
        return;
    }
    fetch('/export').then(r => r.json()).then(data => {
        console.log(data);
        showMessage('Connectivity matrix logged to the console.', 'info');
    });
}

// --- SOCKET.IO HANDLERS ---

socket.on('mesh_data', data => {
    mesh = data;
    if (mesh.nodes.length === 0 && mesh.connections.length === 0) {
        appState.meshDisplayed = false;
        appState.meshLoaded = false;
        fileNameDiv.textContent = 'No file chosen';
        showMessage('Mesh cleared.', 'success');
    }
    scheduleDrawMesh();
    updateButtonStates();
});

socket.on('mesh_summary', updateSummary);

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', function() {
    updateButtonStates();
    drawMesh();

    fetch('/last_mesh')
        .then(r => r.json())
        .then(data => {
            if (data.nodes && data.nodes.length) {
                appState.meshLoaded = true;
                showMessage('Previous mesh found. Click "Show Mesh".', 'info');
                updateButtonStates();
            }
        });
});


// --- DRAWING AND CANVAS ---

function scheduleDrawMesh() {
    if (!drawPending) {
        drawPending = true;
        window.requestAnimationFrame(() => {
            drawMesh();
            drawPending = false;
        });
    }
}

function toScreen(x, y) {
    const cosR = Math.cos(view.rotation);
    const sinR = Math.sin(view.rotation);
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;
    return {
        x: (rx * view.scale) + view.offsetX,
        y: (ry * view.scale) + view.offsetY
    };
}

function toWorld(x, y) {
    const sx = (x - view.offsetX) / view.scale;
    const sy = (y - view.offsetY) / view.scale;
    const cosR = Math.cos(-view.rotation);
    const sinR = Math.sin(-view.rotation);
    return {
        x: sx * cosR - sy * sinR,
        y: sx * sinR + sy * cosR
    };
}

function drawMesh() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    // Draw connections
    mesh.connections.forEach(c => {
        const n1 = mesh.nodes.find(n => n.id === c.source);
        const n2 = mesh.nodes.find(n => n.id === c.target);
        if (n1 && n2) {
            const p1 = toScreen(n1.x, n1.y);
            const p2 = toScreen(n2.x, n2.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = 'rgba(0, 100, 255, 0.6)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    // Draw nodes
    const nodeRadius = 6;
    mesh.nodes.forEach(n => {
        const p = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = (selectedNode && selectedNode.id === n.id) ? 'var(--danger)' : 'var(--primary)';
        ctx.fill();
    });

    ctx.restore();
}

function centerAndDrawMesh() {
    if (!mesh.nodes.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    mesh.nodes.forEach(n => {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
    });

    const meshWidth = maxX - minX;
    const meshHeight = maxY - minY;
    const scaleX = canvas.width / meshWidth;
    const scaleY = canvas.height / meshHeight;
    view.scale = Math.min(scaleX, scaleY) * 0.9;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    view.offsetX = -centerX * view.scale;
    view.offsetY = -centerY * view.scale;

    scheduleDrawMesh();
}

// --- CANVAS EVENT HANDLERS ---

canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2;
    const mouseY = e.clientY - rect.top - canvas.height / 2;

    if (e.button === 0) { // Left click
        const worldPos = toWorld(mouseX, mouseY);
        let clickedNode = null;
        for (const n of mesh.nodes) {
            const p = toScreen(n.x, n.y);
            if (Math.hypot(mouseX - p.x, mouseY - p.y) < 6) {
                clickedNode = n;
                break;
            }
        }

        if (clickedNode) {
            selectedNode = clickedNode;
            draggingNode = clickedNode;
            const nodeWorldPos = toWorld(toScreen(clickedNode.x, clickedNode.y).x, toScreen(clickedNode.y, clickedNode.y).y);
            dragOffset = { x: clickedNode.x - worldPos.x, y: clickedNode.y - worldPos.y };
        } else {
            isSelecting = true;
            selectStart = { x: mouseX, y: mouseY };
        }
    } else if (e.button === 1) { // Middle click
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    }
});

canvas.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2;
    const mouseY = e.clientY - rect.top - canvas.height / 2;
    mousePos = { x: mouseX, y: mouseY };

    if (draggingNode) {
        const worldPos = toWorld(mouseX, mouseY);
        const newX = worldPos.x + dragOffset.x;
        const newY = worldPos.y + dragOffset.y;
        socket.emit('update_node', { id: draggingNode.id, x: newX, y: newY });
    } else if (isPanning) {
        view.offsetX += e.movementX;
        view.offsetY += e.movementY;
        scheduleDrawMesh();
    } else if (isSelecting) {
        // Logic for drawing selection rectangle can be added here
    }
});

window.addEventListener('mouseup', function(e) {
    draggingNode = null;
    isPanning = false;
    isSelecting = false;
    canvas.style.cursor = 'crosshair';
});

canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvas.width / 2;
    const mouseY = e.clientY - rect.top - canvas.height / 2;
    const worldPos = toWorld(mouseX, mouseY);

    const zoomFactor = 1.1;
    const scale = e.deltaY < 0 ? view.scale * zoomFactor : view.scale / zoomFactor;
    view.scale = Math.max(0.1, Math.min(scale, 100));

    const newScreenPos = toScreen(worldPos.x, worldPos.y);
    view.offsetX -= newScreenPos.x - mouseX;
    view.offsetY -= newScreenPos.y - mouseY;

    scheduleDrawMesh();
});

// --- ZOOM AND CENTER BUTTONS ---
document.getElementById('zoom-in').onclick = () => {
    view.scale *= 1.2;
    scheduleDrawMesh();
};
document.getElementById('zoom-out').onclick = () => {
    view.scale /= 1.2;
    scheduleDrawMesh();
};
document.getElementById('center-btn').onclick = centerAndDrawMesh;

// --- KEYBOARD SHORTCUTS ---
window.addEventListener('keydown', function(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
        socket.emit('delete_node', { id: selectedNode.id });
        selectedNode = null;
    }
});

// --- NODE/CONNECTION TOOLS ---
function addNode() {
    const worldPos = toWorld(0, 0); // Add node at the center of the current view
    const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
    socket.emit('add_node', { id, x: worldPos.x, y: worldPos.y });
}

