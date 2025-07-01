// ...existing code from <script> in index.html, including all mesh logic, event handlers, and functions...

const socket = io();
let mesh = {nodes: [], connections: []};
let selectedNode = null;
let selectedConnection = null;
let drawingConnection = false;
let connectionStart = null;
let meshLoaded = null;
let view = {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotation: 0 // in radians
};
let isSelecting = false;
let selectStart = null;
let selectRect = null;
let isPanning = false;
let isZooming = false;
let panStart = {x: 0, y: 0};
let zoomStart = {y: 0, scale: 1, mouseX: 0, mouseY: 0};
let mousePos = null;
const canvas = document.getElementById('mesh-canvas');
const ctx = canvas.getContext('2d');
// Throttle drawMesh for performance
let drawPending = false;
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
    const canvas = document.getElementById('mesh-canvas');
    // Apply rotation, then scale, then offset
    const cosR = Math.cos(view.rotation);
    const sinR = Math.sin(view.rotation);
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;
    return {
        x: (rx * view.scale) + view.offsetX + canvas.width/2,
        y: (ry * view.scale) + view.offsetY + canvas.height/2
    };
}
function toWorld(x, y) {
    const canvas = document.getElementById('mesh-canvas');
    // Inverse transform: offset, scale, then rotation
    const sx = (x - view.offsetX - canvas.width/2) / view.scale;
    const sy = (y - view.offsetY - canvas.height/2) / view.scale;
    const cosR = Math.cos(-view.rotation);
    const sinR = Math.sin(-view.rotation);
    return {
        x: sx * cosR - sy * sinR,
        y: sx * sinR + sy * cosR
    };
}

function drawAxes(ctx, canvas) {
    ctx.save();
    const rulerSize = 30;
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // X axis (inside ruler area)
    let y0 = toScreen(0,0).y;
    y0 = Math.max(y0, rulerSize);
    y0 = Math.min(y0, canvas.height - rulerSize);
    ctx.moveTo(rulerSize, y0);
    ctx.lineTo(canvas.width - rulerSize, y0);
    // Y axis (inside ruler area)
    let x0 = toScreen(0,0).x;
    x0 = Math.max(x0, rulerSize);
    x0 = Math.min(x0, canvas.width - rulerSize);
    ctx.moveTo(x0, rulerSize);
    ctx.lineTo(x0, canvas.height - rulerSize);
    ctx.stroke();
    ctx.restore();
}

