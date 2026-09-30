function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this || window;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

async function saveFile(content, filename, contentType, fileHandle = null) {
    const blob = new Blob([content], { type: contentType });

    if (fileHandle) {
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            showMessage('File saved successfully', 'success');
        } catch (err) {
            console.error('Error writing to file:', err);
            showMessage('Error saving file.', 'error');
        }
    } else if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Text Files',
                    accept: { [contentType]: ['.deck', '.txt'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            showMessage('File saved successfully', 'success');
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
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('File saved successfully', 'success');
    }
}
window.saveFile = saveFile;