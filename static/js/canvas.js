(function() {
    const canvas = document.getElementById('mesh-canvas');
    const ctx = canvas.getContext('2d');

    let isPanning = false;
    let isRotating = false;
    let panStart = { x: 0, y: 0 };
    let selectedNodes = [];
    let draggingNode = null;
    let dragOffset = { x: 0, y: 0 };
    let isSelecting = false;
    let selectStart = { x: 0, y: 0 };
    let selectRect = null;
    let viewChanged = false;
    let hasDragged = false;

    const debouncedPushStateToHistory = debounce(window.pushStateToHistory, 250);

    // New flags for selection modes
    let isCtrlSelecting = false; // For Ctrl/Cmd + drag (deselection)
    let isShiftSelecting = false; // For Shift + drag (addition)

    function getDevicePixelRatio() {
        return window.devicePixelRatio || 1;
    }

    window.resizeCanvas = function() {
        const dpr = getDevicePixelRatio();
        const rect = canvas.getBoundingClientRect();
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.resetTransform();
            ctx.scale(dpr, dpr);
        }
        _scheduleDrawMeshInternal();
    }

    function _scheduleDrawMeshInternal() {
        
        // Ensure drawPending is reset if it somehow got stuck
        if (view.drawPending) {
            
            view.drawPending = false; // Force reset for debugging
        }

        if (!view.drawPending) {
            view.drawPending = true;
            window.requestAnimationFrame(() => {
                drawMesh();
                view.drawPending = false;
                
            });
        } else {
            console.log("_scheduleDrawMeshInternal: Already pending, skipping redraw.");
        }
    }

    const scheduleDrawMesh = throttle(_scheduleDrawMeshInternal, 16);

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

    window.rotateView = function(angle) { // Exposed globally
        const rect = canvas.getBoundingClientRect();
        const centerScreen = { x: rect.width / 2, y: rect.height / 2 };
        const centerWorldOld = toWorld(centerScreen.x, centerScreen.y);

        view.rotation += angle;

        const centerWorldNewScreen = toScreen(centerWorldOld.x, centerWorldOld.y);
        
        view.offsetX += centerScreen.x - centerWorldNewScreen.x;
        view.offsetY += centerScreen.y - centerWorldNewScreen.y;
        debouncedPushStateToHistory(); // Record rotation in history
        scheduleDrawMesh();
    }

    window.drawMesh = function() { // Expose drawMesh globally
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);

        ctx.save();

        const viewBounds = { min: toWorld(0, 0), max: toWorld(rect.width, rect.height) };
        const queryBounds = {
            min: [Math.min(viewBounds.min.x, viewBounds.max.x), Math.min(viewBounds.min.y, viewBounds.max.y)],
            max: [Math.max(viewBounds.min.x, viewBounds.max.x), Math.max(viewBounds.min.y, viewBounds.max.y)]
        };
        
        const visibleNodes = spatialGrid ? spatialGrid.query(queryBounds) : [];

        if (mesh.elements && mesh.elements.length > 0) {
            // Draw elements and their labels
            mesh.elements.forEach(elem => {
                const elementNodes = elem.node_ids.map(id => nodesMap.get(id)).filter(n => n);
                if (elementNodes.length > 1) {

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

                    if (elementNodes.length > 2) {
                        ctx.closePath();
                        ctx.strokeStyle = 'rgba(0, 39, 76, 0.6)';
                        ctx.lineWidth = 1;
                    } else {
                        ctx.strokeStyle = 'red';
                        ctx.lineWidth = 2;
                    }
                    ctx.stroke();

                    // Draw label
                    if (document.getElementById('show-element-labels-checkbox').checked && view.scale >= lod.labelThreshold) {
                        const centroid = getCentroid(elem.node_ids);
                        const pCentroid = toScreen(centroid.x, centroid.y);

                        if (elementNodes.length === 2) {
                            ctx.fillStyle = 'green';
                            ctx.font = 'bold 10px sans-serif';
                        }
                        else {
                            ctx.fillStyle = 'purple';
                            ctx.font = 'italic 10px sans-serif';
                        }
                        ctx.fillText(`E${elem.id}`, pCentroid.x, pCentroid.y);
                    }
                }
            });
            // Reset font after the loop
            if (document.getElementById('show-element-labels-checkbox').checked && view.scale >= lod.labelThreshold) {
                ctx.font = '10px sans-serif'; // Reset font
            }
        }
        else if (mesh.connections && mesh.connections.length > 0) {
            // Draw connections if no elements are present
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
        }

        // Draw nodes
        const nodeRadius = view.scale < lod.nodeThreshold ? 0.5 : 3;
        const showNodeLabels = view.scale >= lod.labelThreshold && document.getElementById('show-node-labels-checkbox').checked;

        visibleNodes.forEach(n => {
            const p = toScreen(n.x, n.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI);
            
            // Set fill style based on selection
            if (selectedNodes.includes(n)) {
                ctx.fillStyle = selectedNodes.length === 1 ? '#00FF00' : '#00FFFF'; // Lime green for single, Cyan for multiple
            }
            else {
                ctx.fillStyle = 'rgba(0, 39, 76, 0.4)'; // Default color
            }
            ctx.fill();

            if (showNodeLabels) {
                ctx.fillStyle = 'black';
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

    window.centerAndDrawMesh = function(data) { // Expose centerAndDrawMesh globally
        if (!data.nodes || !data.nodes.length) return;
        const rect = canvas.getBoundingClientRect();

        const cosR = Math.cos(view.rotation);
        const sinR = Math.sin(view.rotation);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        const rotatedNodes = data.nodes.map(n => {
            return {
                x: n.x * cosR - n.y * sinR,
                y: n.x * sinR + n.y * cosR
            };
        });

        rotatedNodes.forEach(n => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y);
        });

        const meshWidth = maxX - minX;
        const meshHeight = maxY - minY;

        let calculatedScale;
        if (meshWidth === 0 || meshHeight === 0) {
            calculatedScale = 1; // Default scale if mesh has no extent
        }
        else {
            const scaleX = rect.width / meshWidth;
            const scaleY = rect.height / meshHeight;
            calculatedScale = Math.min(scaleX, scaleY) * 0.9; // Fit with padding
        }

        // Introduce limits for the initial calculated scale to prevent extreme values
        const minAllowedInitialScale = 0.1; // Example: Don't go below 0.1 pixels per unit
        const maxAllowedInitialScale = 100; // Example: Don't go above 100 pixels per unit

        view.scale = Math.max(minAllowedInitialScale, Math.min(calculatedScale, maxAllowedInitialScale));

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        view.offsetX = rect.width / 2 - centerX * view.scale;
        view.offsetY = rect.height / 2 - centerY * view.scale;
        debouncedPushStateToHistory(); // Record home view in history
        scheduleDrawMesh();
    }

    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }


    document.addEventListener('DOMContentLoaded', () => {
        const resizeObserver = new ResizeObserver(window.resizeCanvas); // Use window.resizeCanvas now that it's global
        resizeObserver.observe(canvas);
    });

    canvas.addEventListener('mousedown', e => {
        const pos = getMousePos(e);
        hasDragged = false;

        if (e.button === 1) { // Middle mouse button
            if (e.shiftKey || e.ctrlKey) {
                isRotating = true;
            }
            else {
                isPanning = true;
            }
            panStart = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
        }
        else if (e.button === 0) { // Left click
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
            
            // Reset selection flags
            isCtrlSelecting = e.ctrlKey || e.metaKey;
            isShiftSelecting = e.shiftKey;

            if (clickedNode) {
                if (isCtrlSelecting) { // Ctrl/Cmd click to toggle selection
                    const index = selectedNodes.indexOf(clickedNode);
                    if (index > -1) {
                        selectedNodes.splice(index, 1); // Remove if already selected
                    } else {
                        selectedNodes.push(clickedNode); // Add if not selected
                    }
                } else if (isShiftSelecting) { // Shift click to add to selection
                    // For now, just add. Range selection is more complex. This will be handled in mouseup for rect select.
                    if (!selectedNodes.includes(clickedNode)) {
                        selectedNodes.push(clickedNode);
                    }
                } else { // Single click to select only this node
                    selectedNodes = [clickedNode];
                }
                draggingNode = clickedNode; // Allow dragging of the clicked node
                dragOffset = { x: clickedNode.x - worldPos.x, y: clickedNode.y - worldPos.y };
            } else { // Clicked on empty space, start rect select
                if (!isCtrlSelecting && !isShiftSelecting) {
                    selectedNodes = []; // Clear selection on empty click if no modifier
                }
                isSelecting = true;
                selectStart = pos;
            }
        }
        else if (e.button === 2) { // Right click
            // No drag detection here, context menu will be shown on mouseup if not dragging
            isRotating = false; // Ensure rotation is off for context menu click
            isPanning = false; // Ensure panning is off
        }
        scheduleDrawMesh();
    });

    canvas.addEventListener('mousemove', throttle(e => {
        const pos = getMousePos(e);

        if (isPanning) {
            view.offsetX += e.movementX;
            view.offsetY += e.movementY;
            viewChanged = true;
            hasDragged = true;
            // console.log("Current view.scale:", view.scale);
        }
        else if (isRotating) {
            const dx = e.clientX - panStart.x;
            view.rotation += dx * 0.01;
            panStart = { x: e.clientX, y: e.clientY };
            viewChanged = true;
            hasDragged = true;
        }
        else if (draggingNode) {
            const worldPos = toWorld(pos.x, pos.y);
            const newX = worldPos.x + dragOffset.x;
            const newY = worldPos.y + dragOffset.y;
            window.updateNodePosition(draggingNode.id, newX, newY);
            socket.emit('update_node', { id: draggingNode.id, x: newX, y: newY, isDragging: true, draggingNodeId: draggingNode.id });
            hasDragged = true;
        }
        else if (isSelecting) {
            selectRect = {
                x: Math.min(selectStart.x, pos.x), y: Math.min(selectStart.y, pos.y),
                w: Math.abs(pos.x - selectStart.x), h: Math.abs(pos.y - selectStart.y)
            };
        }
        scheduleDrawMesh();
    }, 16));

    window.addEventListener('mouseup', e => {
        if (hasDragged) {
            window.pushStateToHistory();
            hasDragged = false;
        }
        if (isSelecting && selectRect) { // Only process if a selection rectangle was drawn
            // Transform all four corners of the screen selectRect to world coordinates
            const p1 = toWorld(selectRect.x, selectRect.y);
            const p2 = toWorld(selectRect.x + selectRect.w, selectRect.y);
            const p3 = toWorld(selectRect.x, selectRect.y + selectRect.h);
            const p4 = toWorld(selectRect.x + selectRect.w, selectRect.y + selectRect.h);

            // Calculate the true min/max world coordinates from these four transformed corners
            const minWorldX = Math.min(p1.x, p2.x, p3.x, p4.x);
            const maxWorldX = Math.max(p1.x, p2.x, p3.x, p4.x);
            const minWorldY = Math.min(p1.y, p2.y, p3.y, p4.y);
            const maxWorldY = Math.max(p1.y, p2.y, p3.y, p4.y);

            const queryMin = [minWorldX, minWorldY];
            const queryMax = [maxWorldX, maxWorldY];

            const nodesInRectCandidate = spatialGrid ? spatialGrid.query({ min: queryMin, max: queryMax }) : [];
            let nodesInRect = [];

            // Perform a precise check to ensure nodes are actually within the screen-drawn selectRect
            nodesInRectCandidate.forEach(node => {
                const screenPos = toScreen(node.x, node.y);
                if (screenPos.x >= selectRect.x && screenPos.x <= (selectRect.x + selectRect.w) &&
                    screenPos.y >= selectRect.y && screenPos.y <= (selectRect.y + selectRect.h)) {
                    nodesInRect.push(node);
                }
            });

            // Apply selection based on modifier keys
            if (isCtrlSelecting) { // Ctrl/Cmd drag for deselection
                const currentSelection = new Set(selectedNodes);
                nodesInRect.forEach(node => {
                    currentSelection.delete(node);
                });
                selectedNodes = Array.from(currentSelection);
            } else if (isShiftSelecting) { // Shift drag for addition
                const currentSelection = new Set(selectedNodes);
                nodesInRect.forEach(node => {
                    currentSelection.add(node);
                });
                selectedNodes = Array.from(currentSelection);
            } else { // Regular rect select, replace current selection
                selectedNodes = nodesInRect;
            }
        }
        draggingNode = null;
        isPanning = false;
        isRotating = false;
        isSelecting = false;
        selectRect = null;
        canvas.style.cursor = 'crosshair';

        // Clear selection flags
        isCtrlSelecting = false;
        isShiftSelecting = false;

        if (e.button === 2) { // Right click released
            showContextMenu(e);
        }
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
        debouncedPushStateToHistory(); // Record zoom in history
        scheduleDrawMesh();
    }, { passive: false });

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault(); // Prevent default browser context menu
    });

    // Expose functions to the global scope
    window.scheduleDrawMesh = scheduleDrawMesh; // scheduleDrawMesh needs to be global for app.js
})();