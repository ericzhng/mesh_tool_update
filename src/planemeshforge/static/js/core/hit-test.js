// Shared picking logic used by the select/delete/create-element tools and
// the context menu, so "what did the user click on" is defined once.
import { store } from "./store.js";
import { viewport } from "../render/viewport.js";
import { distanceToSegment, pointInPolygon } from "./geometry.js";

const DEFAULT_PICK_RADIUS_PX = 9;

export function pickRadiusWorld(radiusPx = DEFAULT_PICK_RADIUS_PX) {
    return radiusPx / viewport.scale;
}

export function hitNode(world, radiusPx = DEFAULT_PICK_RADIUS_PX) {
    const r = pickRadiusWorld(radiusPx);
    const candidates = store.spatialGrid.queryPoint(world, r);
    let best = null;
    let bestDist = Infinity;
    for (const node of candidates) {
        if (!store.isNodeVisible(node.id)) continue;
        const d = Math.hypot(node.x - world.x, node.y - world.y);
        if (d <= r && d < bestDist) {
            best = node;
            bestDist = d;
        }
    }
    return best;
}

export function hitElement(world, radiusPx = DEFAULT_PICK_RADIUS_PX) {
    const r = pickRadiusWorld(radiusPx);
    for (const element of store.mesh.elements) {
        if (!store.isElementVisible(element.id)) continue;
        const nodes = element.node_ids.map(id => store.node(id)).filter(Boolean);
        if (nodes.length < 2) continue;
        if (nodes.length === 2) {
            if (distanceToSegment(world, nodes[0], nodes[1]) <= r) return element;
        } else if (pointInPolygon(world, nodes)) {
            return element;
        }
    }
    return null;
}

// Picks the nearest pickable edge ("surface") of a 2D element - boundary or
// internal - per `store.edgeFaces`. When an internal edge is shared by two
// elements, both sides are candidates; the nearer one wins ties by whichever
// comes first in `edgeFaces` (lower element id).
export function hitEdge(world, radiusPx = DEFAULT_PICK_RADIUS_PX) {
    const r = pickRadiusWorld(radiusPx);
    let best = null;
    let bestDist = Infinity;
    for (const edge of store.edgeFaces) {
        if (!store.isEdgeVisible(edge)) continue;
        const a = store.node(edge.a);
        const b = store.node(edge.b);
        if (!a || !b) continue;
        const d = distanceToSegment(world, a, b);
        if (d <= r && d < bestDist) {
            best = edge;
            bestDist = d;
        }
    }
    return best;
}
