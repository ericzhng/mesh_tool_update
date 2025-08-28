
const socket = io();

// --- App state ---
let mesh = { nodes: [], connections: [] };
let nodesMap = new Map();
let spatialGrid = null;
let appState = {
    meshLoaded: false,
    meshDisplayed: false,
};

// --- Canvas and rendering state ---
const canvas = document.getElementById('mesh-canvas');
const ctx = canvas.getContext('2d');
let view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
let drawPending = false;
const rulerSize = 30;
const lod = {
    nodeThreshold: 0.8, // view.scale threshold to draw nodes as simple points
    labelThreshold: 12, // view.scale threshold to draw labels
};

// --- UI Elements ---
const showMeshBtn = document.getElementById('show-mesh-btn');
const clearMeshBtn = document.getElementById('clear-mesh-btn');
const fileNameDiv = document.getElementById('file-name');
const summaryDiv = document.getElementById('summary');
const messageDiv = document.getElementById('message');

// --- Interaction state ---
let selectedNode = null;
let draggingNode = null;
let dragOffset = { x: 0, y: 0 };
let isPanning = false;
let isZooming = false;
let panStart = { x: 0, y: 0 };
let zoomStart = { y: 0, scale: 1, mouseX: 0, mouseY: 0 };
let isSelecting = false;
let selectStart = null;
let selectRect = null;

// --- Spatial Hash Grid for performance ---
class SpatialHashGrid {
    constructor(bounds, dimensions) {
        this.bounds = bounds;
        this.dimensions = dimensions;
        this.cells = new Map();
    }

    getCellIndex(position) {
        const x = Math.floor((position.x - this.bounds.min[0]) / this.dimensions[0]);
        const y = Math.floor((position.y - this.bounds.min[1]) / this.dimensions[1]);
        return `${x},${y}`;
    }

    insert(node) {
        const index = this.getCellIndex(node);
        if (!this.cells.has(index)) {
            this.cells.set(index, []);
        }
        this.cells.get(index).push(node);
    }

    query(bounds) {
        const results = new Set();
        const startX = Math.floor((bounds.min[0] - this.bounds.min[0]) / this.dimensions[0]);
        const startY = Math.floor((bounds.min[1] - this.bounds.min[1]) / this.dimensions[1]);
        const endX = Math.floor((bounds.max[0] - this.bounds.min[0]) / this.dimensions[0]);
        const endY = Math.floor((bounds.max[1] - this.bounds.min[1]) / this.dimensions[1]);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const index = `${x},${y}`;
                if (this.cells.has(index)) {
                    this.cells.get(index).forEach(node => results.add(node));
                }
            }
        }
        return Array.from(results);
    }
    
    queryPoint(position, radius) {
        const searchBounds = {
            min: [position.x - radius, position.y - radius],
            max: [position.x + radius, position.y + radius]
        };
        return this.query(searchBounds);
    }
}

// --- UTILITY FUNCTIONS ---

function showMessage(msg, type = 'info', duration = 3000) {
    messageDiv.textContent = msg;
    messageDiv.className = 'show';
    messageDiv.style.backgroundColor = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--accent-dark)' : 'rgba(0,0,0,0.7)';
    setTimeout(() => { messageDiv.className = ''; }, duration);
}

function updateButtonStates() {
    showMeshBtn.disabled = !appState.meshLoaded || appState.meshDisplayed;
    clearMeshBtn.disabled = !appState.meshDisplayed;
}

function updateSummary(summary) {
    summaryDiv.innerHTML = (summary.num_nodes > 0 || summary.num_connections > 0) ? 
        `Nodes: <strong>${summary.num_nodes}</strong>, Connections: <strong>${summary.num_connections}</strong>` : 'No mesh loaded';
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
    if (!fileInput.files.length) return showMessage('Please select a file first.', 'error');
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    fetch('/load', { method: 'POST', body: formData })
        .then(response => {
            if (response.ok) {
                showMessage('Mesh loaded. Click "Show Mesh" to display.', 'success');
                appState.meshLoaded = true;
                appState.meshDisplayed = false;
            } else {
                response.text().then(text => showMessage(`Error: ${text}`, 'error'));
                appState.meshLoaded = false;
            }
            updateButtonStates();
        })
        .catch(err => {
            showMessage(`Upload error: ${err}`, 'error');
            appState.meshLoaded = false;
            updateButtonStates();
        });
}

