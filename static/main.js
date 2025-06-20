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
            ctx.fillText(x.toFixed(1), sx - 10, y0 - 12);
            ctx.fillText(x.toFixed(1), sx - 10, yB + 22);
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
            ctx.fillText(y.toFixed(1), 2, sy + 4);
            ctx.fillText(y.toFixed(1), canvasW - rulerSize + 10, sy + 4);
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
    if (meshLoaded) {
        socket.emit('get_mesh');
        showMessage('Mesh displayed.','#080');
        meshLoaded = null;
    } else {
        showMessage('Please load a mesh first.');
    }
}

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
}

// Pan, zoom, select, and zoom-rect events
canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.button === 0) { // Left mouse
        // Node selection
        let found = false;
        for (let n of mesh.nodes) {
            const p = toScreen(n.x, n.y);
            let radius = 12;
            if (mesh.nodes.length > 1) {
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
            }
            if (Math.hypot(x - p.x, y - p.y) <= radius) {
                selectedNode = n;
                selectedConnection = null;
                drawMesh();
                found = true;
                break;
            }
        }
        if (!found) {
            selectedNode = null;
            // Connection selection
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
        }
        e.preventDefault();
    } else if (e.button === 1) { // Middle mouse: zoom
        isZooming = true;
        zoomStart.y = e.clientY;
        zoomStart.scale = view.scale;
        zoomStart.mouseX = x;
        zoomStart.mouseY = y;
        canvas.style.cursor = 'ns-resize';
        e.preventDefault();
    } else if (e.button === 2) { // Right mouse: pan
        isPanning = true;
        panStart.x = e.clientX;
        panStart.y = e.clientY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    }
});
window.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (isSelecting) {
        selectRect = {
            x: Math.min(selectStart.x, x),
            y: Math.min(selectStart.y, y),
            w: Math.abs(x - selectStart.x),
            h: Math.abs(y - selectStart.y)
        };
        drawMesh();
        // Draw selection rectangle
        const ctx = canvas.getContext('2d');
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
    if (isSelecting) {
        isSelecting = false;
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

// Improved draggable logic for zoom-controls (allow margin outside canvas)
(function() {
    const controls = document.getElementById('zoom-controls');
    const canvas = document.getElementById('mesh-canvas');
    let dragging = false;
    let dragOffset = {x: 0, y: 0};
    const margin = 60;
    controls.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return; // Only left mouse
        if (e.target.closest('button')) return;
        dragging = true;
        controls.style.cursor = 'grabbing';
        const rect = controls.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        const canvasRect = canvas.getBoundingClientRect();
        let newLeft = e.clientX - canvasRect.left - dragOffset.x;
        let newTop = e.clientY - canvasRect.top - dragOffset.y;
        // Clamp within canvas + margin
        newLeft = Math.max(-margin, Math.min(newLeft, canvas.width - controls.offsetWidth + margin));
        newTop = Math.max(-margin, Math.min(newTop, canvas.height - controls.offsetHeight + margin));
        controls.style.left = newLeft + 'px';
        controls.style.top = newTop + 'px';
        controls.style.right = '';
    });
    window.addEventListener('mouseup', function() {
        dragging = false;
        controls.style.cursor = '';
    });
})();
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
