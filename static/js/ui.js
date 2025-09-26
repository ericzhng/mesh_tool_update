document.addEventListener('DOMContentLoaded', () => {
    const menus = document.querySelectorAll('[data-menu]');

    menus.forEach(menu => {
        const button = menu.querySelector('.menu-button');
        const dropdown = menu.querySelector('.menu-dropdown');

        button.addEventListener('click', () => {
            dropdown.classList.toggle('hidden');
        });
    });

    // Close dropdowns when clicking outside
    window.addEventListener('click', e => {
        menus.forEach(menu => {
            if (!menu.contains(e.target)) {
                menu.querySelector('.menu-dropdown').classList.add('hidden');
            }
        });
    });

    // Collapsible set categories
    document.querySelectorAll('.set-header').forEach(header => {
        header.addEventListener('click', () => {
            const setList = header.nextElementSibling;
            const arrowIcon = header.querySelector('.arrow-icon');
            setList.classList.toggle('hidden');
            arrowIcon.classList.toggle('rotate-180');
        });
    });

    // Toggle Sets panel
    const toggleButton = document.getElementById('toggle-sets-panel');
    const sidebar = document.getElementById('sets-sidebar');

    toggleButton.addEventListener('click', () => {
        sidebar.classList.toggle('hidden');
    });
});

function showMessage(msg, type = 'info', duration = 3000) { // Default duration to 3000ms (3 seconds)
    const messageDiv = document.getElementById('status-message');
    messageDiv.textContent = msg;
    // Remove all type-related classes first
    messageDiv.classList.remove('bg-red-500', 'bg-green-500', 'bg-gray-800', 'bg-[#00274C]', 'opacity-0', 'pointer-events-none');
    
    // Apply new type-related classes
    if (type === 'error') {
        messageDiv.classList.add('bg-red-500', 'bg-opacity-75');
    } else if (type === 'success') {
        messageDiv.classList.add('bg-green-500', 'bg-opacity-75');
    } else { // 'info' type
        messageDiv.classList.add('bg-[#00274C]', 'bg-opacity-75'); // Use the status bar's background color
    }
    
    messageDiv.classList.remove('opacity-0'); // Ensure it's visible
    messageDiv.classList.add('opacity-100'); // Make it fully opaque
    messageDiv.classList.remove('pointer-events-none'); // Make it clickable/interactable if needed (though for messages, usually not)

    // Set timeout to hide the message
    setTimeout(() => {
        messageDiv.classList.remove('opacity-100');
        messageDiv.classList.add('opacity-0');
        messageDiv.classList.add('pointer-events-none'); // Make it non-interactable when hidden
    }, duration);
}

window.showMessage = showMessage;

function updateSummary(mesh) {
    const summaryDiv = document.getElementById('summary');
    if (!mesh || !mesh.nodes || mesh.nodes.length === 0) {
        summaryDiv.innerHTML = 'No mesh loaded';
        return;
    }

    const num_nodes = mesh.nodes.length;
    const num_elements = mesh.elements.length;
    const num_node_sets = Object.keys(mesh.node_sets || {}).length;
    const num_element_sets = Object.keys(mesh.element_sets || {}).length;
    const num_surface_sets = Object.keys(mesh.surface_sets || {}).length;

    summaryDiv.innerHTML = `
        Nodes: <strong>${num_nodes}</strong> | 
        Elements: <strong>${num_elements}</strong> | 
        Node Sets: <strong>${num_node_sets}</strong> | 
        Element Sets: <strong>${num_element_sets}</strong> | 
        Surface Sets: <strong>${num_surface_sets}</strong>
    `;
}
window.updateSummary = updateSummary;

function updateSetsUI(mesh) {
    const nodeSetsList = document.getElementById('node-sets-list');
    const elementSetsList = document.getElementById('element-sets-list');
    const surfaceSetsList = document.getElementById('surface-sets-list');

    const nodeSetsHeader = document.getElementById('node-sets-header');
    const elementSetsHeader = document.getElementById('element-sets-header');
    const surfaceSetsHeader = document.getElementById('surface-sets-header');

    nodeSetsList.innerHTML = '';
    elementSetsList.innerHTML = '';
    surfaceSetsList.innerHTML = '';

    if (!mesh) {
        nodeSetsHeader.textContent = 'Node Sets';
        elementSetsHeader.textContent = 'Element Sets';
        surfaceSetsHeader.textContent = 'Surface Sets';
        return;
    }

    const nodeSetsCount = Object.keys(mesh.node_sets || {}).length;
    const elementSetsCount = Object.keys(mesh.element_sets || {}).length;
    const surfaceSetsCount = Object.keys(mesh.surface_sets || {}).length;

    nodeSetsHeader.textContent = `Node Sets (#${nodeSetsCount})`;
    elementSetsHeader.textContent = `Element Sets (#${elementSetsCount})`;
    surfaceSetsHeader.textContent = `Surface Sets (#${surfaceSetsCount})`;

    let i = 1;
    for (const name in mesh.node_sets) {
        const li = document.createElement('li');
        li.className = 'whitespace-nowrap cursor-pointer hover:text-blue-500';
        li.textContent = `${i++}. ${name} (#${mesh.node_sets[name].length})`;
        li.addEventListener('click', () => {
            window.highlightSet(name, 'node');
        });
        nodeSetsList.appendChild(li);
    }

    i = 1;
    for (const name in mesh.element_sets) {
        const li = document.createElement('li');
        li.className = 'whitespace-nowrap cursor-pointer hover:text-blue-500';
        li.textContent = `${i++}. ${name} (#${mesh.element_sets[name].length})`;
        li.addEventListener('click', () => {
            window.highlightSet(name, 'element');
        });
        elementSetsList.appendChild(li);
    }

    i = 1;
    for (const name in mesh.surface_sets) {
        const li = document.createElement('li');
        li.className = 'whitespace-nowrap cursor-pointer hover:text-blue-500';
        li.textContent = `${i++}. ${name} (#${mesh.surface_sets[name].length})`;
        li.addEventListener('click', () => {
            window.highlightSet(name, 'surface');
        });
        surfaceSetsList.appendChild(li);
    }
}
window.updateSetsUI = updateSetsUI;

