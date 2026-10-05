// Turns a set of node ids into a valid triangle/quad connectivity, shared by
// the create-element tool (click order known) and "create from selection"
// (click order unknown, so nodes are angle-sorted). Server-side `orient_ccw`
// already fixes CW/CCW winding after every op, so the one thing this module
// has to catch client-side is a self-intersecting ("bowtie") or concave
// quad, which the server can't repair after the fact.
import { store } from "./store.js";
import * as client from "../net/client.js";
import { toast } from "../ui/toast.js";
import { signedArea, sortByAngle, isSimplePolygon, isConvex } from "./geometry.js";

const ELEMENT_TYPE = { 3: "CGAX3", 4: "CGAX4" };

function isDuplicate(nodeIds) {
    const set = new Set(nodeIds);
    const candidates = store.elementsByNode.get(nodeIds[0]) || [];
    return candidates.some(eid => {
        const el = store.element(eid);
        return el.node_ids.length === set.size && el.node_ids.every(id => set.has(id));
    });
}

// `ordered: true` means `nodeIds` is already in a meaningful click order
// (from the create-element tool) and should only be re-sorted if it isn't a
// simple polygon as given. `ordered: false` (a plain selection) always
// angle-sorts first since the input order carries no information.
export function planElement(nodeIds, { ordered = false } = {}) {
    const elementType = ELEMENT_TYPE[nodeIds.length];
    if (!elementType) return { ok: false, error: `Need 3 or 4 nodes, got ${nodeIds.length}.` };

    const nodes = nodeIds.map(id => store.node(id));
    if (nodes.some(n => !n)) return { ok: false, error: "One or more nodes no longer exist." };

    let orderedIds = nodeIds;
    let orderedNodes = nodes;
    if (!ordered || !isSimplePolygon(nodes)) {
        orderedNodes = sortByAngle(nodes);
        orderedIds = orderedNodes.map(n => n.id);
    }

    if (Math.abs(signedArea(orderedNodes)) < 1e-9) {
        return { ok: false, error: "Nodes are collinear or coincident - can't form an element." };
    }
    if (!isSimplePolygon(orderedNodes)) {
        return { ok: false, error: "Nodes can't form a non-self-intersecting element." };
    }
    if (orderedNodes.length === 4 && !isConvex(orderedNodes)) {
        return { ok: false, error: "These 4 nodes form a concave shape - not valid for a quad. Try two triangles instead." };
    }
    if (isDuplicate(orderedIds)) {
        return { ok: false, error: "An element with these nodes already exists." };
    }

    return { ok: true, elementType, connectivity: [orderedIds] };
}

export async function createElementFromNodes(nodeIds, opts) {
    const plan = planElement(nodeIds, opts);
    if (!plan.ok) {
        toast.error(plan.error);
        return plan;
    }
    const result = await client.op("add_elements", { element_type: plan.elementType, connectivity: plan.connectivity });
    if (!result.ok) toast.error(result.error);
    return result;
}
