// The Utilities dock tab: snap settings, transforms, mesh cleanup tools,
// and the quality checker.
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { viewport } from "../../render/viewport.js";
import { scheduleDraw } from "../../render/renderer.js";
import * as client from "../../net/client.js";
import { openDialog } from "../dialogs.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";

function section(title) {
    const el = document.createElement("div");
    el.className = "panel-section";
    el.innerHTML = `<h3>${title}</h3>`;
    return el;
}

function selectedNodeIds() {
    return [...selection.nodeIds];
}

export function buildUtilitiesPanel(root) {
    root.innerHTML = "";

    // ---- Snap ----
    const snap = section("Snap");
    snap.innerHTML += `
        <div class="checkbox-row"><input type="checkbox" id="snap-grid"><label for="snap-grid">Snap to grid</label></div>
        <div class="field-row"><label>Spacing</label><input type="number" id="snap-spacing" min="0.001" step="0.1" value="${viewport.gridSpacing}"></div>
        <div class="checkbox-row"><input type="checkbox" id="snap-node"><label for="snap-node">Snap to node (single drag)</label></div>
    `;
    root.appendChild(snap);
    const gridCheckbox = snap.querySelector("#snap-grid");
    const spacingInput = snap.querySelector("#snap-spacing");
    const nodeCheckbox = snap.querySelector("#snap-node");
    gridCheckbox.checked = viewport.snapToGrid;
    nodeCheckbox.checked = viewport.snapToNode;
    gridCheckbox.addEventListener("change", () => (viewport.snapToGrid = gridCheckbox.checked));
    spacingInput.addEventListener("change", () => (viewport.gridSpacing = parseFloat(spacingInput.value) || 1));
    nodeCheckbox.addEventListener("change", () => (viewport.snapToNode = nodeCheckbox.checked));

    // ---- Transform ----
    const transform = section("Transform Selected Nodes");
    transform.innerHTML += `
        <div class="field-row"><label>Kind</label>
            <select id="xform-kind">
                <option value="translate">Translate</option>
                <option value="rotate">Rotate</option>
                <option value="scale">Scale</option>
                <option value="mirror">Mirror</option>
            </select>
        </div>
        <div id="xform-fields"></div>
        <div class="btn-row"><button class="btn btn-primary" id="xform-apply">${icon("transform")}Apply</button></div>
    `;
    root.appendChild(transform);
    const kindSelect = transform.querySelector("#xform-kind");
    const fieldsEl = transform.querySelector("#xform-fields");

    function renderFields() {
        const kind = kindSelect.value;
        if (kind === "translate") {
            fieldsEl.innerHTML = `<div class="field-row"><label>dx</label><input type="number" id="f-dx" value="1" step="0.1"></div>
                <div class="field-row"><label>dy</label><input type="number" id="f-dy" value="0" step="0.1"></div>`;
        } else if (kind === "rotate") {
            fieldsEl.innerHTML = `<div class="field-row"><label>angle °</label><input type="number" id="f-angle" value="90" step="1"></div>`;
        } else if (kind === "scale") {
            fieldsEl.innerHTML = `<div class="field-row"><label>factor x</label><input type="number" id="f-fx" value="1" step="0.1"></div>
                <div class="field-row"><label>factor y</label><input type="number" id="f-fy" value="1" step="0.1"></div>`;
        } else {
            fieldsEl.innerHTML = `<div class="field-row"><label>axis</label>
                <select id="f-axis"><option value="x">Horizontal (about X)</option><option value="y">Vertical (about Y)</option></select>
            </div>`;
        }
    }
    kindSelect.addEventListener("change", renderFields);
    renderFields();

    transform.querySelector("#xform-apply").addEventListener("click", async () => {
        const nodeIds = selectedNodeIds();
        if (!nodeIds.length) {
            toast.info("Select one or more nodes first.");
            return;
        }
        const kind = kindSelect.value;
        let params = {};
        if (kind === "translate") params = { dx: val("#f-dx"), dy: val("#f-dy") };
        else if (kind === "rotate") params = { angle_deg: val("#f-angle") };
        else if (kind === "scale") params = { factor_x: val("#f-fx"), factor_y: val("#f-fy") };
        else params = { axis: transform.querySelector("#f-axis").value };

        const result = await client.op("transform", { node_ids: nodeIds, kind, params });
        if (!result.ok) toast.error(result.error);
    });

    function val(selector) {
        return parseFloat(transform.querySelector(selector).value);
    }

    // ---- Mesh tools ----
    const tools = section("Mesh Tools");
    tools.innerHTML += `
        <div class="btn-row" style="flex-wrap:wrap">
            <button class="btn" id="tool-merge">${icon("merge")}Merge Coincident Nodes</button>
            <button class="btn" id="tool-renumber">Renumber IDs</button>
            <button class="btn" id="tool-split">Split Selected Quads</button>
            <button class="btn" id="tool-triangulate">Triangulate Selected Nodes</button>
        </div>
    `;
    root.appendChild(tools);

    tools.querySelector("#tool-merge").addEventListener("click", async () => {
        const values = await openDialog({
            title: "Merge Coincident Nodes",
            fields: [{ name: "tolerance", label: "Tolerance", type: "number", default: 1e-6, step: "0.000001" }],
            submitLabel: "Merge",
        });
        if (!values) return;
        const ids = selectedNodeIds();
        const result = await client.op("merge_nodes", { ids: ids.length ? ids : null, tolerance: values.tolerance });
        if (result.ok) toast.success(`Merged ${Object.keys(result.merged || {}).length} node(s).`);
        else toast.error(result.error);
    });

    tools.querySelector("#tool-renumber").addEventListener("click", async () => {
        const values = await openDialog({
            title: "Renumber IDs",
            fields: [{ name: "start", label: "Start at", type: "number", default: 1, step: "1" }],
            submitLabel: "Renumber",
        });
        if (!values) return;
        const result = await client.op("renumber", { start: Math.round(values.start) });
        if (!result.ok) toast.error(result.error);
    });

    tools.querySelector("#tool-split").addEventListener("click", async () => {
        const ids = [...selection.elementIds].filter(id => store.element(id)?.type === "CGAX4");
        if (!ids.length) {
            toast.info("Select one or more quad (CGAX4) elements first.");
            return;
        }
        const result = await client.op("split_quads", { element_ids: ids });
        if (!result.ok) toast.error(result.error);
    });

    tools.querySelector("#tool-triangulate").addEventListener("click", async () => {
        const ids = selectedNodeIds();
        if (ids.length < 3) {
            toast.info("Select at least 3 nodes to triangulate.");
            return;
        }
        const nodes = ids.map(id => store.node(id));
        const delaunay = Delaunator.from(nodes, n => n.x, n => n.y);
        const triangles = [];
        for (let i = 0; i < delaunay.triangles.length; i += 3) {
            triangles.push([
                nodes[delaunay.triangles[i]].id,
                nodes[delaunay.triangles[i + 1]].id,
                nodes[delaunay.triangles[i + 2]].id,
            ]);
        }
        const result = await client.op("triangulate", { triangles });
        if (result.ok) toast.success(`Created ${triangles.length} triangle(s).`);
        else toast.error(result.error);
    });

    // ---- Quality ----
    const quality = section("Mesh Quality");
    quality.innerHTML += `<div class="btn-row">
            <button class="btn" id="tool-check">${icon("check-list")}Run Quality Check</button>
            <button class="btn" id="tool-fix-winding">${icon("rotate-ccw")}Fix Element Winding</button>
        </div><div id="quality-results"></div>`;
    root.appendChild(quality);

    quality.querySelector("#tool-fix-winding").addEventListener("click", async () => {
        const result = await client.op("fix_orientation", {});
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        const n = (result.reversed_ids || []).length;
        toast[n ? "success" : "info"](n ? `Fixed node winding on ${n} element(s).` : "No inverted elements found.");
    });

    quality.querySelector("#tool-check").addEventListener("click", async () => {
        const result = await client.qualityCheck();
        const resultsEl = quality.querySelector("#quality-results");
        resultsEl.innerHTML = "";
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        if (!result.issues.length) {
            resultsEl.innerHTML = `<div class="empty-hint">No issues found.</div>`;
            return;
        }
        for (const issue of result.issues) {
            const row = document.createElement("div");
            row.className = `issue-row ${issue.severity}`;
            row.textContent = issue.message;
            row.addEventListener("click", () => {
                if (issue.node_ids?.length) selection.setNodes(issue.node_ids);
                else if (issue.element_id) selection.setElements([issue.element_id]);
                scheduleDraw();
            });
            resultsEl.appendChild(row);
        }
    });
}
