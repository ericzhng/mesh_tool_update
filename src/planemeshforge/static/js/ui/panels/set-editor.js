// The Sets panel's inline, non-modal member editor - replaces the old
// "Rename / edit members" dialog. It docks at the top of the Sets tab
// instead of covering the mesh view, and uses the viewport selection itself
// as the working membership buffer:
//   - opening it locks the `select` tool to the set's kind (see
//     `selectTool.enterMemberEdit`) and seeds the selection with the set's
//     current members;
//   - picking/boxing in the view adds or removes members (per the pick-mode
//     toggle), live-updating the id-list textarea;
//   - typing in the textarea drives the selection the other way;
//   - selecting or placing the caret over an id in the textarea tints it
//     cyan in the view (`core/highlight.js`) without touching the actual
//     pick buffer, as a lightweight way to locate it.
// Only one editor is ever open at a time (`openSetEditor` cancels whichever
// was open before it).
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { highlight } from "../../core/highlight.js";
import { selectTool } from "../../tools/select.js";
import { toolManager } from "../../tools/tool-manager.js";
import { viewport } from "../../render/viewport.js";
import * as client from "../../net/client.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";
import { parseIdList, parseFaceList, formatIdList, formatFaceList } from "../../core/id-list.js";

const KIND_LABEL = { node: "Node", element: "Element", surface: "Surface" };
const SYNC_DEBOUNCE_MS = 250;

let current = null;

export function closeSetEditor() {
    current?._cancel();
}

export function isSetEditorOpen() {
    return !!current;
}

// `host` is cleared and (re)populated here; it must stay outside whatever
// container the Sets panel re-renders on every mesh/selection change, or
// the editor's inputs/caret would get wiped out from under the user.
export function openSetEditor(host, config) {
    closeSetEditor();
    current = new SetEditor(host, config);
    return current;
}

function pointsForNodeIds(ids) {
    return ids.map(id => store.node(id)).filter(Boolean);
}

function pointsForElementIds(ids) {
    const points = [];
    for (const id of ids) {
        const el = store.element(id);
        if (!el) continue;
        for (const nid of el.node_ids) {
            const n = store.node(nid);
            if (n) points.push(n);
        }
    }
    return points;
}

function pointsForFaceKeys(keys) {
    const points = [];
    for (const key of keys) {
        const edge = store.edgeFaceMap.get(key);
        if (!edge) continue;
        const a = store.node(edge.a);
        const b = store.node(edge.b);
        if (a) points.push(a);
        if (b) points.push(b);
    }
    return points;
}

function tokenAtCaret(text, pos) {
    const isSep = ch => ch === undefined || /[\s,]/.test(ch);
    let start = pos;
    let end = pos;
    while (start > 0 && !isSep(text[start - 1])) start--;
    while (end < text.length && !isSep(text[end])) end++;
    return text.slice(start, end);
}

class SetEditor {
    constructor(host, { kind, name, isNew, legacy = false, ids = [], faces = [], onClose }) {
        this.host = host;
        this.kind = kind;
        this.originalName = name;
        this.isNew = isNew;
        this.legacy = legacy;
        this.onClose = onClose;
        this.mode = "add";
        this.applying = false;
        this._syncTimer = null;
        this._unsubs = [];

        // What's currently selected becomes the working buffer - for an
        // existing set that's its members; for a brand-new one (Create X
        // Set) it's already the selection that triggered the create, kept
        // as-is but restricted to this one kind.
        this.savedSelection = { nodes: [...selection.nodeIds], elements: [...selection.elementIds], faces: [...selection.faceKeys] };
        if (kind === "surface") {
            this.baselineFaceKeys = faces.map(([elementId, faceIndex]) => `${elementId}:${faceIndex}`);
            selection.setFaces(this.baselineFaceKeys);
        } else if (kind === "node") {
            this.baselineIds = [...ids];
            selection.setNodes(ids);
        } else {
            this.baselineIds = [...ids];
            selection.setElements(ids);
        }

        this._build();

        if (!legacy) {
            selectTool.enterMemberEdit(kind, "add");
            toolManager.activate("select");
            bus.emit("tool:changed", selectTool);
        }

        this._unsubs.push(bus.on("selection:changed", () => this._onSelectionChanged()));
        this._unsubs.push(bus.on("mesh:changed", () => this._onMeshChanged()));
        if (!legacy) {
            // Switching to any other tool (e.g. a shortcut key) abandons the
            // edit rather than leaving the editor open with picking no
            // longer wired up to it.
            this._unsubs.push(bus.on("tool:changed", tool => {
                if (tool?.id !== "select") this._cancel();
            }));
        }
        this._syncListFromSelection();
    }