function drawRulers(ctx, canvas) {
    ctx.save();
    // Ruler area size
    const rulerSize = 30;
    ctx.globalAlpha = 0.5;
    // Clear ruler areas
    ctx.clearRect(0, 0, canvas.width, rulerSize); // top
    ctx.clearRect(0, 0, rulerSize, canvas.height); // left
    ctx.clearRect(canvas.width - rulerSize, 0, rulerSize, canvas.height); // right
    ctx.clearRect(0, canvas.height - rulerSize, canvas.width, rulerSize); // bottom
    ctx.fillStyle = '#f4f6fa';
    ctx.fillRect(0, 0, canvas.width, rulerSize); // top
    ctx.fillRect(0, 0, rulerSize, canvas.height); // left
    ctx.fillRect(canvas.width - rulerSize, 0, rulerSize, canvas.height); // right
    ctx.fillRect(0, canvas.height - rulerSize, canvas.width, rulerSize); // bottom
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1;
    // Draw ruler borders
    ctx.beginPath();
    ctx.moveTo(rulerSize, 0); ctx.lineTo(rulerSize, canvas.height);
    ctx.moveTo(0, rulerSize); ctx.lineTo(canvas.width, rulerSize);
    ctx.moveTo(canvas.width - rulerSize, 0); ctx.lineTo(canvas.width - rulerSize, canvas.height);
    ctx.moveTo(0, canvas.height - rulerSize); ctx.lineTo(canvas.width, canvas.height - rulerSize);
    ctx.stroke();
    ctx.font = '11px Arial';
    ctx.fillStyle = '#888';
    let step = getRulerStep(view.scale);
    let canvasW = canvas.width;
    let canvasH = canvas.height;
    // X ruler (top & bottom)
    let y0 = rulerSize;
    let yB = canvasH - rulerSize;
    let startX = toWorld(rulerSize, 0).x;
    let endX = toWorld(canvasW - rulerSize, 0).x;
    let lastLabelX = -Infinity;
    for (let x = Math.ceil(startX / step) * step; x < endX; x += step) {
        let sx = toScreen(x, 0).x;
        if (sx < rulerSize || sx > canvasW - rulerSize) continue;
        // Top ticks
        ctx.beginPath();
        ctx.moveTo(sx, y0);
        ctx.lineTo(sx, y0 - 8);
        ctx.stroke();
        // Bottom ticks
        ctx.beginPath();
        ctx.moveTo(sx, yB);
        ctx.lineTo(sx, yB + 8);
        ctx.stroke();
        // Only draw label if not overlapping previous
        if (sx - lastLabelX > 40) {
            // Show integer for >=1, decimals for <1
            let label = Math.abs(x) >= 1
                ? Math.round(x).toString()
                : x.toFixed(3).replace(/\.?0+$/, '');
            ctx.fillText(label, sx - 10, y0 - 12);
            ctx.fillText(label, sx - 10, yB + 22);
            lastLabelX = sx;
        }
    }
    // Y ruler (left & right)
    let startY = Math.min(toWorld(0, canvasH - rulerSize).y, toWorld(0, rulerSize).y);
    let endY = Math.max(toWorld(0, canvasH - rulerSize).y, toWorld(0, rulerSize).y);
    let lastLabelY = -Infinity;
    for (let y = Math.ceil(startY / step) * step; y <= endY; y += step) {
        let sy = toScreen(0, y).y;
        if (sy < rulerSize || sy > canvasH - rulerSize) continue;
        // Left ticks
        ctx.beginPath();
        ctx.moveTo(rulerSize, sy);
        ctx.lineTo(rulerSize - 8, sy);
        ctx.stroke();
        // Right ticks
        ctx.beginPath();
        ctx.moveTo(canvasW - rulerSize, sy);
        ctx.lineTo(canvasW - rulerSize + 8, sy);
        ctx.stroke();
        // Only draw label if not overlapping previous
        if (sy - lastLabelY > 30) {
            // Show integer for >=1, decimals for <1
            let label = Math.abs(y) >= 1
                ? Math.round(y).toString()
                : y.toFixed(3).replace(/\.?0+$/, '');
            ctx.fillText(label, 2, sy + 4);
            ctx.fillText(label, canvasW - rulerSize + 10, sy + 4);
            lastLabelY = sy;
        }
    }
    ctx.restore();
}
function getRulerStep(scale) {
    // Choose a step size that keeps labels readable
    const pxPerUnit = scale;
    let step = 1;
    if (pxPerUnit < 10) step = 10;
    if (pxPerUnit < 2) step = 50;
    if (pxPerUnit < 0.5) step = 100;
    return step;
}
function drawMesh() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRulers(ctx, canvas);
    drawAxes(ctx, canvas);

    // --- Add clipping region inside rulers ---
    const rulerSize = 30;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rulerSize, rulerSize, canvas.width - 2 * rulerSize, canvas.height - 2 * rulerSize);
    ctx.clip();
    // --- Mesh drawing below will be clipped ---

    // Draw connections with gradient color
    mesh.connections.forEach((c, i) => {
        const n1 = mesh.nodes.find(n => n.id === c.source);
        const n2 = mesh.nodes.find(n => n.id === c.target);
        if (n1 && n2) {
            const p1 = toScreen(n1.x, n1.y);
            const p2 = toScreen(n2.x, n2.y);
            const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
            grad.addColorStop(0, '#4f8cff');
            grad.addColorStop(1, '#00b894');
            ctx.strokeStyle = grad;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
    });
    // Auto-adjust node radius
    let radius = 12;
    if (mesh.nodes.length > 2000) {
        radius = 4;
    } else if (mesh.nodes.length > 1) {
        let minDist = Infinity;
        for (let i = 0; i < mesh.nodes.length; ++i) {
            for (let j = i + 1; j < mesh.nodes.length; ++j) {
                const p1 = toScreen(mesh.nodes[i].x, mesh.nodes[i].y);
                const p2 = toScreen(mesh.nodes[j].x, mesh.nodes[j].y);
                const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (d < minDist) minDist = d;
            }
        }
        radius = Math.max(6, Math.min(16, minDist * 0.25));
    } else if (view.scale) {
        radius = Math.max(6, Math.min(16, 12 * view.scale));
    }
    // Draw nodes
    const drawLabels = mesh.nodes.length <= 500;
    const drawShadows = mesh.nodes.length <= 500;
    mesh.nodes.forEach(n => {
        const p = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = (selectedNode && selectedNode.id === n.id) ? '#ff7675' : '#00b894';
        if (drawShadows) {
            ctx.shadowColor = '#4f8cff';
            ctx.shadowBlur = 8;
        } else {
            ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (drawLabels) {
            ctx.fillStyle = '#222';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(n.id, p.x - 7, p.y + 5);
        }
    });
    // Draw mouse coordinates
    if (mousePos) {
        const world = toWorld(mousePos.x, mousePos.y);
        ctx.save();
        ctx.fillStyle = '#222';
        ctx.font = '13px Arial';
        ctx.fillText(`(${world.x.toFixed(1)}, ${world.y.toFixed(1)})`, mousePos.x + 12, mousePos.y - 12);
        ctx.restore();
    }
}

function showMessage(msg, color = '#c00') {
    const msgDiv = document.getElementById('message');
    msgDiv.innerText = msg;
    msgDiv.style.color = color;
}

function triggerFileInput() {
    document.getElementById('mesh-file').click();
}

document.getElementById('mesh-file').addEventListener('change', function() {
    const fileNameDiv = document.getElementById('file-name');
    if (this.files.length) {
        fileNameDiv.textContent = this.files[0].name;
        // Automatically upload when file is chosen
        uploadMesh();
    } else {
        fileNameDiv.textContent = 'No file chosen';
    }
});

function uploadMesh() {
    const fileInput = document.getElementById('mesh-file');
    if (!fileInput.files.length) {
        showMessage('Please select a file.');
        return;
    }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    fetch('/load', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (response.ok) {
            showMessage('Mesh loaded successfully! Click "Show Mesh" to display.','#080');
            // Do not display mesh yet
            meshLoaded = true;
        } else {
            response.text().then(text => showMessage('Error: ' + text));
        }
    })
    .catch(err => showMessage('Error: ' + err));
}
function showMesh() {
    // Always fetch mesh from server and center it
    fetch('/last_mesh')
        .then(r => r.json())
        .then(data => {
            mesh = data;
            centerAndDrawMesh();
            showMessage('Mesh displayed.','#080');
        })
        .catch(() => showMessage('No mesh to display.'));
}

