(function() {
    const canvas = document.getElementById('mesh-canvas');
    window.canvas = canvas; // Expose canvas globally
    const ctx = canvas.getContext('2d');

    let isPanning = false;
    let isRotating = false;
    let panStart = { x: 0, y: 0 };
    let selectedNodes = [];
    window.selectedNodes = selectedNodes; // Expose selectedNodes globally
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
                    if (c.id === highlightedConnectionId) {
                        ctx.strokeStyle = '#FFFF00'; // Yellow for highlighted connection
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

        // Highlight first selected node for connection
        if (appState.addConnectionMode && appState.firstNodeForConnection) {
            const p = toScreen(appState.firstNodeForConnection.x, appState.firstNodeForConnection.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, nodeRadius + 5, 0, 2 * Math.PI); // Draw a larger circle
            ctx.strokeStyle = '#FFD700'; // Gold color
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        if (isSelecting && selectRect) {
            ctx.strokeStyle = 'rgba(255, 203, 5, 0.8)';
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
                if (appState.removeNodeMode) { // New: Remove Node Mode
                    window.selectedNodes = [clickedNode]; // Select the clicked node
                    window.deleteSelected(); // Immediately delete it
                    window.selectedNodes = []; // Clear selection after deletion
                } 
                else if (appState.addConnectionMode) {
                    if (appState.firstNodeForConnection === null) {
                        appState.firstNodeForConnection = clickedNode;
                        tempConnection = { source: clickedNode, target: null }; // Initialize tempConnection
                        showMessage(`First node selected: ${clickedNode.id}. Click on the second node.`, 'info');
                    } 
                    else {
                        const sourceId = appState.firstNodeForConnection.id;
                        const targetId = clickedNode.id;

                        if (sourceId === targetId) {
                            showMessage('Cannot connect a node to itself. Select a different node.', 'error');
                        } else {
                            // Check for existing connection (both directions)
                            const connectionExists = mesh.connections.some(conn =>
                                (conn.source === sourceId && conn.target === targetId) ||
                                (conn.source === targetId && conn.target === sourceId)
                            );

                            if (connectionExists) {
                                showMessage('Connection already exists between these nodes.', 'error');
                            } else {
                                window.lastEmittedConnection = { source: sourceId, target: targetId }; // Store for highlighting
                                socket.emit('add_connection', { source: sourceId, target: targetId });
                                showMessage(`Connection added between ${sourceId} and ${targetId}.`, 'success');
                            }
                        }
                        // appState.addConnectionMode = false; // Keep mode active for multiple connections
                        appState.firstNodeForConnection = null; // Clear first node
                        // canvas.style.cursor = 'default'; // Keep cursor as crosshair in add connection mode
                    }
                } 
                else  { // Existing selection/drag logic
                    const isNodeAlreadySelected = selectedNodes.includes(clickedNode);

                    if (isCtrlSelecting) { // Ctrl/Cmd click to toggle selection
                        const index = selectedNodes.indexOf(clickedNode);
                        if (index > -1) {
                            selectedNodes.splice(index, 1); // Remove if already selected
                        } else {
                            selectedNodes.push(clickedNode); // Add if not selected
                        }
                    } else if (isShiftSelecting) { // Shift click to add to selection
                        if (!isNodeAlreadySelected) {
                            selectedNodes.push(clickedNode);
                        }
                    } else { // No modifier key
                        if (!isNodeAlreadySelected) { // If clicked node is not selected, clear selection and select it
                            selectedNodes = [clickedNode];
                        }
                        // If clicked node is already selected, we assume the user wants to drag the group
                        // No change to selectedNodes, proceed to dragging logic
                    }

                    if (selectedNodes.includes(clickedNode)) { // If the clicked node is now part of the selection (either single or group)
                        draggingNode = clickedNode; // The node that initiated the drag
                        dragOffset = { x: clickedNode.x - worldPos.x, y: clickedNode.y - worldPos.y };
                        if (selectedNodes.length > 1 && isNodeAlreadySelected && !isCtrlSelecting && !isShiftSelecting) {
                            isDraggingGroup = true; // Flag for group drag
                        } else {
                            isDraggingGroup = false; // Single node drag
                        }
                    }
                }
                // else { // Clicked node was deselected by Ctrl/Cmd click, no drag
                //     draggingNode = null;
                //     isDraggingGroup = false;
                // }
            } else { // Clicked on empty space
                if (appState.addNodeMode) {
                    const id = mesh.nodes.length ? Math.max(...mesh.nodes.map(n => n.id)) + 1 : 1;
                    socket.emit('add_node', { id, x: worldPos.x, y: worldPos.y });
                    showMessage('Node added.', 'success');
                    pushStateToHistory();
                } else if (appState.addConnectionMode) { // If in add connection mode and clicked empty space, cancel
                    appState.addConnectionMode = false;
                    appState.firstNodeForConnection = null;
                    canvas.style.cursor = 'default';
                    showMessage('Add Connection mode cancelled.', 'info');
                } else if (appState.removeNodeMode) { // New: Start rect select for removal
                    isSelecting = true;
                    selectStart = pos;
                } else { // Start rect select if not in any special mode
                    if (!isCtrlSelecting && !isShiftSelecting) {
                        selectedNodes = []; // Clear selection on empty click if no modifier
                    }
                    isSelecting = true;
                    selectStart = pos;
                }
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
                selectedNodes.forEach(node => {
                    const newX = node.x + deltaX;
                    const newY = node.y + deltaY;
                    window.updateNodePosition(node.id, newX, newY); // Update local state only
                });
            } else {
                const newX = worldPos.x + dragOffset.x;
                const newY = worldPos.y + dragOffset.y;
                window.updateNodePosition(draggingNode.id, newX, newY); // Update local state only
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
            tempConnection.target = toWorld(pos.x, pos.y);
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
                const updatedNodes = selectedNodes.map(node => ({ id: node.id, x: node.x, y: node.y }));
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
                    window.selectedNodes = nodesInRect; // Temporarily set selectedNodes for deleteSelected
                    window.deleteSelected();
                    window.selectedNodes = []; // Clear selection after deletion
                }
            } else if (isCtrlSelecting) {
                const currentSelection = new Set(selectedNodes);
                nodesInRect.forEach(node => { currentSelection.delete(node); });
                selectedNodes = Array.from(currentSelection);
            } else if (isShiftSelecting) {
                const currentSelection = new Set(selectedNodes);
                nodesInRect.forEach(node => { currentSelection.add(node); });
                selectedNodes = Array.from(currentSelection);
            } else {
                selectedNodes = nodesInRect;
            }
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
            if (selectedNodes.length > 0) {
                e.preventDefault(); // Prevent default browser behavior (e.g., navigating back)
                window.deleteSelected(); // Call the delete function
            }
        } else if (e.key === 'Enter') { // Check for Enter key
            if (appState.isEditingMode) {
                e.preventDefault(); // Prevent default browser behavior
                                appState.addNodeMode = false;
                appState.addConnectionMode = false;
                appState.removeNodeMode = false; // New: Exit remove node mode
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
    window.centerAndDrawMesh = centerAndDrawMesh; // Expose centerAndDrawMesh globally
    window.setHighlightedConnection = function(connectionId) {
        highlightedConnectionId = connectionId;
        scheduleDrawMesh();
    };
})();
