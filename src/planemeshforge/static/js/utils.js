// Generic helpers with no dependency on mesh state.
import { toast } from "./ui/toast.js";

export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

export function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

export async function saveFile(content, filename, contentType, fileHandle = null) {
    const blob = new Blob([content], { type: contentType });

    if (fileHandle) {
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            toast.success("File saved.");
            return fileHandle;
        } catch (err) {
            console.error("Error writing to file:", err);
            toast.error("Error saving file.");
            return null;
        }
    }

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: "Text Files", accept: { [contentType]: [".deck", ".txt", ".json"] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            toast.success("File saved.");
            return handle;
        } catch (err) {
            if (err.name !== "AbortError") {
                console.error(err.name, err.message);
                toast.error("Error saving file.");
            }
            return null;
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("File downloaded.");
    return null;
}
