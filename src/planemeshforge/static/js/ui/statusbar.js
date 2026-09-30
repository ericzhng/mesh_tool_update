// Bottom status bar: live cursor coordinates, zoom level, mesh/selection
// counts, and the snap indicator. The floating tool-hint badge (top-left of
// the canvas) is built here too since it shares the same "reflect current
// tool/state" job.
import { bus } from "../core/events.js";
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { viewport } from "../render/viewport.js";

export function buildStatusBar(root, canvas, toolHintEl) {
    root.innerHTML = `
        <span id="status-cursor">x: -- y: --</span>
        <span class="divider"></span>
        <span id="status-zoom">zoom 100%</span>
        <span class="divider"></span>
        <span id="status-counts">0 nodes · 0 elements</span>
        <span class="divider"></span>
        <span id="status-selection"></span>
        <span class="divider"></span>
        <span id="status-snap"></span>
        <span class="spacer" style="flex:1"></span>
        <span id="status-message"></span>
    `;
    const cursorEl = root.querySelector("#status-cursor");
    const zoomEl = root.querySelector("#status-zoom");
    const countsEl = root.querySelector("#status-counts");
    const selectionEl = root.querySelector("#status-selection");
    const snapEl = root.querySelector("#status-snap");
    const messageEl = root.querySelector("#status-message");

    canvas.addEventListener("pointermove", e => {
        const rect = canvas.getBoundingClientRect();
        const world = viewport.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        cursorEl.textContent = `x: ${world.x.toFixed(3)}  y: ${world.y.toFixed(3)}`;
    });

    function refreshCounts() {
        const s = store.summary;
        countsEl.textContent = `${s.num_nodes} nodes · ${s.num_elements} elements · ${s.num_node_sets + s.num_element_sets + s.num_surface_sets} sets`;
    }

    function refreshSelection() {
        const n = selection.nodeIds.size;
        const e = selection.elementIds.size;
        selectionEl.textContent = n || e ? `${n} node${n === 1 ? "" : "s"}${e ? `, ${e} element${e === 1 ? "" : "s"}` : ""} selected` : "";
    }

    function refreshZoom() {
        zoomEl.textContent = `zoom ${Math.round(viewport.scale * 10)}%`;
    }

    function refreshSnap() {
        snapEl.textContent = viewport.snapToGrid ? `snap: grid (${viewport.gridSpacing})` : "";
    }

    bus.on("mesh:changed", () => { refreshCounts(); refreshSelection(); });
    bus.on("selection:changed", refreshSelection);
    bus.on("viewport:changed", () => { refreshZoom(); refreshSnap(); });

    bus.on("tool:changed", tool => {
        toolHintEl.innerHTML = tool ? `<span class="badge">${tool.label}${tool.hint ? ` — ${tool.hint}` : ""}</span>` : "";
    });

    refreshCounts();
    refreshSelection();
    refreshZoom();
    refreshSnap();

    return {
        showMessage(text, timeout = 4000) {
            messageEl.textContent = text;
            clearTimeout(messageEl._timer);
            messageEl._timer = setTimeout(() => (messageEl.textContent = ""), timeout);
        },
    };
}
