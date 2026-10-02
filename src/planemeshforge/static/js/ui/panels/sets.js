// The Sets dock tab: node/element/surface sets, each with per-set
// visibility, isolate, highlight, rename, and delete. Surface sets store
// `*SURFACE, TYPE=ELEMENT` tokens - a direct element id or (for sets
// imported from a deck) a reference to a named element set, each optionally
// followed by a face label like `S1`. `resolveSurfaceFaces` turns the
// labeled ones back into edge-face keys for highlighting; legacy imported
// surfaces without face labels fall back to highlighting their elements.
// Hiding/isolating a surface set only affects the edge line itself
// (`store.isEdgeVisible`), never the owning element's own rendering.
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { scheduleDraw } from "../../render/renderer.js";
import { resolveSurfaceFaces, resolveSurfaceElementIds, surfacePairs } from "../../core/surfaces.js";
import * as client from "../../net/client.js";
import { openDialog } from "../dialogs.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";

function setRow({ kind, name, count, onSelect, showVisibility, showEdit }) {
    const row = document.createElement("div");
    row.className = "set-row";

    const nameEl = document.createElement("span");
    nameEl.className = "set-name";
    nameEl.textContent = name;
    nameEl.title = "Click to select members";
    nameEl.addEventListener("click", () => {
        onSelect();
        scheduleDraw();
    });
    row.appendChild(nameEl);

    const countEl = document.createElement("span");
    countEl.className = "set-count";
    countEl.textContent = count;
    row.appendChild(countEl);

    if (showVisibility) {
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
    }

    if (!showEdit) return row;

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
            const kind = selection.nodeIds.size ? "node" : selection.elementIds.size ? "element" : selection.faceKeys.size ? "surface" : null;
            if (!kind) {
                toast.info("Select some nodes, elements, or surface edges first.");
                return;
            }
            const values = await openDialog({ title: "Create Set", fields: [{ name: "name", label: "Name", default: `${kind}Set1` }] });
            if (!values?.name) return;
            let result;
            if (kind === "surface") {
                const faces = [...selection.faceKeys].map(key => key.split(":").map(Number));
                result = await client.op("create_surface", { name: values.name, faces });
            } else {
                const ids = kind === "node" ? [...selection.nodeIds] : [...selection.elementIds];
                result = await client.op("create_set", { set_kind: kind, name: values.name, ids });
            }
            if (!result.ok) toast.error(result.error);
        });

        const nodeRows = Object.entries(store.mesh.node_sets).map(([name, ids]) =>
            setRow({
                kind: "node",
                name,
                count: ids.length,
                onSelect: () => selection.setNodes(ids),
                showVisibility: true,
                showEdit: true,
            })
        );
        const elementRows = Object.entries(store.mesh.element_sets).map(([name, ids]) =>
            setRow({
                kind: "element",
                name,
                count: ids.length,
                onSelect: () => selection.setElements(ids),
                showVisibility: true,
                showEdit: true,
            })
        );
        const surfaceRows = Object.entries(store.mesh.surface_sets).map(([name, tokens]) => {
            const faceKeys = resolveSurfaceFaces(tokens, store.mesh.element_sets);
            const hasFaces = surfacePairs(tokens).some(([, label]) => label);
            if (hasFaces) {
                return setRow({
                    kind: "surface",
                    name,
                    count: faceKeys.length,
                    onSelect: () => selection.setFaces(faceKeys),
                    showVisibility: true,
                    showEdit: true,
                });
            }
            // Legacy import: a plain reference to element sets, no face geometry.
            const memberIds = resolveSurfaceElementIds(tokens, store.mesh.element_sets);
            return setRow({
                kind: "surface",
                name,
                count: memberIds.length,
                onSelect: () => selection.setElements(memberIds),
                showVisibility: true,
                showEdit: true,
            });
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
