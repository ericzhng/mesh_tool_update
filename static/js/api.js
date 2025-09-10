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
            socket.emit('get_mesh', data);
            showMessage('Mesh displayed.', 'success');
            appState.meshDisplayed = true; // Set to true when mesh is displayed
            socket.emit('get_summary');
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
    socket.emit('clear_mesh');
    appState.meshLoaded = false; // Reset state on clear
    appState.meshDisplayed = false; // Reset state on clear
}
window.clearMesh = clearMesh;

function exportMatrix() {
    if (!appState.meshDisplayed) return showMessage('Please load and show a mesh before exporting.', 'error');
    fetch('/export').then(r => r.json()).then(data => {
        console.log(data);
        showMessage('Connectivity matrix logged to the console.', 'info');
    });
}
window.exportMatrix = exportMatrix;