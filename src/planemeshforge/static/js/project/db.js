// IndexedDB-backed storage for the File System Access API handle of the
// last-opened project, so re-opening it on reload doesn't require a picker.
const DB_NAME = "MeshToolDB";
const STORE_NAME = "fileHandles";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function set(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function get(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
    });
}

export async function storeFileHandle(handle) {
    if (!handle) return;
    try {
        await set("projectFileHandle", handle);
    } catch (error) {
        console.error("Error storing file handle:", error);
    }
}

export async function retrieveFileHandle() {
    try {
        return (await get("projectFileHandle")) || null;
    } catch (error) {
        console.error("Error retrieving file handle:", error);
        return null;
    }
}
