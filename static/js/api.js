function uploadMesh() {
    const fileInput = document.getElementById('mesh-file');
    if (!fileInput.files.length) return showMessage('Please select a file first.', 'error');
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    fetch('/load', { method: 'POST', body: formData })
        .then(response => {
            if (response.ok) {
                showMessage('Mesh loaded successfully.', 'success');
                appState.meshLoaded = true; // Set to true on successful upload
                appState.meshDisplayed = false; // Not yet displayed
                showMesh();
            } else {
                response.text().then(text => showMessage(`Error: ${text}`, 'error'));
                appState.meshLoaded = false; // Set to false on failed upload
            }
        })
        .catch(err => {
            showMessage(`Upload error: ${err}`, 'error');
            appState.meshLoaded = false; // Set to false on upload error
        });
}
window.uploadMesh = uploadMesh;

function showMesh() {
    if (!appState.meshLoaded) return showMessage('Please load a mesh file first.', 'error');
    if (appState.meshDisplayed) return showMessage('Mesh is already displayed.', 'info');

    fetch('/last_mesh').then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }).then(data => {
        if (data.nodes && data.nodes.length > 0) {
            appState.isNewImport = true; // Set flag for recentering
            socket.emit('get_mesh');
            showMessage('Mesh displayed.', 'success');
            appState.meshDisplayed = true; // Set to true when mesh is displayed
        } else {
            showMessage('Loaded mesh has no nodes to display.', 'error');
            appState.meshDisplayed = false; // Set to false if no nodes
        }
    }).catch(err => {
        showMessage(`Failed to retrieve mesh data from server: ${err.message}`, 'error');
        appState.meshDisplayed = false; // Set to false on fetch error
    });
}
window.showMesh = showMesh;

function clearMesh() {
    if (!appState.meshDisplayed) return showMessage('There is no mesh to clear.', 'error');
    
    // Push the current state to history before clearing
    if (historyManager) {
        historyManager.pushState();
    }

    socket.emit('clear_mesh');
    appState.meshLoaded = false; // Reset state on clear
    appState.meshDisplayed = false; // Reset state on clear
}
window.clearMesh = clearMesh;

async function exportMesh() {
    if (!appState.meshDisplayed) return showMessage('Please load and show a mesh before exporting.', 'error');

    let fileHandle = null;
    if (window.showSaveFilePicker) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'mesh.deck',
                types: [{
                    description: 'Deck Files',
                    accept: { 'text/plain': ['.deck', '.inp'] },
                }],
            });
        } catch (err) {
            if (err.name === 'AbortError') {
                showMessage('Export cancelled.', 'info');
                return;
            }
            console.error(err.name, err.message);
            showMessage('Error opening save file dialog.', 'error');
            return;
        }
    } else {
        // Fallback for older browsers, will trigger direct download
        showMessage('Your browser does not support advanced file saving. File will download directly.', 'info');
    }

    fetch('/export')
        .then(response => {
            if (response.ok) {
                return response.text();
            }
            else {
                throw new Error('Failed to export mesh.');
            }
        })
        .then(async content => {
            if (fileHandle) {
                try {
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    showMessage('Mesh exported successfully.', 'success');
                } catch (err) {
                    console.error('Error writing to file:', err);
                    showMessage('Error saving mesh to file.', 'error');
                }
            } else {
                // Fallback for browsers without showSaveFilePicker
                saveFile(content, 'mesh.deck', 'text/plain');
            }
        })
        .catch(err => {
            showMessage(err.message, 'error');
        });
}
window.exportMesh = exportMesh;

function sendBulkNodeUpdate(nodesData, isDragging = false, draggingNodeId = null) {
    socket.emit('update_nodes_bulk', { nodes: nodesData, isDragging: isDragging, draggingNodeId: draggingNodeId });
}
window.sendBulkNodeUpdate = sendBulkNodeUpdate;

function saveMeshToServer() {
    socket.emit('save_mesh');
}
window.saveMeshToServer = saveMeshToServer;