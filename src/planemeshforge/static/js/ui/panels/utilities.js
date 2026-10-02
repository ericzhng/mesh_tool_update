// The Utilities dock tab: snap settings, transforms, mesh cleanup tools,
// and the quality checker.
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { qualityOverlay, QualityLevel } from "../../core/quality-overlay.js";
import { viewport } from "../../render/viewport.js";
import { scheduleDraw } from "../../render/renderer.js";
import * as client from "../../net/client.js";
import { openDialog } from "../dialogs.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";

const MAX_FLAGGED_ROWS = 50;

function fmt(n) {
    return n == null ? "–" : n.toFixed(3);
}

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

    // ---- Quality metrics (skewness / aspect ratio) ----
    const metrics = section("Mesh Metrics");
    metrics.innerHTML += `
        <div class="btn-row metrics-actions">
            <button class="btn" id="metrics-compute">${icon("metrics")}Compute Metrics</button>
            <div class="checkbox-row"><input type="checkbox" id="metrics-highlight"><label for="metrics-highlight">Highlight in view</label></div>
        </div>
        <div class="field-row metrics-limit-row"><label>Skew warn / bad</label>
            <input type="number" class="metrics-limit-input" id="m-skew-warn" min="0" max="1" step="0.05" value="${qualityOverlay.limits.skewnessWarn}">
            <input type="number" class="metrics-limit-input" id="m-skew-bad" min="0" max="1" step="0.05" value="${qualityOverlay.limits.skewnessBad}">
        </div>
        <div class="field-row metrics-limit-row"><label>Aspect warn / bad</label>
            <input type="number" class="metrics-limit-input" id="m-aspect-warn" min="1" step="0.5" value="${qualityOverlay.limits.aspectRatioWarn}">
            <input type="number" class="metrics-limit-input" id="m-aspect-bad" min="1" step="0.5" value="${qualityOverlay.limits.aspectRatioBad}">
        </div>
        <div id="metrics-summary"></div>
        <div class="btn-row"><button class="btn" id="metrics-select-flagged">Select Flagged</button></div>
        <div id="metrics-results"></div>
    `;
    root.appendChild(metrics);

    const highlightCheckbox = metrics.querySelector("#metrics-highlight");
    highlightCheckbox.checked = qualityOverlay.enabled;

    function metricVal(selector) {
        return parseFloat(metrics.querySelector(selector).value);
    }

    function currentLimits() {
        return {
            skewnessWarn: metricVal("#m-skew-warn"),
            skewnessBad: metricVal("#m-skew-bad"),
            aspectRatioWarn: metricVal("#m-aspect-warn"),
            aspectRatioBad: metricVal("#m-aspect-bad"),
        };
    }

    // Flags a summary-table cell when the metric's max crosses a limit, so
    // the worst-case column reads at a glance instead of needing the raw
    // per-element list below.
    function cellClass(maxValue, warnLimit, badLimit) {
        if (maxValue == null) return "metrics-table-cell";
        if (maxValue >= badLimit) return "metrics-table-cell flagged bad";
        if (maxValue >= warnLimit) return "metrics-table-cell flagged";
        return "metrics-table-cell";
    }

    function renderMetrics() {
        const summaryEl = metrics.querySelector("#metrics-summary");
        const resultsEl = metrics.querySelector("#metrics-results");
        if (!qualityOverlay.elements.length) {
            summaryEl.innerHTML = `<div class="empty-hint">No metrics computed yet.</div>`;
            resultsEl.innerHTML = "";
            return;
        }

        const counts = { [QualityLevel.OK]: 0, [QualityLevel.WARN]: 0, [QualityLevel.BAD]: 0 };
        for (const level of qualityOverlay.levels.values()) counts[level]++;

        const limits = qualityOverlay.limits;
        const skew = qualityOverlay.summary.skewness;
        const aspect = qualityOverlay.summary.aspect_ratio;
        summaryEl.innerHTML = `
            <div class="metrics-table">
                <span class="metrics-table-head"></span>
                <span class="metrics-table-head">Min</span>
                <span class="metrics-table-head">Mean</span>
                <span class="metrics-table-head">Max</span>

                <span class="metrics-table-label">Skewness</span>
                <span class="metrics-table-cell">${fmt(skew?.min)}</span>
                <span class="metrics-table-cell">${fmt(skew?.mean)}</span>
                <span class="${cellClass(skew?.max, limits.skewnessWarn, limits.skewnessBad)}">${fmt(skew?.max)}</span>

                <span class="metrics-table-label">Aspect ratio</span>
                <span class="metrics-table-cell">${fmt(aspect?.min)}</span>
                <span class="metrics-table-cell">${fmt(aspect?.mean)}</span>
                <span class="${cellClass(aspect?.max, limits.aspectRatioWarn, limits.aspectRatioBad)}">${fmt(aspect?.max)}</span>
            </div>
            <div class="metrics-counts">
                <div class="metrics-badge ok"><strong>${counts.ok}</strong>ok</div>
                <div class="metrics-badge warn ${counts.warn ? "active" : ""}"><strong>${counts.warn}</strong>warn</div>
                <div class="metrics-badge bad ${counts.bad ? "active" : ""}"><strong>${counts.bad}</strong>bad</div>
            </div>
        `;

        const severity = e => Math.max(e.skewness / limits.skewnessBad, (e.aspect_ratio || 0) / limits.aspectRatioBad);
        const flagged = qualityOverlay.elements
            .filter(e => qualityOverlay.levels.get(e.id) !== QualityLevel.OK)
            .sort((a, b) => severity(b) - severity(a));

        resultsEl.innerHTML = "";
        if (!flagged.length) {
            resultsEl.innerHTML = `<div class="empty-hint">No skewed elements found.</div>`;
            return;
        }
        for (const elem of flagged.slice(0, MAX_FLAGGED_ROWS)) {
            const level = qualityOverlay.levels.get(elem.id);
            const skewOver = elem.skewness >= limits.skewnessWarn;
            const aspectOver = elem.aspect_ratio != null && elem.aspect_ratio >= limits.aspectRatioWarn;
            const row = document.createElement("div");
            row.className = `issue-row metrics-flagged-row ${level === QualityLevel.BAD ? "error" : "warning"}`;
            row.innerHTML = `
                <span class="metrics-flagged-id">#${elem.id} <span class="type">${elem.type}</span></span>
                <span class="metrics-flagged-values">
                    <span class="${skewOver ? "over" : ""}">skew ${fmt(elem.skewness)}</span>
                    <span class="${aspectOver ? "over" : ""}">aspect ${fmt(elem.aspect_ratio)}</span>
                </span>
            `;
            row.addEventListener("click", () => {
                selection.setElements([elem.id]);
                scheduleDraw();
            });
            resultsEl.appendChild(row);
        }
        if (flagged.length > MAX_FLAGGED_ROWS) {
            const more = document.createElement("div");
            more.className = "empty-hint";
            more.textContent = `+${flagged.length - MAX_FLAGGED_ROWS} more`;
            resultsEl.appendChild(more);
        }
    }

    metrics.querySelector("#metrics-compute").addEventListener("click", async () => {
        qualityOverlay.setLimits(currentLimits());
        const result = await qualityOverlay.compute();
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        renderMetrics();
    });

    for (const id of ["#m-skew-warn", "#m-skew-bad", "#m-aspect-warn", "#m-aspect-bad"]) {
        metrics.querySelector(id).addEventListener("change", () => {
            qualityOverlay.setLimits(currentLimits());
            renderMetrics();
        });
    }

    highlightCheckbox.addEventListener("change", async () => {
        await qualityOverlay.setEnabled(highlightCheckbox.checked);
        renderMetrics();
    });

    metrics.querySelector("#metrics-select-flagged").addEventListener("click", () => {
        const flaggedIds = qualityOverlay.flaggedIds();
        if (!flaggedIds.length) {
            toast.info("No flagged elements. Run Compute Metrics first.");
            return;
        }
        selection.setElements(flaggedIds);
        scheduleDraw();
    });

    renderMetrics();
}