function centerAndDrawMesh() {
    if (mesh.nodes && mesh.nodes.length) {
        // Margin for rulers
        const rulerSize = 30;
        let minX = Math.min(...mesh.nodes.map(n => n.x));
        let maxX = Math.max(...mesh.nodes.map(n => n.x));
        let minY = Math.min(...mesh.nodes.map(n => n.y));
        let maxY = Math.max(...mesh.nodes.map(n => n.y));
        // Fit mesh inside the area between rulers
        const width = maxX - minX || 1;
        const height = maxY - minY || 1;
        const canvasW = canvas.width - 2 * rulerSize;
        const canvasH = canvas.height - 2 * rulerSize;
        view.rotation = 0;
        const scaleX = canvasW / width;
        const scaleY = canvasH / height;
        view.scale = Math.min(scaleX, scaleY);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        view.offsetX = -centerX * view.scale + (canvas.width / 2 - 0);
        view.offsetY = -centerY * view.scale + (canvas.height / 2 - 0);
        // Shift so mesh is centered between rulers
        view.offsetX += (rulerSize - canvas.width / 2);
        view.offsetY += (rulerSize - canvas.height / 2);
    } else {
        view.rotation = 0;
        view.scale = (canvas.width - 60) / 200;
        view.offsetX = 0;
        view.offsetY = 0;
    }
    drawMesh();
}

// On page load, if mesh is empty, try to load last mesh
window.addEventListener('DOMContentLoaded', function() {
    fetch('/last_mesh')
        .then(r => r.json())
        .then(data => {
            if (data.nodes && data.nodes.length) {
                mesh = data;
                centerAndDrawMesh();
                showMessage('Mesh loaded from last session.','#080');
            }
        });
});

function updateSummary(summary) {
    document.getElementById('summary').innerText = `Nodes: ${summary.num_nodes}, Connections: ${summary.num_connections}`;
}