function triggerFileInput() {
    document.getElementById('mesh-file').click();
}
window.triggerFileInput = triggerFileInput;

function showContextMenu(e) {
    const contextMenu = document.getElementById('context-menu');
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.classList.remove('hidden');
}

function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    contextMenu.classList.add('hidden');
}

function updateUndoRedoButtons() {
    const revertButton = document.getElementById('revert-button');
    const forwardButton = document.getElementById('forward-button');

    if (!historyManager || !revertButton || !forwardButton) {
        return;
    }

    if (historyManager.pointer > 0) {
        revertButton.classList.remove('disabled');
    } else {
        revertButton.classList.add('disabled');
    }

    if (historyManager.pointer < historyManager.history.length - 1) {
        forwardButton.classList.remove('disabled');
    } else {
        forwardButton.classList.add('disabled');
    }
}

function newProject() {
    projectFileHandle = null;
    staleFileHandle = null;
    mesh = { nodes: [], connections: [], elements: [], node_sets: {}, element_sets: {}, surface_sets: {} };
    nodesMap = new Map();
    spatialGrid = null;
    appState = {
        meshLoaded: false,
        meshDisplayed: false,
    };
    view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
    if (historyManager) {
        historyManager.history = [];
        historyManager.pointer = -1;
        historyManager.pushState();
    }
    scheduleDrawMesh();
    updateSummary(mesh);
    updateSetsUI(mesh);
    showMessage('New project started', 'success');
}
window.newProject = newProject;

function reloadPage() {
    window.location.reload();
}
window.reloadPage = reloadPage;

async function openProject() {
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            projectFileHandle = handle;
            staleFileHandle = null; // Clear stale handle since we have a new live one
            storeFileHandle(projectFileHandle); // Store the new handle
            const file = await handle.getFile();
            const contents = await file.text();
            const state = JSON.parse(contents);
            if (state.mesh && state.view) {
                historyManager.history = [state];
                historyManager.pointer = 0;
                historyManager.applyState();
                showMessage('Project loaded', 'success');
            } else {
                showMessage('Invalid project file', 'error');
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err.name, err.message);
                showMessage('Error opening file', 'error');
            }
        }
    } else {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    try {
                        const state = JSON.parse(e.target.result);
                        if (state.mesh && state.view) {
                            historyManager.history = [state];
                            historyManager.pointer = 0;
                            historyManager.applyState();
                            showMessage('Project loaded', 'success');
                            projectFileHandle = null;
                        } else {
                            showMessage('Invalid project file', 'error');
                        }
                    } catch (error) {
                        showMessage('Failed to parse project file', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }
}
window.openProject = openProject;

async function save() {
    // Case 1: We have a live handle with permission.
    if (projectFileHandle) {
        const state = historyManager.getCurrentState();
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        try {
            const writable = await projectFileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            showMessage('Project saved', 'success');
            saveMeshToServer();
        } catch (err) {
            console.error(err.name, err.message);
            showMessage('Error saving file', 'error');
        }
        return;
    }

    // Case 2: We have a stale handle from IndexedDB, but no permission yet.
    if (staleFileHandle) {
        try {
            const requestStatus = await staleFileHandle.requestPermission({ mode: 'readwrite' });
            if (requestStatus === 'granted') {
                projectFileHandle = staleFileHandle; // Promote to live handle
                staleFileHandle = null; // Clear the stale handle
                await save(); // Retry the save function, which will now use the live handle
                return;
            } else {
                // User denied permission. Fall through to Save As.
                staleFileHandle = null; // Discard the stale handle
            }
        } catch (err) {
             if (err.name !== 'AbortError') {
                console.error('Error requesting permission for stored handle:', err);
            }
        }
    }

    // Case 3: No handle at all, or permission was denied.
    saveAs();
}
window.save = save;

async function saveAs() {
    const state = historyManager.getCurrentState();
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'mesh-project.json',
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            projectFileHandle = handle;
            staleFileHandle = null; // Clear stale handle since we have a new live one
            storeFileHandle(projectFileHandle); // Store the new handle
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            showMessage('Project saved', 'success');
            saveMeshToServer();
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err.name, err.message);
                showMessage('Error saving file', 'error');
            }
        }
    } else {
        // Fallback for older browsers
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mesh-project.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('Project saved', 'success');
        saveMeshToServer();
    }
}
window.saveAs = saveAs;

function hideAllMenus() {
    const menus = document.querySelectorAll('[data-menu]');
    menus.forEach(menu => {
        menu.querySelector('.menu-dropdown').classList.add('hidden');
    });
}

function handleHeaderMenuItemClick(event, message, actionFunction) {
    event.stopPropagation(); // Prevent event from bubbling up to menu button
    showMessage(message, 'info');
    actionFunction();
    hideAllMenus();
}
window.handleHeaderMenuItemClick = handleHeaderMenuItemClick;

function handleContextMenuItemClick(event, message, actionFunction) {
    event.stopPropagation(); // Prevent event from bubbling up to context menu
    showMessage(message, 'info');
    actionFunction();
    hideContextMenu();
}
window.handleContextMenuItemClick = handleContextMenuItemClick;