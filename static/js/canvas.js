const canvas = document.getElementById('mesh-canvas');
const ctx = canvas.getContext('2d');

function getDevicePixelRatio() {
    return window.devicePixelRatio || 1;
}

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
    const cosR = Math.cos(view.rotation), sinR = Math.sin(view.rotation);
    return {
        x: (x * cosR - y * sinR) * view.scale + view.offsetX,
        y: (x * sinR + y * cosR) * view.scale + view.offsetY
    };
}

function toWorld(x, y) {
    const sx = (x - view.offsetX) / view.scale;
    const sy = (y - view.offsetY) / view.scale;
    const cosR = Math.cos(-view.rotation), sinR = Math.sin(-view.rotation);
    return { x: sx * cosR - sy * sinR, y: sx * sinR + sy * cosR };
}

function getCentroid(node_ids) {
    let centerX = 0;
    let centerY = 0;
    const numNodes = node_ids.length;

    node_ids.forEach(nodeId => {
        const node = nodesMap.get(nodeId);
        if (node) {
            centerX += node.x;
            centerY += node.y;
        }
    });

    return { x: centerX / numNodes, y: centerY / numNodes };
}

function drawMesh() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();

    const viewBounds = { min: toWorld(0, 0), max: toWorld(rect.width, rect.height) };
    const queryBounds = {
        min: [Math.min(viewBounds.min.x, viewBounds.max.x), Math.min(viewBounds.min.y, viewBounds.max.y)],
        max: [Math.max(viewBounds.min.x, viewBounds.max.x), Math.max(viewBounds.min.y, viewBounds.max.y)]
    };
    
    const visibleNodes = spatialGrid ? spatialGrid.query(queryBounds) : [];

    // Draw connections (from explicit connections)
    mesh.connections.forEach(c => {
        const n1 = nodesMap.get(c.source);
        const n2 = nodesMap.get(c.target);
        if (n1 && n2) {
            const p1 = toScreen(n1.x, n1.y), p2 = toScreen(n2.x, n2.y);
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (dist < 1) return;

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = 'rgba(0, 39, 76, 0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    });

    // Draw connections (from elements) and element labels
    if (document.getElementById('show-element-labels-checkbox').checked && view.scale >= lod.labelThreshold) {
        ctx.fillStyle = '#000'; // Black color for labels
        mesh.elements.forEach(elem => { // Iterate through elements
            const elementNodes = elem.node_ids.map(id => nodesMap.get(id)).filter(n => n);
            if (elementNodes.length > 0) {
                // Calculate centroid
                const centroid = getCentroid(elem.node_ids);
                const pCentroid = toScreen(centroid.x, centroid.y);
                ctx.fillText(elem.id.toString(), pCentroid.x, pCentroid.y);

                // Draw edges of the element
                ctx.beginPath();
                elementNodes.forEach((node, i) => {
                    const p = toScreen(node.x, node.y);
                    if (i === 0) {
                        ctx.moveTo(p.x, p.y);
                    } else {
                        ctx.lineTo(p.x, p.y);
                    }
                });
                ctx.closePath();
                ctx.strokeStyle = 'rgba(0, 39, 76, 0.6)'; // Same color as other connections
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        });
    }

    // Draw nodes
    const nodeRadius = view.scale < lod.nodeThreshold ? 0.5 : 3;
    const showNodeLabels = view.scale >= lod.labelThreshold && document.getElementById('show-node-labels-checkbox').checked;

    visibleNodes.forEach(n => {
        const p = toScreen(n.x, n.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = (selectedNode && selectedNode.id === n.id) ? '#FFCB05' : '#00274C';
        ctx.fill();
        if (showNodeLabels) {
            ctx.fillStyle = '#000';
            ctx.fillText(n.id, p.x + nodeRadius + 2, p.y);
        }
    });

    if (isSelecting && selectRect) {
        ctx.strokeStyle = 'rgba(255, 203, 5, 0.8)';
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
    const scaleX = rect.width / meshWidth;
    const scaleY = rect.height / meshHeight;
    view.scale = Math.min(scaleX, scaleY) * 0.9;

    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    view.offsetX = -centerX * view.scale + rect.width / 2;
    view.offsetY = -centerY * view.scale + rect.height / 2;

    scheduleDrawMesh();
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}


const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);

canvas.addEventListener('mousedown', e => {
    const pos = getMousePos(e);

    if (e.button === 1) { // Middle mouse button
        if (e.shiftKey || e.ctrlKey) {
            isRotating = true;
        } else {
            isPanning = true;
        }
        panStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    } else if (e.button === 0) { // Left click
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
    }
    scheduleDrawMesh();
});

canvas.addEventListener('mousemove', throttle(e => {
    const pos = getMousePos(e);

    if (isPanning) {
        view.offsetX += e.movementX;
        view.offsetY += e.movementY;
    } else if (isRotating) {
        const dx = e.clientX - panStart.x;
        view.rotation += dx * 0.01;
        panStart = { x: e.clientX, y: e.clientY };
    } else if (draggingNode) {
        const worldPos = toWorld(pos.x, pos.y);
        const newX = worldPos.x + dragOffset.x, newY = worldPos.y + dragOffset.y;
        socket.emit('update_node', { id: draggingNode.id, x: newX, y: newY });
    } else if (isSelecting) {
        selectRect = {
            x: Math.min(selectStart.x, pos.x), y: Math.min(selectStart.y, pos.y),
            w: Math.abs(pos.x - selectStart.x), h: Math.abs(pos.y - selectStart.y)
        };
    }
    scheduleDrawMesh();
}, 16));

window.addEventListener('mouseup', e => {
    if (isSelecting && selectRect && (selectRect.w > 10 || selectRect.h > 10)) {
        // Logic for selecting nodes in rect will be added later
    }
    draggingNode = null;
    isPanning = false;
    isRotating = false;
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

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e);
});