socket.on('mesh_data', data => {
    mesh = data;
    scheduleDrawMesh();
});
socket.on('mesh_summary', updateSummary);

function addNode() {
    const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
    socket.emit('add_node', {id, x: 100 + Math.random()*600, y: 100 + Math.random()*400});
}

function exportMatrix() {
    fetch('/export').then(r => r.json()).then(data => {
        showMessage('Connectivity Matrix:\n' + JSON.stringify(data, null, 2), '#333');
    });
}

function clearMesh() {
    socket.emit('clear_mesh');
    showMessage('Mesh cleared.','#080');
}

// Add these variables for selection optimization
let selectionNodeScreenPositions = null;
let selectionNodeRadius = 12;
let draggingNode = null;
let dragOffset = {x: 0, y: 0};

// Pan, zoom, select, and zoom-rect events
canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.button === 0) { // Left mouse
        // Node selection and drag start
        let found = false;
        selectionNodeScreenPositions = mesh.nodes.map(n => toScreen(n.x, n.y));
        if (mesh.nodes.length > 1) {
            let minDist = Infinity;
            for (let i = 0; i < selectionNodeScreenPositions.length; ++i) {
                for (let j = i + 1; j < selectionNodeScreenPositions.length; ++j) {
                    const p1 = selectionNodeScreenPositions[i];
                    const p2 = selectionNodeScreenPositions[j];
                    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                    if (d < minDist) minDist = d;
                }
            }
            selectionNodeRadius = Math.max(6, Math.min(16, minDist * 0.25));
        } else {
            selectionNodeRadius = 12;
        }
        for (let i = 0; i < mesh.nodes.length; ++i) {
            const p = selectionNodeScreenPositions[i];
            if (Math.hypot(x - p.x, y - p.y) <= selectionNodeRadius) {
                selectedNode = mesh.nodes[i];
                selectedConnection = null;
                draggingNode = mesh.nodes[i];
                // Calculate offset between mouse and node center in world coordinates
                const world = toWorld(x, y);
                dragOffset.x = draggingNode.x - world.x;
                dragOffset.y = draggingNode.y - world.y;
                drawMesh();
                found = true;
                break;
            }
        }
        if (!found) {
            selectedNode = null;
            // Connection selection (no optimization here, but could be added if needed)
            for (let c of mesh.connections) {
                const n1 = mesh.nodes.find(n => n.id === c.source);
                const n2 = mesh.nodes.find(n => n.id === c.target);
                if (n1 && n2) {
                    const p1 = toScreen(n1.x, n1.y);
                    const p2 = toScreen(n2.x, n2.y);
                    const dist = pointLineDist(x, y, p1.x, p1.y, p2.x, p2.y);
                    if (dist < 6) {
                        selectedConnection = c;
                        drawMesh();
                        found = true;
                        break;
                    }
                }
            }
        }
        if (!found) {
            selectedNode = null;
            selectedConnection = null;
            // Start zoom selection
            isSelecting = true;
            selectStart = {x, y};
            selectRect = {x, y, w: 0, h: 0};
            // Only draw mesh once at selection start
            drawMesh();
        }
        e.preventDefault();
    } else if (e.button === 1) { // Middle mouse: pan
        isPanning = true;
        panStart.x = e.clientX;
        panStart.y = e.clientY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    }
    // Do not handle right mouse (button 2) for pan anymore
});

canvas.addEventListener('contextmenu', function(e) {
    // Allow default context menu (do not preventDefault)
    // Optionally, you can add custom menu logic here if needed
    // e.preventDefault(); // <-- REMOVE or comment out this line if present
});

