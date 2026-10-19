// The Utilities dock tab: snap settings, transforms, mesh cleanup tools,
// and the quality checker.
import { bus } from "../../core/events.js";
import { store } from "../../core/store.js";
import { selection } from "../../core/selection.js";
import { qualityOverlay, QualityLevel } from "../../core/quality-overlay.js";
import { viewport } from "../../render/viewport.js";
import { scheduleDraw } from "../../render/renderer.js";
import * as client from "../../net/client.js";
import { openDialog } from "../dialogs.js";
import { toast } from "../toast.js";
import { icon } from "../icons.js";

// Flagged elements are grouped by severity (Bad/Warn), each a collapsible
// disclosure like the Sets panel's groups, with only the first REVEAL_STEP
// rows of each shown at a time - "Show N more"/"Show all" progressively
// reveals the rest, the same truncate-then-expand pattern long result
// lists use elsewhere (log viewers, workspace/variable browsers, etc.) so
// a mesh with hundreds of bad elements doesn't turn into one giant list.
const REVEAL_STEP = 10;

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
    // Scopes the section-divider/tool-group CSS to this panel so the
    // generic `.panel-section` look used by Inspector/Sets stays untouched.
    const panel = document.createElement("div");
    panel.className = "utilities-panel";
    root.appendChild(panel);

    // How many of each severity group's flagged elements are currently
    // revealed, and whether each group is expanded - both survive
    // `renderMetrics()` re-renders (e.g. toggling Highlight) the same way
    // the Sets panel's `openGroups` survives its own re-renders; a fresh
    // "Compute Metrics" resets them back to the collapsed default.
    const flaggedOpen = { [QualityLevel.BAD]: true, [QualityLevel.WARN]: true };
    const flaggedRevealed = { [QualityLevel.BAD]: REVEAL_STEP, [QualityLevel.WARN]: REVEAL_STEP };
    root = panel;

    // Ordered by how often each is reached for: shaping the selection
    // (Transform) and cleaning up the mesh (Tools/Quality/Metrics) are
    // everyday actions; Snap is a set-once editing aid, so it's last.

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
    // Split into "Cleanup" (fix up what's already there) and "Generate"
    // (create new elements from the selection) - the four buttons used to
    // run together in one row with no indication of which do which.
    const tools = section("Mesh Tools");
    tools.innerHTML += `
        <div class="tool-group">
            <div class="tool-group-label">Cleanup</div>
            <div class="btn-row" style="flex-wrap:wrap">
                <button class="btn" id="tool-merge">${icon("merge")}Merge Coincident Nodes</button>
                <button class="btn" id="tool-renumber">${icon("rename")}Renumber IDs</button>
            </div>
        </div>
        <div class="tool-group">
            <div class="tool-group-label">Generate</div>
            <div class="btn-row" style="flex-wrap:wrap">
                <button class="btn" id="tool-split">${icon("quad")}Split Selected Quads</button>
                <button class="btn" id="tool-triangulate">${icon("triangle")}Triangulate Selected Nodes</button>
            </div>
        </div>
    `;
    root.appendChild(tools);

    tools.querySelector("#tool-merge").addEventListener("click", async () => {
        const values = await openDialog({
            title: "Merge Coincident Nodes",
            fields: [{ name: "tolerance", label: "Tolerance", type: "number", default: 1e-6, step: "0.0001" }],
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
    // No "Fix Element Winding" button here: MeshEditor.apply() now runs
    // topo.orient_ccw() after every op (and MeshEditor.set_mesh() on every
    // load/import), so winding is corrected automatically and a manual fix
    // would always find nothing to do. The fix_orientation op itself still
    // exists server-side (tests/test_ops.py exercises it directly).
    const quality = section("Mesh Quality");
    quality.innerHTML += `<div class="btn-row">
            <button class="btn" id="tool-check">${icon("check-list")}Run Quality Check</button>
        </div><div id="quality-results"></div>`;
    root.appendChild(quality);

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
            <div class="checkbox-row"><input type="checkbox" id="metrics-highlight"><label for="metrics-highlight" title="Highlight flagged elements in the viewport">Highlight</label></div>
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
        <div class="btn-row">
            <button class="btn" id="metrics-select-warn">Select Warn</button>
            <button class="btn" id="metrics-select-bad">Select Bad</button>
        </div>
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

        // Order matches severity: worst group first. Each is its own
        // collapsible section (sorted-by-severity filter preserves order),
        // so "Bad" and "Warn" can be expanded/collapsed independently.
        renderFlaggedGroup(resultsEl, QualityLevel.BAD, "Bad", flagged.filter(e => qualityOverlay.levels.get(e.id) === QualityLevel.BAD), limits);
        renderFlaggedGroup(resultsEl, QualityLevel.WARN, "Warn", flagged.filter(e => qualityOverlay.levels.get(e.id) === QualityLevel.WARN), limits);
    }

    function renderFlaggedGroup(container, level, label, elements, limits) {
        if (!elements.length) return;

        const details = document.createElement("details");
        details.className = "set-group";
        details.open = flaggedOpen[level];
        details.innerHTML = `<summary>${label} (${elements.length})</summary>`;
        details.addEventListener("toggle", () => {
            flaggedOpen[level] = details.open;
        });

        const shownCount = Math.min(flaggedRevealed[level], elements.length);
        for (const elem of elements.slice(0, shownCount)) {
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
            details.appendChild(row);
        }

        const remaining = elements.length - shownCount;
        if (remaining > 0) {
            const revealRow = document.createElement("div");
            revealRow.className = "flagged-reveal-row";

            const moreBtn = document.createElement("button");
            moreBtn.className = "btn-link";
            moreBtn.textContent = `Show ${Math.min(REVEAL_STEP, remaining)} more`;
            moreBtn.addEventListener("click", () => {
                flaggedRevealed[level] = shownCount + REVEAL_STEP;
                renderMetrics();
            });
            revealRow.appendChild(moreBtn);

            if (remaining > REVEAL_STEP) {
                const allBtn = document.createElement("button");
                allBtn.className = "btn-link";
                allBtn.textContent = `Show all (${elements.length})`;
                allBtn.addEventListener("click", () => {
                    flaggedRevealed[level] = elements.length;
                    renderMetrics();
                });
                revealRow.appendChild(allBtn);
            }
            details.appendChild(revealRow);
        } else if (shownCount > REVEAL_STEP) {
            const revealRow = document.createElement("div");
            revealRow.className = "flagged-reveal-row";
            const lessBtn = document.createElement("button");
            lessBtn.className = "btn-link";
            lessBtn.textContent = "Show less";
            lessBtn.addEventListener("click", () => {
                flaggedRevealed[level] = REVEAL_STEP;
                renderMetrics();
            });
            revealRow.appendChild(lessBtn);
            details.appendChild(revealRow);
        }

        container.appendChild(details);
    }

    function resetFlaggedReveal() {
        flaggedRevealed[QualityLevel.BAD] = REVEAL_STEP;
        flaggedRevealed[QualityLevel.WARN] = REVEAL_STEP;
    }

    metrics.querySelector("#metrics-compute").addEventListener("click", async () => {
        qualityOverlay.setLimits(currentLimits());
        const result = await qualityOverlay.compute();
        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        resetFlaggedReveal();
        renderMetrics();
    });

    for (const id of ["#m-skew-warn", "#m-skew-bad", "#m-aspect-warn", "#m-aspect-bad"]) {
        metrics.querySelector(id).addEventListener("change", () => {
            qualityOverlay.setLimits(currentLimits());
            resetFlaggedReveal();
            renderMetrics();
        });
    }

    highlightCheckbox.addEventListener("change", () => {
        qualityOverlay.setEnabled(highlightCheckbox.checked);
        renderMetrics();
    });

    function selectByLevel(level, label) {
        const ids = qualityOverlay.flaggedIds(level);
        if (!ids.length) {
            toast.info(`No ${label} elements. Run Compute Metrics first.`);
            return;
        }
        selection.setElements(ids);
        scheduleDraw();
    }

    metrics.querySelector("#metrics-select-warn").addEventListener("click", () => {
        selectByLevel(QualityLevel.WARN, "warn");
    });
    metrics.querySelector("#metrics-select-bad").addEventListener("click", () => {
        selectByLevel(QualityLevel.BAD, "bad");
    });

    renderMetrics();

    // ---- Improve Mesh (automated smoothing recipes) ----
    // Runs server-side as a single undoable op (core/improve/pipeline.py);
    // "Flagged" reuses the Warn thresholds set above in Mesh Metrics so the
    // two sections stay in sync without a separate set of limits here.
    const improve = section("Improve Mesh");
    improve.innerHTML += `
        <div class="field-row"><label>Scope</label>
            <select id="improve-scope">
                <option value="all">All elements</option>
                <option value="selection">Selection</option>
                <option value="flagged">Flagged (warn+)</option>
            </select>
        </div>
        <div class="field-row"><label>Grow rings</label>
            <input type="number" id="improve-rings" min="0" step="1" value="0">
        </div>
        <div class="field-row"><label>Preset</label>
            <select id="improve-preset">
                <option value="gentle">Gentle (smooth only)</option>
                <option value="balanced" selected>Balanced (merge + smooth)</option>
                <option value="aggressive">Aggressive (+ split slivers)</option>
            </select>
        </div>
        <div class="checkbox-row"><input type="checkbox" id="improve-lock-surfaces"><label for="improve-lock-surfaces" title="A *SURFACE reference is topological (element + face), not a position - leave this off unless a surface's exact geometry must stay fixed.">Preserve surface-set geometry</label></div>
        <div class="btn-row">
            <button class="btn btn-primary" id="improve-run">${icon("improve")}Run</button>
            <span id="improve-status" class="improve-status"></span>
        </div>
        <div id="improve-log" class="improve-log"></div>
        <div id="improve-results"></div>
    `;
    root.appendChild(improve);

    function improveScopeArg() {
        const mode = improve.querySelector("#improve-scope").value;
        const grow_rings = parseInt(improve.querySelector("#improve-rings").value, 10) || 0;
        const lock_surface_sets = improve.querySelector("#improve-lock-surfaces").checked;
        if (mode === "selection") {
            const element_ids = [...selection.elementIds];
            if (!element_ids.length) return { error: "Select one or more elements first." };
            return { scope: { mode: "elements", element_ids, grow_rings, lock_surface_sets } };
        }
        if (mode === "flagged") {
            return {
                scope: {
                    mode: "flagged",
                    grow_rings,
                    lock_surface_sets,
                    limits: { skewness: qualityOverlay.limits.skewnessWarn, aspect_ratio: qualityOverlay.limits.aspectRatioWarn },
                },
            };
        }
        return { scope: { mode: "all", grow_rings, lock_surface_sets } };
    }

    function delta(before, after) {
        return before == null || after == null ? null : after - before;
    }

    function deltaClass(d) {
        if (d == null || Math.abs(d) < 1e-9) return "metrics-table-cell";
        return d < 0 ? "metrics-table-cell improved" : "metrics-table-cell worsened";
    }

    function improveRow(label, before, after) {
        const d = delta(before, after);
        return `<span class="metrics-table-label">${label}</span>
            <span class="metrics-table-cell">${fmt(before)}</span>
            <span class="metrics-table-cell">${fmt(after)}</span>
            <span class="${deltaClass(d)}">${d == null ? "–" : (d > 0 ? "+" : "") + d.toFixed(3)}</span>`;
    }

    function renderImproveResult(result) {
        const resultsEl = improve.querySelector("#improve-results");
        const skewBefore = result.before.skewness, skewAfter = result.after.skewness;
        const aspectBefore = result.before.aspect_ratio, aspectAfter = result.after.aspect_ratio;
        const movedCount = result.steps
            .filter(s => s.op === "smooth_nodes")
            .reduce((sum, s) => sum + (s.result.moved_node_ids?.length || 0), 0);
        const flippedCount = result.steps
            .filter(s => s.op === "flip_edges")
            .reduce((sum, s) => sum + (s.result.flip_count || 0), 0);
        const splitCount = result.steps
            .filter(s => s.op === "refine_slivers")
            .reduce((sum, s) => sum + (s.result.created_element_ids?.length || 0), 0);

        const parts = [`Ran ${result.steps.length} step(s).`, `Moved ${movedCount} node(s).`];
        if (flippedCount) parts.push(`Flipped ${flippedCount} edge(s).`);
        if (splitCount) parts.push(`Split in ${splitCount} new element(s).`);

        resultsEl.innerHTML = `
            <div class="empty-hint">${parts.join(" ")}</div>
            <div class="metrics-table">
                <span class="metrics-table-head"></span>
                <span class="metrics-table-head">Before</span>
                <span class="metrics-table-head">After</span>
                <span class="metrics-table-head">Δ</span>
                ${improveRow("Skew mean", skewBefore?.mean, skewAfter?.mean)}
                ${improveRow("Skew max", skewBefore?.max, skewAfter?.max)}
                ${improveRow("Aspect mean", aspectBefore?.mean, aspectAfter?.mean)}
                ${improveRow("Aspect max", aspectBefore?.max, aspectAfter?.max)}
            </div>
        `;
    }

    function appendImproveLogRow(text) {
        const logEl = improve.querySelector("#improve-log");
        const row = document.createElement("div");
        row.className = "improve-log-row";
        row.textContent = text;
        logEl.appendChild(row);
        logEl.scrollTop = logEl.scrollHeight;
    }

    improve.querySelector("#improve-run").addEventListener("click", async () => {
        const scopeArg = improveScopeArg();
        if (scopeArg.error) {
            toast.info(scopeArg.error);
            return;
        }
        const preset = improve.querySelector("#improve-preset").value;
        const runButton = improve.querySelector("#improve-run");
        const statusEl = improve.querySelector("#improve-status");
        improve.querySelector("#improve-log").innerHTML = "";
        improve.querySelector("#improve-results").innerHTML = "";

        // Some presets (especially Aggressive, on a large real-world mesh)
        // genuinely take several seconds - without this, clicking Run
        // looked identical to nothing happening at all.
        runButton.disabled = true;
        const startedAt = performance.now();
        const tick = () => { statusEl.textContent = `Running… ${((performance.now() - startedAt) / 1000).toFixed(1)}s`; };
        tick();
        const elapsedTimer = setInterval(tick, 200);
        const unsubscribe = client.onImproveProgress(info => {
            const skewMax = info.after?.skewness?.max;
            appendImproveLogRow(`Step ${info.step}/${info.total_steps}: ${info.op}${skewMax != null ? ` - skew max ${fmt(skewMax)}` : ""}`);
        });

        try {
            const result = await client.op("improve_quality", { preset, ...scopeArg });
            if (!result.ok) {
                toast.error(result.error);
                return;
            }
            renderImproveResult(result);
        } finally {
            clearInterval(elapsedTimer);
            statusEl.textContent = "";
            unsubscribe();
            runButton.disabled = false;
        }
    });

    // ---- Display ----
    // 1D elements (e.g. SFMGAX1) render as a plain line - the same style
    // used for a 2D element's border - so they're easy to mistake for a
    // real edge. This just toggles whether they're drawn at all.
    const display = section("Display");
    display.innerHTML += `
        <div class="checkbox-row"><input type="checkbox" id="show-line-elements"><label for="show-line-elements">Show 1D elements</label></div>
    `;
    root.appendChild(display);
    const lineElementsCheckbox = display.querySelector("#show-line-elements");
    lineElementsCheckbox.checked = viewport.showLineElements;
    lineElementsCheckbox.addEventListener("change", () => {
        viewport.showLineElements = lineElementsCheckbox.checked;
        scheduleDraw();
    });

    // ---- Snap & Grid ----
    const snap = section("Snap & Grid");
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
    spacingInput.addEventListener("change", () => {
        viewport.gridSpacing = parseFloat(spacingInput.value) || 1;
        // gridSpacing isn't part of pan/zoom, so nothing else schedules a
        // redraw or tells the scale bar/status bar to refresh - without
        // this the grid lines and scale bar would silently show the old
        // spacing until the next pan/zoom.
        bus.emit("viewport:changed", viewport);
        scheduleDraw();
    });
    nodeCheckbox.addEventListener("change", () => (viewport.snapToNode = nodeCheckbox.checked));
}
