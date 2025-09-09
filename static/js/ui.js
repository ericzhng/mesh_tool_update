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

function showMessage(msg, type = 'info', duration = 3000) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = msg;
    messageDiv.classList.remove('bg-red-500', 'bg-green-500', 'bg-gray-800', 'opacity-0', 'pointer-events-none');
    if (type === 'error') {
        messageDiv.classList.add('bg-red-500', 'bg-opacity-75');
    } else if (type === 'success') {
        messageDiv.classList.add('bg-green-500', 'bg-opacity-75');
    } else {
        messageDiv.classList.add('bg-gray-800', 'bg-opacity-75');
    }
    messageDiv.classList.add('opacity-100');
    setTimeout(() => { 
        messageDiv.classList.remove('opacity-100');
        messageDiv.classList.add('opacity-0');
        messageDiv.classList.add('pointer-events-none');
    }, duration);
}

function updateSummary(summary) {
    const summaryDiv = document.getElementById('summary');
    summaryDiv.innerHTML = (summary.num_nodes > 0 || summary.num_connections > 0) ? 
        `Nodes: <strong>${summary.num_nodes}</strong>, Connections: <strong>${summary.num_connections}</strong>` : 'No mesh loaded';
}

function triggerFileInput() {
    document.getElementById('mesh-file').click();
}

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