    _currentIds() {
        if (this.kind === "node") return [...selection.nodeIds];
        if (this.kind === "element") return [...selection.elementIds];
        return [...selection.faceKeys].map(key => key.split(":").map(Number));
    }

    _build() {
        this.host.innerHTML = "";
        const box = document.createElement("div");
        box.className = "set-editor";

        const header = document.createElement("div");
        header.className = "set-editor-header";
        header.textContent = this.isNew ? `New ${KIND_LABEL[this.kind]} Set` : `Editing ${KIND_LABEL[this.kind]} Set`;
        box.appendChild(header);

        const nameRow = document.createElement("div");
        nameRow.className = "field-row";
        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Name";
        this.nameInput = document.createElement("input");
        this.nameInput.type = "text";
        this.nameInput.value = this.originalName || `${this.kind}Set1`;
        nameRow.append(nameLabel, this.nameInput);
        box.appendChild(nameRow);

        if (this.legacy) {
            const note = document.createElement("div");
            note.className = "empty-hint";
            note.textContent = "This surface references element sets directly - it has no face geometry to pick, so only the name can be changed here.";
            box.appendChild(note);
        } else {
            box.appendChild(this._buildPickRow());

            this.countEl = document.createElement("div");
            this.countEl.className = "set-editor-count";
            box.appendChild(this.countEl);

            this.warningEl = document.createElement("div");
            this.warningEl.className = "set-editor-warning";
            box.appendChild(this.warningEl);

            const textareaRow = document.createElement("div");
            textareaRow.className = "field-row field-row-textarea";
            const label = document.createElement("label");
            label.textContent = this.kind === "surface" ? "element:Sn" : "IDs";
            this.textarea = document.createElement("textarea");
            this.textarea.rows = 8;
            this.textarea.spellcheck = false;
            textareaRow.append(label, this.textarea);
            box.appendChild(textareaRow);

            this.textarea.addEventListener("input", () => this._scheduleSyncFromList());
            this.textarea.addEventListener("blur", () => this._syncListFromSelection());
            ["mouseup", "keyup", "select"].forEach(evt =>
                this.textarea.addEventListener(evt, () => this._highlightCaretToken())
            );
        }

        const actions = document.createElement("div");
        actions.className = "btn-row set-editor-actions";

        if (!this.legacy) {
            const zoomBtn = document.createElement("button");
            zoomBtn.className = "btn";
            zoomBtn.innerHTML = `${icon("fit")}Zoom to members`;
            zoomBtn.addEventListener("click", () => this._zoomToCurrent());
            actions.appendChild(zoomBtn);

            const revertBtn = document.createElement("button");
            revertBtn.className = "btn";
            revertBtn.textContent = "Revert";
            revertBtn.title = "Reset the id list back to the set's current saved members";
            revertBtn.addEventListener("click", () => this._revert());
            actions.appendChild(revertBtn);
        }

        const spacer = document.createElement("div");
        spacer.className = "btn-row-spacer";
        actions.appendChild(spacer);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => this._cancel());
        actions.appendChild(cancelBtn);

        const applyBtn = document.createElement("button");
        applyBtn.className = "btn btn-primary";
        applyBtn.textContent = "Apply";
        applyBtn.addEventListener("click", () => this._apply());
        actions.appendChild(applyBtn);

        box.appendChild(actions);
        this.host.appendChild(box);

