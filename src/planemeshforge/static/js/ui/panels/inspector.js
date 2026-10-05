// The Inspector dock tab: shows and edits whatever is currently selected -
// a single node's exact coordinates, a single element's connectivity, or a
// summary + bounding box for a larger selection.
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { boundingBox, signedArea } from "../../core/geometry.js";
import { qualityOverlay } from "../../core/quality-overlay.js";
import { viewport } from "../../render/viewport.js";
import * as client from "../../net/client.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";
import { createElementFromNodes } from "../../core/element-builder.js";

function fmtMetric(n) {
    return n == null ? "–" : n.toFixed(3);
}

// Metrics (skewness/aspect ratio) come from Utilities > Mesh Metrics, which
// computes them for the whole mesh at once. Selecting an element before
// that's run shouldn't just show nothing, so lazily trigger the same
// mesh-wide computation the quality tooltip uses - `quality:changed` then
// re-renders this panel with the real numbers once it resolves.
let computingMetrics = false;
function ensureMetricsComputed() {
    if (computingMetrics || qualityOverlay.elements.length) return;
    computingMetrics = true;
    qualityOverlay.compute().finally(() => (computingMetrics = false));
}

function section(title) {
    const el = document.createElement("div");
    el.className = "panel-section";
    if (title) el.innerHTML = `<h3>${title}</h3>`;
    return el;
}

function renderSingleNode(root, nodeId) {
    const node = store.node(nodeId);
    if (!node) return;

    const info = section("Node");
    info.innerHTML += `
        <div class="field-row"><label>ID</label><input type="text" value="${node.id}" disabled></div>
        <div class="field-row"><label>X</label><input type="number" id="node-x" value="${node.x}" step="0.01"></div>
        <div class="field-row"><label>Y</label><input type="number" id="node-y" value="${node.y}" step="0.01"></div>
    `;
    root.appendChild(info);

    async function commit() {
        const x = parseFloat(info.querySelector("#node-x").value);
        const y = parseFloat(info.querySelector("#node-y").value);
        if (Number.isNaN(x) || Number.isNaN(y)) return;
        const result = await client.op("move_nodes", { nodes: [{ id: node.id, x, y }] });
        if (!result.ok) toast.error(result.error);
    }
    info.querySelector("#node-x").addEventListener("change", commit);
    info.querySelector("#node-y").addEventListener("change", commit);

    const elementIds = store.elementsByNode.get(node.id) || [];
    const usage = section(`Used by ${elementIds.length} element(s)`);
    for (const eid of elementIds) {
        const element = store.element(eid);
        const row = document.createElement("div");
        row.className = "set-row";
        row.innerHTML = `<span class="set-name">#${eid} (${element.type})</span>`;
        row.style.cursor = "pointer";
        row.addEventListener("click", () => selection.setElements([eid]));
        usage.appendChild(row);
    }
    root.appendChild(usage);
}

function renderSingleElement(root, elementId) {
    const element = store.element(elementId);
    if (!element) return;

    const info = section("Element");
    const nodes = element.node_ids.map(id => store.node(id)).filter(Boolean);
    const area = nodes.length > 2 ? signedArea(nodes) : null;

    info.innerHTML += `
        <div class="field-row"><label>ID</label><input type="text" value="${element.id}" disabled></div>
        <div class="field-row"><label>Type</label><input type="text" value="${element.type}" disabled></div>
        ${area !== null ? `<div class="field-row"><label>Area</label><input type="text" value="${area.toFixed(4)}" disabled></div>` : ""}
    `;
    root.appendChild(info);

    const metrics = qualityOverlay.metricsFor(elementId);
    const limits = qualityOverlay.limits;
    const skewFlag = metrics != null && metrics.skewness >= limits.skewnessBad ? "flagged bad" : metrics != null && metrics.skewness >= limits.skewnessWarn ? "flagged" : "";
    const aspectBad = metrics?.aspect_ratio != null && metrics.aspect_ratio >= limits.aspectRatioBad;
    const aspectWarn = metrics?.aspect_ratio != null && metrics.aspect_ratio >= limits.aspectRatioWarn;
    const aspectFlag = aspectBad ? "flagged bad" : aspectWarn ? "flagged" : "";

    const quality = section("Quality");
    quality.innerHTML += `
        <div class="field-row"><label>Skew</label><input type="text" class="${skewFlag}" value="${fmtMetric(metrics?.skewness)}" disabled></div>
        <div class="field-row"><label>Aspect</label><input type="text" class="${aspectFlag}" value="${fmtMetric(metrics?.aspect_ratio)}" disabled></div>
    `;
    root.appendChild(quality);
    if (!metrics) ensureMetricsComputed();

    const nodesSection = section("Nodes");
    element.node_ids.forEach(nid => {
        const row = document.createElement("div");
        row.className = "set-row";
        row.innerHTML = `<span class="set-name">#${nid}</span>`;
        row.style.cursor = "pointer";
        row.addEventListener("click", () => selection.setNodes([nid]));
        nodesSection.appendChild(row);
    });
    root.appendChild(nodesSection);
}

