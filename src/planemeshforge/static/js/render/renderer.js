// Draws the whole scene, back to front: grid, elements, set highlights,
// nodes, labels, selection box, then whatever overlay the active tool wants
// (drag preview, rubber-band box, in-progress element). Rendering never
// mutates store/selection - it only reads them.
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { viewport } from "./viewport.js";

const LABEL_SCALE_THRESHOLD = 18;
let toolOverlayFn = null;
let scheduled = false;

export function setToolOverlay(fn) {
    toolOverlayFn = fn;
}

export function scheduleDraw() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        draw();
    });
}

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawGrid(ctx) {
    const spacing = viewport.gridSpacing || 1;
    let pixelSpacing = spacing * viewport.scale;
    while (pixelSpacing < 20) pixelSpacing *= 2;
    while (pixelSpacing > 160) pixelSpacing /= 2;

    ctx.save();
    ctx.strokeStyle = cssVar("--grid-line");
    ctx.lineWidth = 1;
    const startX = viewport.offsetX % pixelSpacing;
    for (let x = startX; x < viewport.width; x += pixelSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, viewport.height);
        ctx.stroke();
    }
    const startY = viewport.offsetY % pixelSpacing;
    for (let y = startY; y < viewport.height; y += pixelSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(viewport.width, y);
        ctx.stroke();
    }

    // Axes, slightly stronger.
    ctx.strokeStyle = cssVar("--grid-line-strong");
    const origin = viewport.toScreen({ x: 0, y: 0 });
    ctx.beginPath();
    ctx.moveTo(0, origin.y);
    ctx.lineTo(viewport.width, origin.y);
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, viewport.height);
    ctx.stroke();
    ctx.restore();
}

function elementPolygon(element) {
    return element.node_ids.map(id => store.node(id)).filter(Boolean);
}

function drawElements(ctx) {
    ctx.save();
    for (const element of store.mesh.elements) {
        if (!store.isElementVisible(element.id)) continue;
        const nodes = elementPolygon(element);
        if (nodes.length < 2) continue;
        const screenPts = nodes.map(n => viewport.toScreen(n));
        const isSelected = selection.elementIds.has(element.id);

        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
        if (screenPts.length > 2) ctx.closePath();

        if (screenPts.length > 2) {
            ctx.fillStyle = isSelected ? cssVar("--bg-selected") : cssVar("--element-fill");
            ctx.fill();
        }
        ctx.strokeStyle = isSelected ? cssVar("--accent") : cssVar("--element-stroke");
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        if (viewport.showElementLabels && viewport.scale >= LABEL_SCALE_THRESHOLD) {
            const cx = screenPts.reduce((s, p) => s + p.x, 0) / screenPts.length;
            const cy = screenPts.reduce((s, p) => s + p.y, 0) / screenPts.length;
            ctx.fillStyle = cssVar("--text-secondary");
            ctx.font = "11px var(--font-mono)";
            ctx.textAlign = "center";
            ctx.fillText(`#${element.id}`, cx, cy);
        }
    }
    ctx.restore();
}

function drawNodes(ctx) {
    ctx.save();
    const radius = Math.max(2.5, Math.min(6, viewport.scale * 0.12));
    for (const node of store.mesh.nodes) {
        if (!store.isNodeVisible(node.id)) continue;
        const p = viewport.toScreen(node);
        const isSelected = selection.nodeIds.has(node.id);

        ctx.beginPath();
        ctx.arc(p.x, p.y, isSelected ? radius + 1.5 : radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? cssVar("--node-selected") : cssVar("--node-color");
        ctx.fill();

        if (viewport.showNodeLabels && viewport.scale >= LABEL_SCALE_THRESHOLD) {
            ctx.fillStyle = cssVar("--text-primary");
            ctx.font = "11px var(--font-mono)";
            ctx.textAlign = "left";
            ctx.fillText(`${node.id}`, p.x + radius + 3, p.y - radius);
        }
    }
    ctx.restore();
}

export function draw() {
    const ctx = viewport.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    drawGrid(ctx);
    drawElements(ctx);
    drawNodes(ctx);
    if (toolOverlayFn) toolOverlayFn(ctx);
}
