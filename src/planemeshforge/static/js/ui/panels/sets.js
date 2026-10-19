// The Sets dock tab: node/element/surface sets, each with per-set
// visibility, isolate, and delete, plus a combined rename/edit-members
// editor. The editor docks inline at the top of this tab (see
// ui/panels/set-editor.js) instead of opening a centered modal, so the mesh
// view stays fully visible while editing - and it lets the viewport
// selection itself drive membership (pick/box to add or remove, typed ids
// or a Highlight field the other way), not just a typed id list. Surface
// sets store `*SURFACE, TYPE=ELEMENT` tokens - a direct element id or (for
// sets imported from a deck) a reference to a named element set, each
// optionally followed by a face label like `S1`. `resolveSurfaceFaces` turns
// the labeled ones back into edge-face keys for highlighting; unlabeled ones
// (a bare element-set reference, same as Abaqus itself does for a *SURFACE
// built from whole element sets) resolve to that set's share of the mesh's
// boundary edges instead - only a surface with no edges at all (every token
// numeric/unresolvable) falls back to highlighting its elements, and can
// only be renamed, not picked (see the `legacy` editor mode).
// Hiding/isolating a surface set only affects the edge line itself
// (`store.isEdgeVisible`), never the owning element's own rendering.
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { scheduleDraw } from "../../render/renderer.js";
import { resolveSurfaceFaces, resolveSurfaceElementIds } from "../../core/surfaces.js";
import * as client from "../../net/client.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";
import { openSetEditor, closeSetEditor, isSetEditorOpen, editingTarget } from "./set-editor.js";

function setRow({ kind, name, count, onSelect, showIsolate, showHide, showEdit, onEdit, isEditing }) {
    const row = document.createElement("div");
    row.className = isEditing ? "set-row set-row-editing" : "set-row";
    row.dataset.setName = name;

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

    const editBtn = document.createElement("button");
    editBtn.title = "Rename / edit members";
    editBtn.innerHTML = icon("rename");
    editBtn.addEventListener("click", () => onEdit());
    row.appendChild(editBtn);

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
    const GROUP_TITLE = { node: "Node Sets", element: "Element Sets", surface: "Surface Sets" };

    // The editor (ui/panels/set-editor.js) owns `editorHost` directly and
    // outlives `render()`. It docks inline next to the row it's editing
    // (see below), so it can end up nested inside `listHost` - `render()`
    // always detaches it first, before resetting `listHost.innerHTML`, so
    // that reset never touches it and wipes out its inputs/caret position.
    const editorHost = document.createElement("div");
    const listHost = document.createElement("div");
    root.append(editorHost, listHost);

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

    // A combined box-select routinely carries nodes, elements, and edges at
    // once now (see tools/select.js) - rather than silently picking one
    // kind, offer one "Create X Set" button per non-empty kind so the same
    // selection can be split into separate sets.
    const CREATE_KINDS = [
        { kind: "node", label: "Node", iconName: "add-node", count: () => selection.nodeIds.size },
        { kind: "element", label: "Element", iconName: "quad", count: () => selection.elementIds.size },
        { kind: "surface", label: "Surface", iconName: "surface", count: () => selection.faceKeys.size },
    ];

    function createSetFromSelection(kind) {
        const ids = kind === "node" ? [...selection.nodeIds] : kind === "element" ? [...selection.elementIds] : [];
        const faces = kind === "surface" ? [...selection.faceKeys].map(key => key.split(":").map(Number)) : [];
        openSetEditor(editorHost, {
            kind,
            name: null,
            isNew: true,
            ids,
            faces,
            onClose: render,
        });
        render();
    }

    function editSet(kind, name, ids) {
        openSetEditor(editorHost, { kind, name, isNew: false, ids, onClose: render });
        render();
    }

    function editSurfaceSet(name, faceKeys) {
        const faces = faceKeys.map(key => key.split(":").map(Number));
        openSetEditor(editorHost, { kind: "surface", name, isNew: false, faces, onClose: render });
        render();
    }

    function editLegacySurfaceSet(name) {
        openSetEditor(editorHost, { kind: "surface", name, isNew: false, legacy: true, onClose: render });
        render();
    }

    function render() {
        // Detach the editor before wiping listHost - it may currently be
        // docked inline inside a group from the last render (see below),
        // and listHost.innerHTML = "" would destroy it (inputs, caret,
        // pending debounce) if it were still a descendant.
        editorHost.remove();

        listHost.innerHTML = "";
        // Only one set is ever being worked on at a time - while the editor
        // is open, the rest of the list is just along for the ride (so
        // another row's "select members" click can't clobber the editor's
        // working selection out from under it).
        listHost.classList.toggle("sets-list-busy", isSetEditorOpen());

        const target = editingTarget();
        const isEditingRow = (kind, name) => !!target && target.kind === kind && target.name === name;

        // While the editor is open there's nothing useful "Create X Set"
        // could do (its own selection-driven Add/Remove already covers
        // that), so it's skipped entirely rather than shown greyed out.
        // With nothing selected there's nothing to create either, so the
        // whole section - buttons or hint - just doesn't appear.
        const present = CREATE_KINDS.filter(k => k.count() > 0);
        if (!isSetEditorOpen() && present.length) {
            const createSection = document.createElement("div");
            createSection.className = "panel-section";
            const row = document.createElement("div");
            row.className = "btn-row";
            present.forEach(({ kind, label, iconName, count }) => {
                const btn = document.createElement("button");
                btn.className = "btn btn-primary";
                btn.innerHTML = `${icon(iconName)}Create ${label} Set (${count()})`;
                btn.addEventListener("click", () => createSetFromSelection(kind));
                row.appendChild(btn);
            });
            createSection.appendChild(row);
            listHost.appendChild(createSection);
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
                onEdit: () => editSet("node", name, ids),
                isEditing: isEditingRow("node", name),
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
                onEdit: () => editSet("element", name, ids),
                isEditing: isEditingRow("element", name),
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
                    onEdit: () => editSurfaceSet(name, faceKeys),
                    isEditing: isEditingRow("surface", name),
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
                onEdit: () => editLegacySurfaceSet(name),
                isEditing: isEditingRow("surface", name),
            });
        });

        const groupsByKind = {
            node: group(GROUP_TITLE.node, nodeRows),
            element: group(GROUP_TITLE.element, elementRows),
            surface: group(GROUP_TITLE.surface, surfaceRows),
        };
        listHost.append(groupsByKind.node, groupsByKind.element, groupsByKind.surface);

        // Dock the editor right under the row it's editing (and keep that
        // group expanded so it's actually visible) instead of always at a
        // fixed spot - much easier to get back to than scrolling to the top
        // every time. A brand-new set has no row yet, so it falls back to
        // sitting above the list.
        const targetGroup = target && groupsByKind[target.kind];
        const targetRow = targetGroup?.querySelector(`[data-set-name="${CSS.escape(target.name)}"]`);
        if (targetRow) {
            targetGroup.open = true;
            openGroups[GROUP_TITLE[target.kind]] = true;
            targetRow.insertAdjacentElement("afterend", editorHost);
        } else {
            root.insertBefore(editorHost, listHost);
        }
    }

    bus.on("mesh:changed", render);
    bus.on("visibility:changed", render);
    bus.on("selection:changed", render);
    render();
}