window.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (draggingNode) {
        // Adjust node position in world coordinates
        const world = toWorld(x, y);
        draggingNode.x = world.x + dragOffset.x;
        draggingNode.y = world.y + dragOffset.y;
        // Send update to server
        socket.emit('update_node', {id: draggingNode.id, x: draggingNode.x, y: draggingNode.y});
        drawMesh();
    } else if (isSelecting) {
        selectRect = {
            x: Math.min(selectStart.x, x),
            y: Math.min(selectStart.y, y),
            w: Math.abs(x - selectStart.x),
            h: Math.abs(y - selectStart.y)
        };
        // Only redraw the selection rectangle overlay, not the whole mesh
        // Save the mesh image at selection start and restore it
        if (!canvas._selectionBaseImage) {
            canvas._selectionBaseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } else {
            ctx.putImageData(canvas._selectionBaseImage, 0, 0);
        }
        ctx.save();
        ctx.strokeStyle = '#4f8cff';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.strokeRect(selectRect.x, selectRect.y, selectRect.w, selectRect.h);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
        ctx.restore();
    } else if (isZooming) {
        const dy = e.clientY - zoomStart.y;
        // Zoom centered on mouse location
        const scale = zoomStart.scale * Math.exp(-dy * 0.01);
        const wx = toWorld(zoomStart.mouseX, zoomStart.mouseY).x;
        const wy = toWorld(zoomStart.mouseX, zoomStart.mouseY).y;
        view.scale = scale;
        // Keep mouse location fixed
        const screen = toScreen(wx, wy);
        view.offsetX += zoomStart.mouseX - screen.x;
        view.offsetY += zoomStart.mouseY - screen.y;
        drawMesh();
    } else if (isPanning) {
        view.offsetX += (e.movementX);
        view.offsetY += (e.movementY);
        drawMesh();
    } else if (canvas.matches(':hover')) {
        mousePos = {x, y};
        drawMesh();
    }
});
window.addEventListener('mouseup', function(e) {
    if (draggingNode) {
        draggingNode = null;
    }
    if (isSelecting) {
        isSelecting = false;
        // Remove cached image
        canvas._selectionBaseImage = null;
        if (selectRect && selectRect.w > 10 && selectRect.h > 10) {
            // Convert selection rectangle to world coordinates
            const margin = 30;
            const x1 = selectRect.x;
            const y1 = selectRect.y;
            const x2 = selectRect.x + selectRect.w;
            const y2 = selectRect.y + selectRect.h;
            const world1 = toWorld(x1, y1);
            const world2 = toWorld(x2, y2);
            const minX = Math.min(world1.x, world2.x);
            const maxX = Math.max(world1.x, world2.x);
            const minY = Math.min(world1.y, world2.y);
            const maxY = Math.max(world1.y, world2.y);
            const width = maxX - minX || 1;
            const height = maxY - minY || 1;
            const canvasW = canvas.width - 2 * margin;
            const canvasH = canvas.height - 2 * margin;
            const scaleX = canvasW / width;
            const scaleY = canvasH / height;
            view.scale = Math.min(scaleX, scaleY);
            // Center the selected area
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            view.offsetX = -centerX * view.scale;
            view.offsetY = -centerY * view.scale;
        }
        selectRect = null;
        drawMesh();
    }
    isPanning = false;
    isZooming = false;
    canvas.style.cursor = '';
});
function pointLineDist(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    return Math.hypot(px - xx, py - yy);
}

// Remove draggable logic for zoom-controls