function showMesh() {
    if (!appState.meshLoaded) return showMessage('Please load a mesh file first.', 'error');
    if (appState.meshDisplayed) return showMessage('Mesh is already displayed.', 'info');

    fetch('/last_mesh').then(r => r.json()).then(data => {
        if (data.nodes && data.nodes.length > 0) {
            socket.emit('get_mesh', data);
            showMessage('Mesh displayed.', 'success');
            appState.meshDisplayed = true;
            socket.emit('get_summary');
        } else {
            showMessage('Loaded mesh has no nodes to display.', 'error');
            appState.meshDisplayed = false;
        }
        updateButtonStates();
    }).catch(() => {
        showMessage('Could not fetch mesh data from server.', 'error');
        appState.meshDisplayed = false;
        updateButtonStates();
    });
}

function clearMesh() {
    if (!appState.meshDisplayed) return showMessage('There is no mesh to clear.', 'error');
    socket.emit('clear_mesh');
}

function exportMatrix() {
    if (!appState.meshDisplayed) return showMessage('Please load and show a mesh before exporting.', 'error');
    fetch('/export').then(r => r.json()).then(data => {
        console.log(data);
        showMessage('Connectivity matrix logged to the console.', 'info');
    });
}

// --- SOCKET.IO HANDLERS ---

socket.on('mesh_data', data => {
    mesh = data;
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

    if (mesh.nodes.length === 0 && mesh.connections.length === 0) {
        appState.meshDisplayed = false;
        appState.meshLoaded = false;
        fileNameDiv.textContent = 'No file chosen';
        showMessage('Mesh cleared.', 'success');
    }
    centerAndDrawMesh(mesh);
    scheduleDrawMesh();
    updateButtonStates();
});

socket.on('mesh_summary', updateSummary);

// --- INITIALIZATION ---

const getDevicePixelRatio = () => window.devicePixelRatio || 1;

function resizeCanvas() {
    const dpr = getDevicePixelRatio();
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
    }
    scheduleDrawMesh();
}

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);

