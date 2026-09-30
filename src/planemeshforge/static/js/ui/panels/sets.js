// The Sets dock tab: node/element/surface sets with per-set visibility,
// isolate, highlight, rename, and delete. Surface sets are read-only, and
// store the names of element sets they reference (not element ids
// directly) - `resolveSurfaceElementIds` turns that into real element ids
// for highlighting.
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { scheduleDraw } from "../../render/renderer.js";
import * as client from "../../net/client.js";
import { openDialog } from "../dialogs.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";

function resolveSurfaceElementIds(referencedSetNames) {
    const ids = new Set();
    for (const setName of referencedSetNames) {
        for (const id of store.mesh.element_sets[setName] || []) ids.add(id);
    }
    return [...ids];
}

function setRow({ kind, name, memberIds, count, interactive }) {
    const row = document.createElement("div");
    row.className = "set-row";

    const nameEl = document.createElement("span");
    nameEl.className = "set-name";
    nameEl.textContent = name;
    nameEl.title = "Click to select members";
    nameEl.addEventListener("click", () => {
        if (kind === "node") selection.setNodes(memberIds);
        else selection.setElements(memberIds);
        scheduleDraw();
    });
    row.appendChild(nameEl);

    const countEl = document.createElement("span");
    countEl.className = "set-count";
    countEl.textContent = count;
    row.appendChild(countEl);

    if (!interactive) return row;

    const hidden = store.isSetHidden(kind, name);
    const eyeBtn = document.createElement("button");
    eyeBtn.title = hidden ? "Show" : "Hide";
    eyeBtn.innerHTML = icon(hidden ? "eye-off" : "eye");
    eyeBtn.addEventListener("click", () => {
        store.toggleSetVisibility(kind, name);
        scheduleDraw();
    });
    row.appendChild(eyeBtn);

    const isolateBtn = document.createElement("button");
    isolateBtn.title = "Isolate";
    isolateBtn.className = store.isolatedSet?.kind === kind && store.isolatedSet?.name === name ? "active" : "";
    isolateBtn.innerHTML = icon("isolate");
    isolateBtn.addEventListener("click", () => {
        store.isolateSet(kind, name);
        scheduleDraw();
    });
    row.appendChild(isolateBtn);

    const renameBtn = document.createElement("button");
    renameBtn.title = "Rename";
    renameBtn.innerHTML = icon("rename");
    renameBtn.addEventListener("click", async () => {
        const values = await openDialog({ title: "Rename Set", fields: [{ name: "new_name", label: "New name", default: name }] });
        if (!values?.new_name) return;
        const result = await client.op("rename_set", { set_kind: kind, name, new_name: values.new_name });
        if (!result.ok) toast.error(result.error);
    });
    row.appendChild(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.title = "Delete set";
    deleteBtn.innerHTML = icon("trash");
    deleteBtn.addEventListener("click", async () => {
        const result = await client.op("delete_set", { set_kind: kind, name });
        if (!result.ok) toast.error(result.error);
    });
    row.appendChild(deleteBtn);

    return row;
}

function group(title, rows) {
    const details = document.createElement("details");
    details.className = "set-group";
    details.open = true;
    details.innerHTML = `<summary>${title} (${rows.length})</summary>`;
    if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "empty-hint";
        empty.textContent = "None";
        details.appendChild(empty);
    } else {
        rows.forEach(row => details.appendChild(row));
    }
    return details;
}

export function buildSetsPanel(root) {
    function render() {
        root.innerHTML = "";

        const createSection = document.createElement("div");
        createSection.className = "panel-section";
        createSection.innerHTML = `<div class="btn-row"><button class="btn btn-primary" id="create-set">${icon("plus")}Create Set from Selection</button></div>`;
        root.appendChild(createSection);
        createSection.querySelector("#create-set").addEventListener("click", async () => {
            const kind = selection.nodeIds.size ? "node" : selection.elementIds.size ? "element" : null;
            if (!kind) {
                toast.info("Select some nodes or elements first.");
                return;
            }
            const values = await openDialog({ title: "Create Set", fields: [{ name: "name", label: "Name", default: `${kind}Set1` }] });
            if (!values?.name) return;
            const ids = kind === "node" ? [...selection.nodeIds] : [...selection.elementIds];
            const result = await client.op("create_set", { set_kind: kind, name: values.name, ids });
            if (!result.ok) toast.error(result.error);
        });

        const nodeRows = Object.entries(store.mesh.node_sets).map(([name, ids]) =>
            setRow({ kind: "node", name, memberIds: ids, count: ids.length, interactive: true })
        );
        const elementRows = Object.entries(store.mesh.element_sets).map(([name, ids]) =>
            setRow({ kind: "element", name, memberIds: ids, count: ids.length, interactive: true })
        );
        const surfaceRows = Object.entries(store.mesh.surface_sets).map(([name, referencedSetNames]) => {
            const memberIds = resolveSurfaceElementIds(referencedSetNames);
            return setRow({ kind: "element", name, memberIds, count: memberIds.length, interactive: false });
        });

        root.appendChild(group("Node Sets", nodeRows));
        root.appendChild(group("Element Sets", elementRows));
        root.appendChild(group("Surface Sets", surfaceRows));
    }

    bus.on("mesh:changed", render);
    bus.on("visibility:changed", render);
    bus.on("selection:changed", render);
    render();
}