function renderMultiSelection(root) {
    const nodeIds = [...selection.nodeIds];
    const elementIds = [...selection.elementIds];
    const info = section("Selection");

    const count = document.createElement("div");
    count.className = "empty-hint";
    count.textContent = `${nodeIds.length} node(s), ${elementIds.length} element(s) selected`;
    info.appendChild(count);

    if (nodeIds.length > 1) {
        const points = nodeIds.map(id => store.node(id)).filter(Boolean);
        const bbox = boundingBox(points);
        const bboxRow = document.createElement("div");
        bboxRow.className = "empty-hint";
        bboxRow.textContent = `bbox: (${bbox.minX.toFixed(3)}, ${bbox.minY.toFixed(3)}) → (${bbox.maxX.toFixed(3)}, ${bbox.maxY.toFixed(3)})`;
        info.appendChild(bboxRow);
    }

    const canCreateElement = !elementIds.length && (nodeIds.length === 3 || nodeIds.length === 4);

    const actions = document.createElement("div");
    actions.className = "btn-row";
    actions.innerHTML = `
        ${canCreateElement ? `<button class="btn" id="create-element-from-selection">${icon("quad")}Create Element</button>` : ""}
        <button class="btn btn-danger" id="delete-selection">${icon("trash")}Delete</button>
    `;
    info.appendChild(actions);
    if (canCreateElement) {
        actions.querySelector("#create-element-from-selection").addEventListener("click", async () => {
            const result = await createElementFromNodes(nodeIds);
            if (result.ok) selection.clear();
        });
    }
    actions.querySelector("#delete-selection").addEventListener("click", async () => {
        if (nodeIds.length) await client.op("delete_nodes", { ids: nodeIds });
        if (elementIds.length) await client.op("delete_elements", { ids: elementIds });
        selection.clear();
    });

    root.appendChild(info);
}

// With nothing selected, show the model-space size of the current view
// instead of just the empty-selection hint - the canvas's own pixel size
// isn't very useful since it's just the window, but width/scale and
// height/scale is how big a model-space rectangle is actually visible.
function renderNothingSelected(root) {
    root.innerHTML = `<div class="empty-hint">Nothing selected. Click a node or element on the canvas.</div>`;

    if (store.mesh.nodes.length) {
        const mesh = section("Mesh");
        mesh.innerHTML += `
            <div class="field-row"><label>Nodes</label><input type="text" value="${store.summary.num_nodes}" disabled></div>
            <div class="field-row"><label>Elements</label><input type="text" value="${store.summary.num_elements}" disabled></div>
        `;
        root.appendChild(mesh);
    }

    const view = section("View");
    const widthWorld = viewport.width / viewport.scale;
    const heightWorld = viewport.height / viewport.scale;
    view.innerHTML += `
        <div class="field-row"><label>Width</label><input type="text" value="${widthWorld.toFixed(1)}" disabled></div>
        <div class="field-row"><label>Height</label><input type="text" value="${heightWorld.toFixed(1)}" disabled></div>
    `;
    root.appendChild(view);
}

export function buildInspectorPanel(root) {
    function render() {
        root.innerHTML = "";
        const nodeCount = selection.nodeIds.size;
        const elementCount = selection.elementIds.size;

        if (nodeCount === 0 && elementCount === 0) {
            renderNothingSelected(root);
            return;
        }
        if (nodeCount === 1 && elementCount === 0) {
            renderSingleNode(root, [...selection.nodeIds][0]);
            return;
        }
        if (elementCount === 1 && nodeCount === 0) {
            renderSingleElement(root, [...selection.elementIds][0]);
            return;
        }
        renderMultiSelection(root);
    }

    bus.on("selection:changed", render);
    bus.on("mesh:changed", render);
    bus.on("quality:changed", render);
    // Only matters while nothing's selected (renderNothingSelected is the
    // only state that reads viewport size/scale), but pan/zoom/resize fire
    // this constantly, so re-rendering is cheap by construction either way.
    bus.on("viewport:changed", render);
    render();
}
