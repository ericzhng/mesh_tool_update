// New/Open/Save/Save As. A project file is JSON: `{mesh, view}`. Old project
// files (from before real elements existed) may carry a `connections` array
// instead of line elements - those are converted to SFMGAX1 elements on open
// so old files keep working.
import { bus } from "../core/events.js";
import { store } from "../core/store.js";
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { saveFile } from "../utils.js";
import { storeFileHandle, retrieveFileHandle } from "./db.js";
import { toast } from "../ui/toast.js";
import { uploadMesh, exportMesh } from "../net/api.js";

let fileHandle = null;
let projectName = "Untitled";
let dirty = false;
let suppressDirty = false;

function setDirty(value) {
    dirty = value;
    bus.emit("project:changed", { name: projectName, dirty });
}

function setProjectName(name) {
    projectName = name;
    bus.emit("project:changed", { name: projectName, dirty });
}

bus.on("mesh:changed", () => {
    if (!suppressDirty) setDirty(true);
});

function convertLegacyConnections(data) {
    const mesh = data.mesh || data;
    if (!Array.isArray(mesh.connections) || !mesh.connections.length) return mesh;

    let nextId = 1 + Math.max(0, ...(mesh.elements || []).map(e => e.id), ...mesh.connections.map(c => c.id || 0));
    const lineElements = mesh.connections.map(c => ({
        id: nextId++,
        type: "SFMGAX1",
        node_ids: [c.source, c.target],
    }));
    mesh.elements = [...(mesh.elements || []), ...lineElements];
    delete mesh.connections;
    return mesh;
}

function serializeProject() {
    return JSON.stringify(
        {
            mesh: store.mesh,
            view: {
                offsetX: viewport.offsetX,
                offsetY: viewport.offsetY,
                scale: viewport.scale,
                rotation: viewport.rotation,
                showNodeLabels: viewport.showNodeLabels,
                showElementLabels: viewport.showElementLabels,
            },
        },
        null,
        2
    );
}

function applyView(view) {
    if (!view) return;
    Object.assign(viewport, {
        offsetX: view.offsetX ?? viewport.offsetX,
        offsetY: view.offsetY ?? viewport.offsetY,
        scale: view.scale ?? viewport.scale,
        rotation: view.rotation ?? viewport.rotation,
        showNodeLabels: view.showNodeLabels ?? viewport.showNodeLabels,
        showElementLabels: view.showElementLabels ?? viewport.showElementLabels,
    });
    bus.emit("viewport:changed", viewport);
}

export async function newProject() {
    await client.op("clear_mesh", {});
    fileHandle = null;
    setProjectName("Untitled");
    viewport.fitToPoints([]);
    setDirty(false);
}

export async function openProjectData(text, name) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        toast.error("That file is not a valid project.");
        return;
    }
    const mesh = convertLegacyConnections(data);
    suppressDirty = true;
    const result = await client.loadMesh(mesh);
    suppressDirty = false;
    if (!result.ok) {
        toast.error(result.error || "Failed to open project.");
        return;
    }
    applyView(data.view);
    setProjectName(name);
    setDirty(false);
}

export async function openProject() {
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: "PlaneMeshForge project", accept: { "application/json": [".json"] } }],
            });
            const file = await handle.getFile();
            await openProjectData(await file.text(), file.name);
            fileHandle = handle;
            storeFileHandle(handle);
            return;
        } catch (err) {
            if (err.name !== "AbortError") console.error(err);
            return;
        }
    }
    document.getElementById("project-file-input").click();
}

export async function openProjectFromInputFile(file) {
    await openProjectData(await file.text(), file.name);
    fileHandle = null;
}

export async function saveProject() {
    const content = serializeProject();
    const usedHandle = await saveFile(content, `${projectName}.json`, "application/json", fileHandle);
    if (usedHandle) {
        fileHandle = usedHandle;
        storeFileHandle(usedHandle);
        setProjectName(usedHandle.name.replace(/\.json$/i, ""));
    }
    setDirty(false);
}

export async function saveProjectAs() {
    fileHandle = null;
    await saveProject();
}

export async function restoreLastFileHandle() {
    const handle = await retrieveFileHandle();
    if (!handle) return;
    try {
        const permission = await handle.queryPermission?.({ mode: "readwrite" });
        if (permission && permission !== "granted") return;
        fileHandle = handle;
        setProjectName(handle.name.replace(/\.json$/i, ""));
    } catch (err) {
        console.warn("Could not restore previous file handle:", err);
    }
}

export function isDirty() {
    return dirty;
}

export async function importMeshFile(file) {
    try {
        await uploadMesh(file);
        client.getMesh();
        fileHandle = null;
        setProjectName(file.name.replace(/\.(inp|deck)$/i, ""));
        setDirty(false);
        toast.success(`Imported ${file.name}.`);
    } catch (err) {
        toast.error(`Failed to import mesh: ${err.message}`);
    }
}

export async function exportDeck() {
    try {
        const blob = await exportMesh();
        await saveFile(blob, "mesh.deck", "text/plain");
    } catch (err) {
        toast.error(`Failed to export mesh: ${err.message}`);
    }
}