window.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();
    updateButtonStates();
    fetch('/last_mesh').then(r => r.json()).then(data => {
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

function toScreen(x, y) { // world -> css pixels
    const cosR = Math.cos(view.rotation), sinR = Math.sin(view.rotation);
    return {
        x: (x * cosR - y * sinR) * view.scale + view.offsetX,
        y: (x * sinR + y * cosR) * view.scale + view.offsetY
    };
}

function toWorld(x, y) { // css pixels -> world
    const sx = (x - view.offsetX) / view.scale;
    const sy = (y - view.offsetY) / view.scale;
    const cosR = Math.cos(-view.rotation), sinR = Math.sin(-view.rotation);
    return { x: sx * cosR - sy * sinR, y: sx * sinR + sy * cosR };
}

function getRulerStep(scale) {
    const minPxPerStep = 50;
    const stepValues = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000];
    let idealStep = minPxPerStep / scale;
    return stepValues.find(v => v > idealStep) || stepValues[stepValues.length - 1];
}

function drawRulers() {
    const viewWidth = canvas.getBoundingClientRect().width;
    const viewHeight = canvas.getBoundingClientRect().height;

    ctx.save();
    ctx.font = '11px Arial';
    ctx.fillStyle = '#888';
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 0.5;

    ctx.fillStyle = '#f4f6fa';
    ctx.fillRect(0, 0, viewWidth, rulerSize);
    ctx.fillRect(0, 0, rulerSize, viewHeight);

    const step = getRulerStep(view.scale);
    const startWorld = toWorld(rulerSize, rulerSize);
    const endWorld = toWorld(viewWidth, viewHeight);

    let lastLabelX = -Infinity;
    for (let x = Math.floor(startWorld.x / step) * step; x < endWorld.x; x += step) {
        const sx = toScreen(x, 0).x;
        if (sx < rulerSize) continue;
        ctx.beginPath();
        ctx.moveTo(sx, rulerSize);
        ctx.lineTo(sx, 0);
        ctx.stroke();
        const label = Number.isInteger(step) ? x.toString() : x.toFixed(2);
        const labelWidth = ctx.measureText(label).width;
        if (sx - lastLabelX > labelWidth + 10) {
            ctx.fillText(label, sx + 2, 12);
            lastLabelX = sx;
        }
    }

    let lastLabelY = -Infinity;
    for (let y = Math.floor(startWorld.y / step) * step; y < endWorld.y; y += step) {
        const sy = toScreen(0, y).y;
        if (sy < rulerSize) continue;
        ctx.beginPath();
        ctx.moveTo(rulerSize, sy);
        ctx.lineTo(0, sy);
        ctx.stroke();
        const label = Number.isInteger(step) ? y.toString() : y.toFixed(2);
        if (sy - lastLabelY > 15) {
            ctx.fillText(label, 2, sy - 2);
            lastLabelY = sy;
        }
    }

    ctx.fillStyle = '#e8eaed';
    ctx.fillRect(0, 0, rulerSize, rulerSize);
    ctx.restore();
}

function drawMesh() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawRulers();

    ctx.save();
    ctx.rect(rulerSize, rulerSize, rect.width - rulerSize, rect.height - rulerSize);
    ctx.clip();

    const viewBounds = { min: toWorld(rulerSize, rulerSize), max: toWorld(rect.width, rect.height) };
    const queryBounds = {
        min: [Math.min(viewBounds.min.x, viewBounds.max.x), Math.min(viewBounds.min.y, viewBounds.max.y)],
        max: [Math.max(viewBounds.min.x, viewBounds.max.x), Math.max(viewBounds.min.y, viewBounds.max.y)]
    };
    
    const visibleNodes = spatialGrid ? spatialGrid.query(queryBounds) : [];

    mesh.connections.forEach(c => {
        const n1 = nodesMap.get(c.source);
        const n2 = nodesMap.get(c.target);
        if (n1 && n2) {
            const p1 = toScreen(n1.x, n1.y), p2 = toScreen(n2.x, n2.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = 'rgba(0, 100, 255, 0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    });

    const nodeRadius = view.scale < lod.nodeThreshold ? 0.5 : 3;
    const showLabels = view.scale >= lod.labelThreshold;

    visibleNodes.forEach(n => {
        const p = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = (selectedNode && selectedNode.id === n.id) ? 'var(--danger)' : 'var(--primary)';
        ctx.fill();
        if (showLabels) {
            ctx.fillStyle = '#000';
            ctx.fillText(n.id, p.x + nodeRadius + 2, p.y);
        }
    });

    if (isSelecting && selectRect) {
        ctx.strokeStyle = 'rgba(0, 100, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(selectRect.x, selectRect.y, selectRect.w, selectRect.h);
        ctx.setLineDash([]);
    }

    ctx.restore();
}

function centerAndDrawMesh(data) {
    if (!data.nodes.length) return;
    const rect = canvas.getBoundingClientRect();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    data.nodes.forEach(n => {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });

    const meshWidth = maxX - minX, meshHeight = maxY - minY;
    const scaleX = (rect.width - rulerSize * 2) / meshWidth;
    const scaleY = (rect.height - rulerSize * 2) / meshHeight;
    view.scale = Math.min(scaleX, scaleY) * 0.9;

    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    view.offsetX = -centerX * view.scale + rect.width / 2;
    view.offsetY = -centerY * view.scale + rect.height / 2;

    scheduleDrawMesh();
}

// --- CANVAS EVENT HANDLERS ---

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', e => {
    const pos = getMousePos(e);

    if (e.button === 0) { // Left click
        const worldPos = toWorld(pos.x, pos.y);
        let clickedNode = null;
        if (spatialGrid) {
            const clickRadius = 10 / view.scale;
            const nearbyNodes = spatialGrid.queryPoint(worldPos, clickRadius);
            let minDistance = Infinity;
            for (const node of nearbyNodes) {
                const screenPos = toScreen(node.x, node.y);
                const distance = Math.hypot(screenPos.x - pos.x, screenPos.y - pos.y);
                if (distance < 10 && distance < minDistance) {
                    minDistance = distance;
                    clickedNode = node;
                }
            }
        }
        if (clickedNode) {
            selectedNode = clickedNode;
            draggingNode = clickedNode;
            dragOffset = { x: clickedNode.x - worldPos.x, y: clickedNode.y - worldPos.y };
        } else {
            isSelecting = true;
            selectStart = pos;
        }
    } else if (e.button === 1) { // Middle click
        isZooming = true;
        zoomStart = { y: e.clientY, scale: view.scale, mouseX: pos.x, mouseY: pos.y };
        canvas.style.cursor = 'ns-resize';
    } else if (e.button === 2) { // Right click
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    }
    scheduleDrawMesh();
});

canvas.addEventListener('mousemove', e => {
    const pos = getMousePos(e);

    if (draggingNode) {
        const worldPos = toWorld(pos.x, pos.y);
        const newX = worldPos.x + dragOffset.x, newY = worldPos.y + dragOffset.y;
        socket.emit('update_node', { id: draggingNode.id, x: newX, y: newY });
    } else if (isPanning) {
        view.offsetX += e.movementX;
        view.offsetY += e.movementY;
    } else if (isZooming) {
        const dy = e.clientY - zoomStart.y;
        const scale = zoomStart.scale * Math.exp(-dy * 0.005);
        const worldPos = toWorld(zoomStart.mouseX, zoomStart.mouseY);
        view.scale = Math.max(0.01, Math.min(scale, 1000));
        const newScreenPos = toScreen(worldPos.x, worldPos.y);
        view.offsetX -= newScreenPos.x - zoomStart.mouseX;
        view.offsetY -= newScreenPos.y - zoomStart.mouseY;
    } else if (isSelecting) {
        selectRect = {
            x: Math.min(selectStart.x, pos.x), y: Math.min(selectStart.y, pos.y),
            w: Math.abs(pos.x - selectStart.x), h: Math.abs(pos.y - selectStart.y)
        };
    }
    scheduleDrawMesh();
});

window.addEventListener('mouseup', e => {
    if (isSelecting && selectRect && (selectRect.w > 10 || selectRect.h > 10)) {
        const rect = canvas.getBoundingClientRect();
        const worldRectMin = toWorld(selectRect.x, selectRect.y);
        const worldRectMax = toWorld(selectRect.x + selectRect.w, selectRect.y + selectRect.h);
        const newScaleX = (rect.width - rulerSize * 2) / Math.abs(worldRectMax.x - worldRectMin.x);
        const newScaleY = (rect.height - rulerSize * 2) / Math.abs(worldRectMax.y - worldRectMin.y);
        view.scale = Math.min(newScaleX, newScaleY) * 0.9;
        const newCenterX = (worldRectMin.x + worldRectMax.x) / 2;
        const newCenterY = (worldRectMin.y + worldRectMax.y) / 2;
        view.offsetX = -newCenterX * view.scale + rect.width / 2;
        view.offsetY = -newCenterY * view.scale + rect.height / 2;
    }
    draggingNode = null;
    isPanning = false;
    isZooming = false;
    isSelecting = false;
    selectRect = null;
    canvas.style.cursor = 'crosshair';
    scheduleDrawMesh();
});

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const pos = getMousePos(e);
    const worldPos = toWorld(pos.x, pos.y);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.scale = Math.max(0.01, Math.min(view.scale * zoomFactor, 1000));
    const newScreenPos = toScreen(worldPos.x, worldPos.y);
    view.offsetX -= newScreenPos.x - pos.x;
    view.offsetY -= newScreenPos.y - pos.y;
    scheduleDrawMesh();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('dblclick', e => {
    if (e.button === 1) { // Middle mouse button
        centerAndDrawMesh(mesh);
    }
});



// --- KEYBOARD SHORTCUTS ---
window.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
        socket.emit('delete_node', { id: selectedNode.id });
        selectedNode = null;
    }
});

// --- NODE/CONNECTION TOOLS ---
function addNode() {
    const rect = canvas.getBoundingClientRect();
    const worldPos = toWorld(rect.width / 2, rect.height / 2);
    const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
    socket.emit('add_node', { id, x: worldPos.x, y: worldPos.y });
}