        // Window-scoped, not just within the editor's own inputs - Escape
        // has to cancel the edit no matter where focus is (the name field,
        // the id textarea, or the canvas itself while picking).
        window.addEventListener("keydown", this._onWindowKeyDown = e => {
            if (e.key === "Escape") {
                e.stopPropagation();
                this._cancel();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._apply();
            } else if (e.key === "Shift" || e.key === "Control" || e.key === "Meta") {
                this._refreshPickButtons?.(e);
            }
        });
        window.addEventListener("keyup", this._onWindowKeyUp = e => {
            if (e.key === "Shift" || e.key === "Control" || e.key === "Meta") this._refreshPickButtons?.(e);
        });
    }

    _buildPickRow() {
        const row = document.createElement("div");
        row.className = "pick-mode-row";
        const toggle = document.createElement("div");
        toggle.className = "pick-mode-toggle";

        const addBtn = document.createElement("button");
        addBtn.innerHTML = `${icon("plus")}Add`;
        const removeBtn = document.createElement("button");
        removeBtn.innerHTML = `${icon("delete-tool")}Remove`;

        // The active button reflects whatever action a pick would actually
        // take right now - the sticky mode normally, but overridden live
        // while Shift/Ctrl is held (see `_refreshPickButtons`, driven by the
        // window keydown/keyup listeners in `_build`).
        this._refreshPickButtons = e => {
            const effective = e?.ctrlKey || e?.metaKey ? "remove" : e?.shiftKey ? "add" : this.mode;
            addBtn.classList.toggle("active", effective === "add");
            removeBtn.classList.toggle("active", effective === "remove");
        };

        const setMode = mode => {
            this.mode = mode;
            this._refreshPickButtons();
            selectTool.enterMemberEdit(this.kind, mode);
            bus.emit("tool:changed", selectTool);
        };
        addBtn.addEventListener("click", () => setMode("add"));
        removeBtn.addEventListener("click", () => setMode("remove"));
        setMode("add");

        toggle.append(addBtn, removeBtn);
        const hint = document.createElement("span");
        hint.className = "pick-mode-hint";
        hint.textContent = "pick in the view · Shift adds · Ctrl removes";
        row.append(toggle, hint);
        return row;
    }

    _parseText(text) {
        return this.kind === "surface" ? parseFaceList(text) : parseIdList(text);
    }

    _formatIds(ids) {
        return this.kind === "surface" ? formatFaceList(ids) : formatIdList(ids);
    }

    // ---- viewport (selection) -> textarea ----

    _onSelectionChanged() {
        if (this.legacy) return;
        this._updateCount();
        if (document.activeElement === this.textarea) return; // don't fight the user mid-typing
        this._syncListFromSelection();
    }

    _syncListFromSelection() {
        if (this.legacy) return;
        this.textarea.value = this._formatIds(this._currentIds());
        this._updateCount();
        this.warningEl.textContent = "";
    }

    _updateCount() {
        const currentKeys = this.kind === "surface" ? [...selection.faceKeys] : this._currentIds();
        const baselineKeys = this.kind === "surface" ? this.baselineFaceKeys : this.baselineIds;
        const baselineSet = new Set(baselineKeys);
        const currentSet = new Set(currentKeys);
        const added = currentKeys.filter(k => !baselineSet.has(k)).length;
        const removed = baselineKeys.filter(k => !currentSet.has(k)).length;
        const n = currentKeys.length;
        const diff = added || removed ? ` (+${added} / -${removed})` : "";
        this.countEl.textContent = `${n} member${n === 1 ? "" : "s"}${diff}`;
    }

    // ---- textarea -> viewport (selection) ----

    _scheduleSyncFromList() {
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this._syncSelectionFromList(), SYNC_DEBOUNCE_MS);
    }

    _syncSelectionFromList() {
        const { ids, faces, invalid } = this.kind === "surface"
            ? (() => {
                  const r = parseFaceList(this.textarea.value);
                  return { faces: r.faces, invalid: r.invalid };
              })()
            : (() => {
                  const r = parseIdList(this.textarea.value);
                  return { ids: r.ids, invalid: r.invalid };
              })();

        if (this.kind === "surface") {
            const valid = faces.filter(([elementId]) => store.elementsMap.has(elementId));
            const bad = faces.filter(([elementId]) => !store.elementsMap.has(elementId));
            selection.setFaces(valid.map(([elementId, faceIndex]) => `${elementId}:${faceIndex}`));
            this._reportInvalid([...invalid, ...bad.map(([e, f]) => `${e}:S${f + 1}`)]);
        } else if (this.kind === "node") {
            const valid = ids.filter(id => store.nodesMap.has(id));
            const bad = ids.filter(id => !store.nodesMap.has(id));
            selection.setNodes(valid);
            this._reportInvalid([...invalid, ...bad]);
        } else {
            const valid = ids.filter(id => store.elementsMap.has(id));
            const bad = ids.filter(id => !store.elementsMap.has(id));
            selection.setElements(valid);
            this._reportInvalid([...invalid, ...bad]);
        }
    }

    _reportInvalid(tokens) {
        if (!tokens.length) {
            this.warningEl.textContent = "";
            return;
        }
        const shown = tokens.slice(0, 8).join(", ") + (tokens.length > 8 ? ", …" : "");
        this.warningEl.textContent = `${tokens.length} unknown id${tokens.length === 1 ? "" : "s"} ignored: ${shown}`;
    }

    // ---- highlight (secondary, non-selection) ----

    _highlightCaretToken() {
        const text = this.textarea.value;
        const { selectionStart: s, selectionEnd: e } = this.textarea;
        const segment = s === e ? tokenAtCaret(text, s) : text.slice(s, e);
        this._setHighlightFromText(segment);
    }

    _setHighlightFromText(text) {
        if (!text || !text.trim()) {
            highlight.clear();
            return;
        }
        if (this.kind === "surface") {
            const { faces } = parseFaceList(text);
            highlight.set({ faces: faces.map(([elementId, faceIndex]) => `${elementId}:${faceIndex}`) });
        } else if (this.kind === "node") {
            const { ids } = parseIdList(text);
            highlight.set({ nodes: ids });
        } else {
            const { ids } = parseIdList(text);
            highlight.set({ elements: ids });
        }
    }

    // ---- zoom ----

    _zoomToCurrent() {
        const points = this._pointsForCurrent(this._currentIds());
        if (points.length) viewport.fitToPoints(points);
    }

    _pointsForCurrent(ids) {
        if (this.kind === "node") return pointsForNodeIds(ids);
        if (this.kind === "element") return pointsForElementIds(ids);
        return pointsForFaceKeys(ids.map(([elementId, faceIndex]) => `${elementId}:${faceIndex}`));
    }

    _revert() {
        if (this.kind === "surface") selection.setFaces(this.baselineFaceKeys);
        else if (this.kind === "node") selection.setNodes(this.baselineIds);
        else selection.setElements(this.baselineIds);
        this._syncListFromSelection();
    }

    // ---- lifecycle ----

    _onMeshChanged() {
        if (this.applying || this.isNew || this.legacy) return;
        const sets = this.kind === "node" ? store.mesh.node_sets : this.kind === "element" ? store.mesh.element_sets : store.mesh.surface_sets;
        if (!(this.originalName in sets)) {
            toast.error(`Set '${this.originalName}' no longer exists; editor closed.`);
            this._close();
        }
    }

    async _apply() {
        const newName = this.nameInput.value.trim();
        if (!newName) {
            toast.error("Name can't be empty.");
            return;
        }

        this.applying = true;
        try {
            if (this.legacy) {
                if (newName !== this.originalName) {
                    const result = await client.op("rename_set", { set_kind: "surface", name: this.originalName, new_name: newName });
                    if (!result.ok) {
                        toast.error(result.error);
                        return;
                    }
                }
                this._close();
                return;
            }

            if (document.activeElement === this.textarea) this._syncSelectionFromList();

            let result;
            if (this.isNew) {
                if (this.kind === "surface") {
                    const faces = [...selection.faceKeys].map(key => key.split(":").map(Number));
                    result = await client.op("create_surface", { name: newName, faces });
                } else {
                    const ids = this.kind === "node" ? [...selection.nodeIds] : [...selection.elementIds];
                    result = await client.op("create_set", { set_kind: this.kind, name: newName, ids });
                }
            } else {
                const args = { set_kind: this.kind, name: this.originalName, new_name: newName };
                if (this.kind === "surface") args.faces = [...selection.faceKeys].map(key => key.split(":").map(Number));
                else args.ids = this.kind === "node" ? [...selection.nodeIds] : [...selection.elementIds];
                result = await client.op("update_set", args);
            }

            if (!result.ok) {
                toast.error(result.error);
                return;
            }
            this._close();
        } finally {
            this.applying = false;
        }
    }

    _cancel() {
        this._close();
    }

    _close() {
        if (current !== this) return;
        current = null;
        for (const unsub of this._unsubs) unsub();
        window.removeEventListener("keydown", this._onWindowKeyDown);
        window.removeEventListener("keyup", this._onWindowKeyUp);
        clearTimeout(this._syncTimer);
        highlight.clear();
        if (!this.legacy) {
            selectTool.exitMemberEdit();
            bus.emit("tool:changed", selectTool);
        }
        selection.replaceAll(this.savedSelection);
        this.host.innerHTML = "";
        this.onClose?.();
    }
}
