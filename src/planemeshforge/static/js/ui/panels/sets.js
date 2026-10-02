// The Sets dock tab: node/element/surface sets, each with per-set
// visibility, isolate, highlight, rename, edit-members, and delete. "Edit
// members" (the list icon, next to rename) lets you replace a set's whole
// membership by typing ids directly - node/element sets as a plain id list,
// face-based surface sets as `element:face` pairs - rather than only being
// able to rebuild one via Create Set from Selection. Surface sets store
// `*SURFACE, TYPE=ELEMENT` tokens - a direct element id or (for sets
// imported from a deck) a reference to a named element set, each optionally
// followed by a face label like `S1`. `resolveSurfaceFaces` turns the
// labeled ones back into edge-face keys for highlighting; unlabeled ones
// (a bare element-set reference, same as Abaqus itself does for a *SURFACE
// built from whole element sets) resolve to that set's share of the mesh's
// boundary edges instead - only a surface with no edges at all (every
// token numeric/unresolvable) falls back to highlighting its elements.
// Hiding/isolating a surface set only affects the edge line itself
// (`store.isEdgeVisible`), never the owning element's own rendering.
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { scheduleDraw } from "../../render/renderer.js";
import { resolveSurfaceFaces, resolveSurfaceElementIds } from "../../core/surfaces.js";
import * as client from "../../net/client.js";
import { openDialog } from "../dialogs.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";

// "1, 2 3\n4" -> [1, 2, 3, 4] - accepts commas, spaces, and newlines as
// separators since that's whatever's easiest to paste from elsewhere, and
// de-dupes since the server would anyway (create_set/create_surface sort+
// dedupe their id lists).
function parseIdList(text) {
    return [...new Set((text || "").split(/[\s,]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isInteger))];
}

function setRow({ kind, name, count, onSelect, showIsolate, showHide, showEdit, onEditMembers }) {
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

    if (showIsolate) {
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

    if (showHide) {
        const hidden = store.isSetHidden(kind, name);
        const eyeBtn = document.createElement("button");
        eyeBtn.title = hidden ? "Show" : "Hide";
        eyeBtn.innerHTML = icon(hidden ? "eye-off" : "eye");
        eyeBtn.addEventListener("click", () => {
            store.toggleSetVisibility(kind, name);
            scheduleDraw();
        });
        row.appendChild(eyeBtn);
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

    if (onEditMembers) {
        const editBtn = document.createElement("button");
        editBtn.title = "Edit members";
        editBtn.innerHTML = icon("check-list");
        editBtn.addEventListener("click", onEditMembers);
        row.appendChild(editBtn);
    }

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

export function buildSetsPanel(root) {
    // Each group's collapsed/expanded state must survive `render()`, since
    // that re-runs on every selection/mesh change (e.g. clicking a set row
    // selects its members) - otherwise collapsing one group would pop back
    // open as soon as you clicked anything else in the panel.
    const openGroups = { "Node Sets": true, "Element Sets": true, "Surface Sets": true };

    function group(title, rows) {
        const details = document.createElement("details");
        details.className = "set-group";
        details.open = openGroups[title];
        details.innerHTML = `<summary>${title} (${rows.length})</summary>`;
        details.addEventListener("toggle", () => {
            openGroups[title] = details.open;
        });
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

        async function editSimpleMembers(kind, name, ids) {
            const values = await openDialog({
                title: `Edit Members: ${name}`,
                fields: [{ name: "ids", label: "IDs", type: "textarea", rows: 10, default: ids.join(", ") }],
                wide: true,
            });
            if (!values) return;
            const result = await client.op("create_set", { set_kind: kind, name, ids: parseIdList(values.ids) });
            if (!result.ok) toast.error(result.error);
        }

        const nodeRows = Object.entries(store.mesh.node_sets).map(([name, ids]) =>
            setRow({
                kind: "node",
                name,
                count: ids.length,
                onSelect: () => selection.setNodes(ids),
                showIsolate: true,
                // No hide button for node sets: nodes aren't shown in the
                // view by default anyway (see renderer.js's isNodeRevealed),
                // so isolate is the only visibility control that means
                // anything here - it reveals the set's members, highlighted.
                showHide: false,
                showEdit: true,
                onEditMembers: () => editSimpleMembers("node", name, ids),
            })
        );
        const elementRows = Object.entries(store.mesh.element_sets).map(([name, ids]) =>
            setRow({
                kind: "element",
                name,
                count: ids.length,
                onSelect: () => selection.setElements(ids),
                showIsolate: true,
                showHide: true,
                showEdit: true,
                onEditMembers: () => editSimpleMembers("element", name, ids),
            })
        );
        const surfaceRows = Object.entries(store.mesh.surface_sets).map(([name, tokens]) => {
            const faceKeys = resolveSurfaceFaces(tokens, store.mesh.element_sets, store.edgeFaces);
            if (faceKeys.length) {
                return setRow({
                    kind: "surface",
                    name,
                    count: faceKeys.length,
                    onSelect: () => selection.setFaces(faceKeys),
                    showIsolate: true,
                    // No hide button for surface sets: isolating already
                    // highlights the set's own lines orange without
                    // touching anything else's appearance (see
                    // renderer.js's isEdgeIsolated/isEdgeGhosted), so a
                    // separate hide toggle doesn't add anything.
                    showHide: false,
                    showEdit: true,
                    onEditMembers: async () => {
                        const values = await openDialog({
                            title: `Edit Faces: ${name}`,
                            fields: [
                                { name: "faces", label: "element:face (0=S1)", type: "textarea", rows: 10, default: faceKeys.join(", ") },
                            ],
                            wide: true,
                        });
                        if (!values) return;
                        const faces = values.faces
                            .split(/[\s,]+/)
                            .map(s => s.trim())
                            .filter(Boolean)
                            .map(token => token.split(":").map(Number))
                            .filter(pair => pair.length === 2 && pair.every(Number.isInteger));
                        if (!faces.length) {
                            toast.error("No valid element:face pairs given.");
                            return;
                        }
                        const result = await client.op("create_surface", { name, faces });
                        if (!result.ok) toast.error(result.error);
                    },
                });
            }
            // Legacy import: a plain reference to element sets, no face geometry.
            const memberIds = resolveSurfaceElementIds(tokens, store.mesh.element_sets);
            return setRow({
                kind: "surface",
                name,
                count: memberIds.length,
                onSelect: () => selection.setElements(memberIds),
                showIsolate: true,
                showHide: false,
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
