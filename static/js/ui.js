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
});

function showMessage(msg, type = 'info', duration = 1000) { // Default duration to 1000ms (1 second)
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

function updateSummary(summary) {
    const summaryDiv = document.getElementById('summary');
    summaryDiv.innerHTML = (summary.num_nodes > 0 || summary.num_connections > 0) ? 
        `Nodes: <strong>${summary.num_nodes}</strong>, Connections: <strong>${summary.num_connections}</strong>` : 'No mesh loaded';
}

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
    mesh = { nodes: [], connections: [], elements: [] };
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
    updateSummary();
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
            const file = await handle.getFile();
            const contents = await file.text();
            const state = JSON.parse(contents);
            if (state.mesh && state.view && state.appState) {
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
                        if (state.mesh && state.view && state.appState) {
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
    if (projectFileHandle) {
        const state = historyManager.getCurrentState();
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        try {
            const writable = await projectFileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            showMessage('Project saved', 'success');
        } catch (err) {
            console.error(err.name, err.message);
            showMessage('Error saving file', 'error');
        }
    } else {
        saveAs();
    }
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
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            showMessage('Project saved', 'success');
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
