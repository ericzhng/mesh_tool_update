// Draws the whole scene, back to front: grid, elements, set highlights,
// nodes, labels, selection box, then whatever overlay the active tool wants
// (drag preview, rubber-band box, in-progress element). Rendering never
// mutates store/selection - it only reads them.
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { hover } from "../core/hover.js";
import { qualityOverlay, QualityLevel } from "../core/quality-overlay.js";
import { viewport } from "./viewport.js";
import { EntityState, cssVar, nodeStyle, elementStyle, edgeFaceStyle } from "./entity-styles.js";

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

function drawGrid(ctx) {
    const { pixels: pixelSpacing } = viewport.gridStep();

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

function drawElement(ctx, element, state) {
    const nodes = elementPolygon(element);
    if (nodes.length < 2) return;
    const screenPts = nodes.map(n => viewport.toScreen(n));
    const style = elementStyle(state);

    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
    if (screenPts.length > 2) ctx.closePath();

    if (screenPts.length > 2) {
        ctx.fillStyle = style.fill;
        ctx.fill();
    }
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
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

// Hovered/selected elements are drawn in a second pass, after every default-
// state element, so a neighbor's plain border never paints back over the
// highlighted outline - canvas draw order is paint order, so whichever
// element is drawn last for a shared edge wins visually.
function drawElements(ctx) {
    ctx.save();
    let hovered = null;
    const selected = [];
    for (const element of store.mesh.elements) {
        if (!store.isElementVisible(element.id)) continue;
        const isSelected = selection.elementIds.has(element.id);
        const isHovered = !isSelected && hover.elementId === element.id;
        if (isSelected) {
            selected.push(element);
            continue;
        }
        if (isHovered) {
            hovered = element;
            continue;
        }
        const qualityLevel = qualityOverlay.levelOf(element.id);
        let state = EntityState.DEFAULT;
        if (qualityLevel === QualityLevel.BAD) state = EntityState.QUALITY_BAD;
        else if (qualityLevel === QualityLevel.WARN) state = EntityState.QUALITY_WARN;
        drawElement(ctx, element, state);
    }
    if (hovered) drawElement(ctx, hovered, EntityState.HOVER);
    for (const element of selected) drawElement(ctx, element, EntityState.SELECTED);
    ctx.restore();
}

function drawEdge(ctx, edge, style) {
    const a = store.node(edge.a);
    const b = store.node(edge.b);
    if (!a || !b) return;
    const pa = viewport.toScreen(a);
    const pb = viewport.toScreen(b);
    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dashed ? [7, 6] : []);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.setLineDash([]);
}

// Every pickable element face (boundary or internal - "surfaces") is always
// visible so users always know where they can be picked - not only while
// the Select Surface tool is active. Hovered and selected edges draw over
// the default pass in bolder styles, in that order, so selection always
// wins visually. A surface set's own hide/isolate only ever affects this
// pass, never the owning element's rendering in `drawElements`. Hiding a
// set draws its edges dim/dashed (`EntityState.GHOST`) rather than
// vanishing, since the element's own border would otherwise retrace the
// exact same line and make the hide toggle look like it did nothing.
// Isolating a set is the opposite: every *other* edge keeps its normal
// appearance (no dimming) and only the isolated set's own edges are
// highlighted (`EntityState.ISOLATED`), so isolate reads as "point out
// this set" rather than "hide everything else".
function drawEdgeFaces(ctx) {
    ctx.save();
    // Only the ghost/isolated states need their own pass here - the
    // element's own border (drawElements) already traces the default line
    // for every other surface edge, Abaqus-style thin dark edges.
    for (const edge of store.edgeFaces) {
        if (!store.isElementVisible(edge.elementId)) continue;
        if (selection.faceKeys.has(edge.key) || hover.faceKey === edge.key) continue;
        if (store.isEdgeGhosted(edge)) drawEdge(ctx, edge, edgeFaceStyle(EntityState.GHOST));
        else if (store.isEdgeIsolated(edge)) drawEdge(ctx, edge, edgeFaceStyle(EntityState.ISOLATED));
    }
    // Gate on the element alone (not the stricter isEdgeVisible) so a
    // selected edge keeps showing even if its surface set gets hidden
    // afterwards - selection should never just silently vanish.
    if (hover.faceKey && !selection.faceKeys.has(hover.faceKey)) {
        const edge = store.edgeFaceMap.get(hover.faceKey);
        if (edge && store.isElementVisible(edge.elementId)) drawEdge(ctx, edge, edgeFaceStyle(EntityState.HOVER));
    }
    for (const key of selection.faceKeys) {
        const edge = store.edgeFaceMap.get(key);
        if (edge && store.isElementVisible(edge.elementId)) drawEdge(ctx, edge, edgeFaceStyle(EntityState.SELECTED));
    }
    ctx.restore();
}

// Abaqus hides node markers by default and only reveals them on demand -
// otherwise every node dot competes visually with the element fill/edges.
// A node is drawn when: it's hovered/selected directly, its node set is the
// isolated one (Sets panel - isolating is the only way to see a node set's
// members in the view, since there's no per-set hide for nodes), it has no
// owning element (otherwise a freshly placed free node would be invisible),
// or the active tool opts into always showing nodes (e.g. element-creation
// tools, which need every pickable node visible). Hovering an element only
// highlights the element itself, not its corner nodes.
function isNodeRevealed(nodeId, isolatedNodeIds) {
    if (viewport.showAllNodes) return true;
    // "Show Node Labels" is also the user's way of asking to see every node
    // - toggling it on reveals the whole mesh's nodes, not just the labels.
    if (viewport.showNodeLabels) return true;
    if (selection.nodeIds.has(nodeId) || hover.nodeId === nodeId) return true;
    if (isolatedNodeIds?.has(nodeId)) return true;
    if (!store.elementsByNode.has(nodeId)) return true;
    return false;
}

function drawNodes(ctx) {
    ctx.save();
    const radius = Math.max(2.5, Math.min(6, viewport.scale * 0.12));
    const isolatedNodeIds =
        store.isolatedSet?.kind === "node" ? new Set(store.mesh.node_sets[store.isolatedSet.name] || []) : null;
    for (const node of store.mesh.nodes) {
        if (!store.isNodeVisible(node.id)) continue;
        if (!isNodeRevealed(node.id, isolatedNodeIds)) continue;
        const p = viewport.toScreen(node);
        const isSelected = selection.nodeIds.has(node.id);
        const isHovered = !isSelected && hover.nodeId === node.id;
        const isIsolated = !isSelected && !isHovered && isolatedNodeIds?.has(node.id);
        const isLabeled = !isSelected && !isHovered && !isIsolated && viewport.showNodeLabels;
        const state = isSelected
            ? EntityState.SELECTED
            : isHovered
              ? EntityState.HOVER
              : isIsolated
                ? EntityState.ISOLATED
                : isLabeled
                  ? EntityState.LABELED
                  : EntityState.DEFAULT;
        const style = nodeStyle(state);

        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + style.radiusDelta, 0, Math.PI * 2);
        ctx.fillStyle = style.color;
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
    drawEdgeFaces(ctx);
    drawNodes(ctx);
    if (toolOverlayFn) toolOverlayFn(ctx);
}