document.getElementById('zoom-in').onclick = function() {
    const center = {x: canvas.width/2, y: canvas.height/2};
    const worldBefore = toWorld(center.x, center.y);
    view.scale = view.scale * 1.2;
    const worldAfter = toWorld(center.x, center.y);
    view.offsetX += (worldAfter.x - worldBefore.x) * view.scale;
    view.offsetY += (worldAfter.y - worldBefore.y) * view.scale;
    drawMesh();
};
document.getElementById('zoom-out').onclick = function() {
    const center = {x: canvas.width/2, y: canvas.height/2};
    const worldBefore = toWorld(center.x, center.y);
    view.scale = view.scale / 1.2;
    const worldAfter = toWorld(center.x, center.y);
    view.offsetX += (worldAfter.x - worldBefore.x) * view.scale;
    view.offsetY += (worldAfter.y - worldBefore.y) * view.scale;
    drawMesh();
};
document.getElementById('center-btn').onclick = function() {
    if (mesh.nodes && mesh.nodes.length) {
        const rulerSize = 30;
        let minX = Math.min(...mesh.nodes.map(n => n.x));
        let maxX = Math.max(...mesh.nodes.map(n => n.x));
        let minY = Math.min(...mesh.nodes.map(n => n.y));
        let maxY = Math.max(...mesh.nodes.map(n => n.y));
        const width = maxX - minX || 1;
        const height = maxY - minY || 1;
        const canvasW = canvas.width - 2 * rulerSize;
        const canvasH = canvas.height - 2 * rulerSize;
        view.rotation = 0;
        const scaleX = canvasW / width;
        const scaleY = canvasH / height;
        view.scale = Math.min(scaleX, scaleY);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        view.offsetX = -centerX * view.scale + (canvas.width / 2 - 0);
        view.offsetY = -centerY * view.scale + (canvas.height / 2 - 0);
        view.offsetX += (rulerSize - canvas.width / 2);
        view.offsetY += (rulerSize - canvas.height / 2);
    } else {
        view.rotation = 0;
        view.scale = (canvas.width - 60) / 200;
        view.offsetX = 0;
        view.offsetY = 0;
    }
    drawMesh();
};
document.getElementById('center-btn').onclick = function() {
    if (mesh.nodes && mesh.nodes.length) {
        let minX = Math.min(...mesh.nodes.map(n => n.x));
        let maxX = Math.max(...mesh.nodes.map(n => n.x));
        let minY = Math.min(...mesh.nodes.map(n => n.y));
        let maxY = Math.max(...mesh.nodes.map(n => n.y));
        const margin = 30;
        const width = maxX - minX || 1;
        const height = maxY - minY || 1;
        const canvasW = canvas.width - 2 * margin;
        const canvasH = canvas.height - 2 * margin;
        view.rotation = 0;
        const scaleX = canvasW / width;
        const scaleY = canvasH / height;
        view.scale = Math.min(scaleX, scaleY);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        view.offsetX = -centerX * view.scale;
        view.offsetY = -centerY * view.scale;
    } else {
        view.rotation = 0;
        view.scale = (canvas.width - 60) / 200;
        view.offsetX = 0;
        view.offsetY = 0;
    }
    drawMesh();
};

// Add node on double-click (empty space)
canvas.addEventListener('dblclick', function(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const world = toWorld(x, y);
    // Only add if not clicking on a node
    let found = false;
    let radius = 12;
    for (let n of mesh.nodes) {
        const p = toScreen(n.x, n.y);
        if (Math.hypot(x - p.x, y - p.y) <= radius) {
            found = true;
            break;
        }
    }
    if (!found) {
        const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
        socket.emit('add_node', {id, x: world.x, y: world.y});
    }
});

// Node selection and dragging (already present)
// ...existing code...

// Delete node on DEL key when selected
window.addEventListener('keydown', function(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
        socket.emit('delete_node', {id: selectedNode.id});
        selectedNode = null;
    }
});

// Add connection: click node, then Ctrl+click another node
let connectionStartNode = null;
canvas.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let foundIdx = -1;
    let radius = 12;
    for (let i = 0; i < mesh.nodes.length; ++i) {
        const p = toScreen(mesh.nodes[i].x, mesh.nodes[i].y);
        if (Math.hypot(x - p.x, y - p.y) <= radius) {
            foundIdx = i;
            break;
        }
    }
    if (foundIdx !== -1) {
        if (e.ctrlKey && connectionStartNode && connectionStartNode.id !== mesh.nodes[foundIdx].id) {
            // Add connection
            socket.emit('add_connection', {source: connectionStartNode.id, target: mesh.nodes[foundIdx].id});
            connectionStartNode = null;
        } else {
            selectedNode = mesh.nodes[foundIdx];
            connectionStartNode = selectedNode;
            drawMesh();
        }
    } else {
        selectedNode = null;
        connectionStartNode = null;
        // ...existing code for rectangle selection...
    }
    // ...existing code...
});

// Remove connection: right-click on a node while another node is selected
canvas.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let foundIdx = -1;
    let radius = 12;
    for (let i = 0; i < mesh.nodes.length; ++i) {
        const p = toScreen(mesh.nodes[i].x, mesh.nodes[i].y);
        if (Math.hypot(x - p.x, y - p.y) <= radius) {
            foundIdx = i;
            break;
        }
    }
    if (selectedNode && foundIdx !== -1 && selectedNode.id !== mesh.nodes[foundIdx].id) {
        // Try both directions for undirected mesh
        socket.emit('delete_connection', {source: selectedNode.id, target: mesh.nodes[foundIdx].id});
        socket.emit('delete_connection', {source: mesh.nodes[foundIdx].id, target: selectedNode.id});
    }
});

