(function() {
    const canvas = document.getElementById('mesh-canvas');
    window.canvas = canvas; // Expose canvas globally
    const ctx = canvas.getContext('2d');

    let isPanning = false;
    let isRotating = false;
    let panStart = { x: 0, y: 0 };
    window.selectedNodes = []; // Expose selectedNodes globally
    let draggingNode = null;
    let dragOffset = { x: 0, y: 0 };
    let isDraggingGroup = false; // New flag for group dragging
    let isSelecting = false;
    let selectStart = { x: 0, y: 0 };
    let selectRect = null;
    let viewChanged = false;
    let hasDragged = false;
    let tempConnection = null; // New: To store nodes for a temporary connection line
    let lastAddedConnection = null; // New: To store the last added connection for highlighting
    let highlightedConnectionId = null; // New: To store the ID of the connection to be highlighted

    const debouncedPushStateToHistory = debounce(window.pushStateToHistory, 250);

    // New flags for selection modes
    let isCtrlSelecting = false; // For Ctrl/Cmd + drag (deselection)
    let isShiftSelecting = false; // For Shift + drag (addition)

    function getDevicePixelRatio() {
        return window.devicePixelRatio || 1;
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

    function distToSegmentSquared(p, p1, p2) {
        const l2 = (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);
        if (l2 === 0) return (p.x - p1.x) * (p.x - p1.x) + (p.y - p1.y) * (p.y - p1.y);
        let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projectionX = p1.x + t * (p2.x - p1.x);
        const projectionY = p1.y + t * (p2.y - p1.y);
        return (p.x - projectionX) * (p.x - projectionX) + (p.y - projectionY) * (p.y - projectionY);
    }

    function isPointNearLineSegment(point, p1, p2, tolerance) {
        const distance = Math.sqrt(distToSegmentSquared(point, p1, p2));
        // console.log(`  Distance to segment: ${distance}, Tolerance: ${tolerance}`);
        return distance <= tolerance;
    }

    function findConnectionsNearPoint(point, tolerance) {
        const nearbyConnectionsWithDistance = [];
        mesh.connections.forEach(c => {
            const n1 = nodesMap.get(c.source);
            const n2 = nodesMap.get(c.target);
            if (n1 && n2) {
                const p1 = toScreen(n1.x, n1.y);
                const p2 = toScreen(n2.x, n2.y);
                const distance = Math.sqrt(distToSegmentSquared(point, p1, p2));
                if (distance <= tolerance) {
                    nearbyConnectionsWithDistance.push({ connection: c, distance: distance });
                }
            }
        });
        return nearbyConnectionsWithDistance;
    }

    function getCentroid(nodeIds) {
        if (!nodeIds || nodeIds.length === 0) {
            return { x: 0, y: 0 };
        }

        let sumX = 0;
        let sumY = 0;
        nodeIds.forEach(id => {
            const node = nodesMap.get(id);
            if (node) {
                sumX += node.x;
                sumY += node.y;
            }
        });

        return { x: sumX / nodeIds.length, y: sumY / nodeIds.length };
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
        if (mesh.connections && mesh.connections.length > 0) {
            // Draw connections
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
                    if (c.id === highlightedConnectionId) {
                        ctx.strokeStyle = '#00BFFF'; // DeepSkyBlue for highlighted connection
                        ctx.lineWidth = 3;
                    } else {
                        ctx.strokeStyle = 'rgba(0, 39, 76, 0.6)';
                        ctx.lineWidth = 1;
                    }
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
            if (window.selectedNodes.includes(n)) {
                ctx.fillStyle = window.selectedNodes.length === 1 ? '#1E90FF' : '#87CEEB'; // DodgerBlue for single, SkyBlue for multiple
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

        // Highlight first selected node for connection
        if (appState.addConnectionMode && appState.firstNodeForConnection) {
            const p = toScreen(appState.firstNodeForConnection.x, appState.firstNodeForConnection.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, nodeRadius + 5, 0, 2 * Math.PI); // Draw a larger circle
            ctx.strokeStyle = '#4169E1'; // RoyalBlue color
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        if (isSelecting && selectRect) {
            ctx.strokeStyle = 'rgba(0, 191, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 2]);
            ctx.strokeRect(selectRect.x, selectRect.y, selectRect.w, selectRect.h);
            ctx.setLineDash([]);
        }

        ctx.restore();

        // Draw temporary connection line
        if (tempConnection && tempConnection.source && tempConnection.target) {
            const p1 = toScreen(tempConnection.source.x, tempConnection.source.y);
            const p2 = toScreen(tempConnection.target.x, tempConnection.target.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = '#FF00FF'; // Magenta color for temporary line
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]); // Dashed line
            ctx.stroke();
            ctx.setLineDash([]); // Reset line dash
        }

        // Highlight sets
        if (highlightedSet.name && highlightedSet.type) {
            ctx.save();
            ctx.lineWidth = 3;

            if (highlightedSet.type === 'node') {
                const nodeSet = mesh.node_sets[highlightedSet.name];
                if (nodeSet) {
                    ctx.strokeStyle = 'yellow';
                    ctx.fillStyle = 'yellow';
                    nodeSet.forEach(nodeId => {
                        const node = nodesMap.get(Number(nodeId)); // Ensure nodeId is a number
                        if (node) {
                            const p = toScreen(node.x, node.y);
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, nodeRadius + 2, 0, 2 * Math.PI);
                            ctx.fill();
                            ctx.stroke();
                        }
                    });
                }
            } else if (highlightedSet.type === 'element') {
                const elementSet = mesh.element_sets[highlightedSet.name];
                if (elementSet) {
                    ctx.strokeStyle = 'orange';
                    elementSet.forEach(elementId => {
                        const elem = mesh.elements.find(e => e.id === Number(elementId)); // Ensure elementId is a number
                        if (elem) {
                            const elementNodes = elem.node_ids.map(id => nodesMap.get(Number(id))).filter(n => n); // Ensure node IDs are numbers
                            if (elementNodes.length > 1) {
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
                                ctx.stroke();
                            }
                        }
                    });
                }
            } else if (highlightedSet.type === 'surface') {
                const surfaceSet = mesh.surface_sets[highlightedSet.name];
                if (surfaceSet) {
                    ctx.strokeStyle = 'lime'; // Green for surface sets
                    surfaceSet.forEach(surfaceElem => {
                        const elem = mesh.elements.find(e => e.id === Number(surfaceElem.element_id)); // Ensure element_id is a number
                        if (elem) {
                            const elementNodes = elem.node_ids.map(id => nodesMap.get(Number(id))).filter(n => n); // Ensure node IDs are numbers
                            if (elementNodes.length > 1) {
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
                                ctx.stroke();
                            }
                        }
                    });
                }
            }
            ctx.restore();
        }

        ctx.restore();
    }

    window.centerAndDrawMesh = function(data) { // Expose centerAndDrawMesh globally
        window.resizeCanvas();
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

        let meshWidth = maxX - minX;
        let meshHeight = maxY - minY;

        // If mesh has no extent (e.g., single node or all nodes on a line)
        // Provide a default "extent" to allow for a meaningful scale calculation
        if (meshWidth === 0) {
            meshWidth = 10; // Default width for calculation
        }
        if (meshHeight === 0) {
            meshHeight = 10; // Default height for calculation
        }

        const scaleX = rect.width / meshWidth;
        const scaleY = rect.height / meshHeight;
        let calculatedScale = Math.min(scaleX, scaleY) * 0.9; // Fit with padding

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

        if (e.button === 0) { // Left click
            // Hide the sets sidebar
            const sidebar = document.getElementById('sets-sidebar');
            if (sidebar && !sidebar.classList.contains('hidden')) {
                sidebar.classList.add('hidden');
            }
        }

        // Find clicked node regardless of button
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

        isCtrlSelecting = e.ctrlKey || e.metaKey;
        isShiftSelecting = e.shiftKey;

        if (e.button === 1) { // Middle mouse button
            if (e.shiftKey || e.ctrlKey) {
                isRotating = true;
            } else {
                isPanning = true;
            }
            panStart = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
        }
        else if (e.button === 0) { // Left click
            if (clickedNode) {
                if (appState.removeNodeMode) {
                    window.selectedNodes = [clickedNode];
                    window.deleteSelected();
                    window.selectedNodes = [];
                }
                else if (appState.addConnectionMode) {
                    if (appState.firstNodeForConnection === null) {
                        appState.firstNodeForConnection = clickedNode;
                        tempConnection = { source: clickedNode, target: null };
                        showMessage(`First node selected: ${clickedNode.id}. Click on the second node.`, 'info');
                    }
                    else {
                        if (clickedNode) {
                            const sourceId = appState.firstNodeForConnection.id;
                            const targetId = clickedNode.id;
                            if (sourceId === targetId) {
                                showMessage('Cannot connect a node to itself. Select a different node.', 'error');
                            } else {
                                const connectionExists = mesh.connections.some(conn =>
                                    (conn.source === sourceId && conn.target === targetId) ||
                                    (conn.source === targetId && conn.target === sourceId)
                                );
                                if (connectionExists) {
                                    showMessage('Connection already exists between these nodes.', 'error');
                                } else {
                                    window.lastEmittedConnection = { source: sourceId, target: targetId };
                                    socket.emit('add_connection', { source: sourceId, target: targetId });
                                    showMessage(`Connection added between ${sourceId} and ${targetId}.`, 'success');
                                }
                            }
                        }
                        appState.firstNodeForConnection = null;
                        tempConnection = null; // Also reset tempConnection
                    }
                }
                else if (appState.removeConnectionMode) { // New: Remove Connection Mode
                    console.log('Remove Connection Mode: Click position (screen):', pos);
                    const tolerance = 15; // Increased tolerance for easier clicking
                    const nearbyConnectionsWithDistance = findConnectionsNearPoint(pos, tolerance);
                    console.log('Remove Connection Mode: Nearby connections found (with distance):', nearbyConnectionsWithDistance);

                    if (nearbyConnectionsWithDistance.length > 0) {
                        // Sort by distance to find the closest one
                        nearbyConnectionsWithDistance.sort((a, b) => a.distance - b.distance);
                        const closestConnection = nearbyConnectionsWithDistance[0].connection;
                        
                        console.log('Remove Connection Mode: Deleting closest connection:', closestConnection);
                        socket.emit('delete_connection', { source: closestConnection.source, target: closestConnection.target });
                        showMessage(`Connection between ${closestConnection.source} and ${closestConnection.target} removed.`, 'success');
                        pushStateToHistory();
                    } else {
                        showMessage('No connection found near click.', 'info');
                    }
                }
                else { // Existing selection/drag logic
                    const isNodeAlreadySelected = window.selectedNodes.includes(clickedNode);
                    if (isCtrlSelecting) {
                        const index = window.selectedNodes.indexOf(clickedNode);
                        if (index > -1) {
                            window.selectedNodes.splice(index, 1);
                        } else {
                            window.selectedNodes.push(clickedNode);
                        }
                    } else if (isShiftSelecting) {
                        if (!isNodeAlreadySelected) {
                            window.selectedNodes.push(clickedNode);
                        }
                    } else {
                        if (!isNodeAlreadySelected) {
                            window.selectedNodes = [clickedNode];
                        }
                    }

                    if (window.selectedNodes.includes(clickedNode)) {
                        draggingNode = clickedNode;
                        dragOffset = { x: clickedNode.x - worldPos.x, y: clickedNode.y - worldPos.y };
                        if (window.selectedNodes.length > 1 && isNodeAlreadySelected && !isCtrlSelecting && !isShiftSelecting) {
                            isDraggingGroup = true;
                        } else {
                            isDraggingGroup = false;
                        }
                    }
                }
            } else { // Clicked on empty space
                if (appState.addNodeMode) {
                    const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
                    socket.emit('add_node', { id, x: worldPos.x, y: worldPos.y });
                    showMessage('Node added.', 'success');
                    pushStateToHistory();
                } else if (appState.addConnectionMode) {
                    appState.addConnectionMode = false;
                    appState.firstNodeForConnection = null;
                    canvas.style.cursor = 'default';
                    showMessage('Add Connection mode cancelled.', 'info');
                } else if (appState.removeNodeMode) {
                    isSelecting = true;
                    selectStart = pos;
                } else {
                    if (e.button !== 2 && !isCtrlSelecting && !isShiftSelecting) { // Only clear for left-click
                        window.selectedNodes = [];
                    }
                    isSelecting = true;
                    selectStart = pos;
                }
            }
        }
        else if (e.button === 2) { // Right click
            if (clickedNode) {
                const isNodeAlreadySelected = window.selectedNodes.includes(clickedNode);
                if (!isNodeAlreadySelected && !isShiftSelecting && !isCtrlSelecting) {
                    window.selectedNodes = [clickedNode];
                } else if (isShiftSelecting && !isNodeAlreadySelected) {
                    window.selectedNodes.push(clickedNode);
                }
            }
            isRotating = false;
            isPanning = false;
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
            if (isDraggingGroup) {
                const deltaX = (worldPos.x + dragOffset.x) - draggingNode.x;
                const deltaY = (worldPos.y + dragOffset.y) - draggingNode.y;
                const updatedNodes = [];
                window.selectedNodes.forEach(node => {
                    const newX = node.x + deltaX;
                    const newY = node.y + deltaY;
                    window.updateNodePosition(node.id, newX, newY);
                    updatedNodes.push({ id: node.id, x: newX, y: newY });
                });
                window.sendBulkNodeUpdate(updatedNodes, true, draggingNode.id); // Send bulk update during drag
            } else {
                const newX = worldPos.x + dragOffset.x;
                const newY = worldPos.y + dragOffset.y;
                window.updateNodePosition(draggingNode.id, newX, newY);
                socket.emit('update_node', { id: draggingNode.id, x: newX, y: newY, isDragging: true, draggingNodeId: draggingNode.id }); // Send single node update during drag
            }
            hasDragged = true;
        }
        else if (isSelecting) {
            selectRect = {
                x: Math.min(selectStart.x, pos.x), y: Math.min(selectStart.y, pos.y),
                w: Math.abs(pos.x - selectStart.x), h: Math.abs(pos.y - selectStart.y)
            };
        }
        else if (appState.addConnectionMode && appState.firstNodeForConnection && tempConnection) {
            const worldPos = toWorld(pos.x, pos.y);
            let snappedNode = null;
            if (spatialGrid) {
                const snapRadius = 10 / view.scale;
                const nearbyNodes = spatialGrid.queryPoint(worldPos, snapRadius);
                let minDistance = Infinity;
                for (const node of nearbyNodes) {
                    const screenPos = toScreen(node.x, node.y);
                    const distance = Math.hypot(screenPos.x - pos.x, screenPos.y - pos.y);
                    if (distance < 10 && distance < minDistance) {
                        minDistance = distance;
                        snappedNode = node;
                    }
                }
            }

            if (snappedNode) {
                tempConnection.target = snappedNode;
            } else {
                tempConnection.target = toWorld(pos.x, pos.y);
            }
        }
        scheduleDrawMesh();
    }, 16));

    window.addEventListener('mouseup', e => {
        const wasDragging = draggingNode || isDraggingGroup;
        const wasSelecting = isSelecting && selectRect;

        if (hasDragged) {
            window.pushStateToHistory();
            
            // Send final positions to the server after drag ends
            if (isDraggingGroup) {
                const updatedNodes = window.selectedNodes.map(node => ({ id: node.id, x: node.x, y: node.y }));
                window.sendBulkNodeUpdate(updatedNodes, false, null); // Final update, not dragging anymore
            } else if (draggingNode) {
                socket.emit('update_node', { id: draggingNode.id, x: draggingNode.x, y: draggingNode.y, isDragging: false, draggingNodeId: null });
            }
            hasDragged = false;
        }

        if (wasSelecting) {
            const p1 = toWorld(selectRect.x, selectRect.y);
            const p2 = toWorld(selectRect.x + selectRect.w, selectRect.y);
            const p3 = toWorld(selectRect.x, selectRect.y + selectRect.h);
            const p4 = toWorld(selectRect.x + selectRect.w, selectRect.y + selectRect.h);
            const minWorldX = Math.min(p1.x, p2.x, p3.x, p4.x);
            const maxWorldX = Math.max(p1.x, p2.x, p3.x, p4.x);
            const minWorldY = Math.min(p1.y, p2.y, p3.y, p4.y);
            const maxWorldY = Math.max(p1.y, p2.y, p3.y, p4.y);
            const queryMin = [minWorldX, minWorldY];
            const queryMax = [maxWorldX, maxWorldY];
            const nodesInRectCandidate = spatialGrid ? spatialGrid.query({ min: queryMin, max: queryMax }) : [];
            let nodesInRect = [];
            nodesInRectCandidate.forEach(node => {
                const screenPos = toScreen(node.x, node.y);
                if (screenPos.x >= selectRect.x && screenPos.x <= (selectRect.x + selectRect.w) &&
                    screenPos.y >= selectRect.y && screenPos.y <= (selectRect.y + selectRect.h)) {
                    nodesInRect.push(node);
                }
            });
            if (appState.removeNodeMode) { // New: If in remove node mode, delete selected nodes
                if (nodesInRect.length > 0) {
                    window.selectedNodes = nodesInRect; // Temporarily set window.selectedNodes for deleteSelected
                    window.deleteSelected();
                    window.selectedNodes = []; // Clear selection after deletion
                }
            } else if (isCtrlSelecting) {
                const currentSelection = new Set(window.selectedNodes);
                nodesInRect.forEach(node => { currentSelection.delete(node); });
                window.selectedNodes = Array.from(currentSelection);
            } else if (isShiftSelecting) {
                const currentSelection = new Set(window.selectedNodes);
                nodesInRect.forEach(node => { currentSelection.add(node); });
                window.selectedNodes = Array.from(currentSelection);
            } else {
                window.selectedNodes = nodesInRect;
            }
            console.log('mouseup: selectedNodes after selection rectangle:', window.selectedNodes.map(n => n.id));
        }

        // Reset all state
        draggingNode = null;
        isPanning = false;
        isRotating = false;
        isSelecting = false;
        isDraggingGroup = false;
        selectRect = null;
        canvas.style.cursor = 'crosshair';
        isCtrlSelecting = false;
        isShiftSelecting = false;

        if (e.button === 2 && !wasDragging && !wasSelecting) { // Show context menu only on simple right click
            console.log('mouseup: Before showing context menu, selectedNodes:', window.selectedNodes.map(n => n.id));
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
        view.offsetX += pos.x - newScreenPos.x;
        view.offsetY += pos.y - newScreenPos.y;
        debouncedPushStateToHistory(); // Record zoom in history
        scheduleDrawMesh();
    }, { passive: false });

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault(); // Prevent default browser context menu
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Delete' || e.key === 'Backspace') { // Check for Delete or Backspace key
            if (window.selectedNodes.length > 0) {
                e.preventDefault(); // Prevent default browser behavior (e.g., navigating back)
                window.deleteSelected(); // Call the delete function
            }
        } else if (e.key === 'Enter') { // Check for Enter key
            if (appState.isEditingMode) {
                e.preventDefault(); // Prevent default browser behavior
                appState.addNodeMode = false;
                appState.addConnectionMode = false;
                appState.removeNodeMode = false; // New: Exit remove node mode
                appState.removeConnectionMode = false; // Fix: Exit remove connection mode
                appState.firstNodeForConnection = null;
                appState.isEditingMode = false;
                
                // Update the UI to remove the indicator
                if(window.updateEditModeIndicator) {
                    window.updateEditModeIndicator();
                }
            }
        }
    });

    // Expose functions to the global scope
    window.scheduleDrawMesh = scheduleDrawMesh; // scheduleDrawMesh needs to be global for app.js
    
    window.setHighlightedConnection = function(connectionId) {
        highlightedConnectionId = connectionId;
        scheduleDrawMesh();
    };

    window.updateNodePosition = function(nodeId, newX, newY) {
        const node = nodesMap.get(nodeId);
        if (node) {
            node.x = newX;
            node.y = newY;
            // Update spatial grid for the moved node
            if (spatialGrid) {
                spatialGrid.remove(node);
                spatialGrid.insert(node);
            }
        }
    };

    let highlightedSet = { name: null, type: null }; // Global variable to store the currently highlighted set

    window.highlightSet = function(name, type) {
        if (highlightedSet.name === name && highlightedSet.type === type) {
            // If the same set is clicked again, unhighlight it
            highlightedSet = { name: null, type: null };
        } else {
            highlightedSet = { name: name, type: type };
        }
        scheduleDrawMesh();
    };
})();