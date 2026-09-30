// IndexedDB helper functions
const dbName = 'MeshToolDB';
const storeName = 'fileHandles';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function set(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function get(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
    });
}

async function storeFileHandle(handle) {
    if (!handle) return;
    try {
        await set('projectFileHandle', handle);
    } catch (error) {
        console.error('Error storing file handle:', error);
    }
}

async function retrieveFileHandle() {
    try {
        const handle = await get('projectFileHandle');
        if (handle) {
            return handle;
        }
    } catch (error) {
        console.error('Error retrieving file handle:', error);
    }
    return null;
}