// Custom right-click menu
let contextMenu = null;
let contextMenuNode = null;

function createContextMenu(x, y, options) {
    // Remove any existing menu
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
    contextMenu = document.createElement('div');
    contextMenu.className = 'custom-context-menu';
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.zIndex = 10000;
    contextMenu.style.background = '#fff';
    contextMenu.style.border = '1px solid #bbb';
    contextMenu.style.borderRadius = '8px';
    contextMenu.style.boxShadow = '0 2px 12px #0002';
    contextMenu.style.padding = '6px 0';
    contextMenu.style.minWidth = '180px';
    contextMenu.style.fontSize = '1em';
    contextMenu.style.userSelect = 'none';
    options.forEach(opt => {
        const item = document.createElement('div');
        item.textContent = opt.label;
        item.style.padding = '8px 18px';
        item.style.cursor = 'pointer';
        item.onmouseenter = () => item.style.background = '#f0f7ff';
        item.onmouseleave = () => item.style.background = '';
        item.onclick = (ev) => {
            ev.stopPropagation();
            opt.action();
            if (contextMenu) {
                contextMenu.remove();
                contextMenu = null;
            }
        };
        contextMenu.appendChild(item);
    });
    document.body.appendChild(contextMenu);
    // Remove menu on click elsewhere
    setTimeout(() => {
        window.addEventListener('mousedown', removeContextMenu, { once: true });
    }, 0);
}
function removeContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
        contextMenuNode = null;
    }
}

// Right-click menu logic (replace previous contextmenu handler)
canvas.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    removeContextMenu();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let node = null;
    let radius = 12;
    for (let n of mesh.nodes) {
        const p = toScreen(n.x, n.y);
        if (Math.hypot(x - p.x, y - p.y) <= radius) {
            node = n;
            break;
        }
    }
    const menuOptions = [];
    if (node) {
        contextMenuNode = node;
        menuOptions.push({
            label: 'Auto-connect neighbors',
            action: () => autoConnectNeighbors(node)
        });
        // Optionally: add delete node or other node-specific actions here
    }
    menuOptions.push({
        label: 'Save image as PNG',
        action: () => {
            removeContextMenu();
            // Use a timeout to ensure menu is gone before saving
            setTimeout(() => {
                saveCanvasAsImage();
            }, 50);
        }
    });
    createContextMenu(e.clientX, e.clientY, menuOptions);
});

// Save canvas as PNG (fix for overlays and ensure menu is gone)
function saveCanvasAsImage() {
    // Hide context menu if still visible
    removeContextMenu();
    // Use a timeout to ensure the menu is removed from DOM before capturing
    setTimeout(() => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvas, 0, 0);
        const link = document.createElement('a');
        link.download = 'mesh.png';
        link.href = tempCanvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, 10);
}

// Auto-connect neighbors for a node
function autoConnectNeighbors(node) {
    // Find all nodes within a certain distance (e.g. 2x node radius)
    const radius = 12;
    const neighborDist = radius * 2.5 / view.scale;
    const neighbors = mesh.nodes.filter(n =>
        n.id !== node.id &&
        Math.hypot(n.x - node.x, n.y - node.y) <= neighborDist
    );
    neighbors.forEach(n => {
        // Avoid duplicate connections
        if (!mesh.connections.some(c =>
            (c.source === node.id && c.target === n.id) ||
            (c.source === n.id && c.target === node.id)
        )) {
            socket.emit('add_connection', {source: node.id, target: n.id});
        }
    });
}

// Style for custom context menu (inject only once)
(function injectContextMenuStyle() {
    if (document.getElementById('custom-context-menu-style')) return;
    const style = document.createElement('style');
    style.id = 'custom-context-menu-style';
    style.textContent = `
    .custom-context-menu {
        font-family: Arial, sans-serif;
        background: #fff;
        border: 1px solid #bbb;
        border-radius: 8px;
        box-shadow: 0 2px 12px #0002;
        padding: 6px 0;
        min-width: 180px;
        font-size: 1em;
        user-select: none;
    }
    .custom-context-menu > div {
        padding: 8px 18px;
        cursor: pointer;
        transition: background 0.15s;
    }
    .custom-context-menu > div:hover {
        background: #f0f7ff;
    }
    `;
    document.head.appendChild(style);
})();
