// Mirrors the Python `*SURFACE, TYPE=ELEMENT` token parsing
// (abaqus_io/deck_utility.py:surface_pairs) so the client can resolve a
// surface set's tokens into boundary-edge keys or element ids, without a
// round trip to the server. Pure functions (no store import) so `store.js`
// can use them for visibility without a circular dependency.
const FACE_LABEL_RE = /^(S\d+|SPOS|SNEG)$/i;
const NUMERIC_RE = /^-?\d+$/;

export function surfacePairs(tokens) {
    const pairs = [];
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        if (i + 1 < tokens.length && FACE_LABEL_RE.test(tokens[i + 1])) {
            pairs.push([token, tokens[i + 1]]);
            i += 2;
        } else {
            pairs.push([token, null]);
            i += 1;
        }
    }
    return pairs;
}

function faceIndexForLabel(label) {
    const m = /^S(\d+)$/i.exec(label || "");
    return m ? Number(m[1]) - 1 : null;
}

// Returns the boundary-edge keys (`${elementId}:${faceIndex}`) a surface
// set's tokens resolve to, for the labeled pairs this app creates - either
// a direct element id or (for sets imported from a deck) a reference to a
// named element set.
//
// A real Abaqus deck requires a face label (S1, S2, ...) for solid/
// continuum elements, but decks built by referencing a whole element set
// with no label at all are also seen in the wild - the intent there is
// "the exterior of these elements", same as Abaqus itself works out the
// boundary of a *SURFACE made of whole element sets: an edge belongs to the
// surface when it's on the boundary of the whole mesh (used by exactly one
// element overall), not just the boundary of the referenced subset. `edgeFaces`
// (store.edgeFaces, each already flagged `.boundary`) supplies that - pass
// it to resolve those entries; omit it (or pass elements with no matches) and
// unlabeled entries are simply skipped, same as before.
export function resolveSurfaceFaces(tokens, elementSets, edgeFaces) {
    const keys = [];
    let boundaryKeysByElement = null;
    const boundaryKeysFor = elementId => {
        if (!boundaryKeysByElement) {
            boundaryKeysByElement = new Map();
            for (const edge of edgeFaces || []) {
                if (!edge.boundary) continue;
                if (!boundaryKeysByElement.has(edge.elementId)) boundaryKeysByElement.set(edge.elementId, []);
                boundaryKeysByElement.get(edge.elementId).push(edge.key);
            }
        }
        return boundaryKeysByElement.get(elementId) || [];
    };

    for (const [token, label] of surfacePairs(tokens)) {
        const faceIndex = faceIndexForLabel(label);
        const elementIds = NUMERIC_RE.test(token) ? [Number(token)] : elementSets[token] || [];
        if (faceIndex !== null) {
            for (const elementId of elementIds) keys.push(`${elementId}:${faceIndex}`);
        } else {
            for (const elementId of elementIds) keys.push(...boundaryKeysFor(elementId));
        }
    }
    return keys;
}

export function resolveSurfaceElementIds(tokens, elementSets) {
    const ids = new Set();
    for (const [token] of surfacePairs(tokens)) {
        if (NUMERIC_RE.test(token)) ids.add(Number(token));
        else for (const id of elementSets[token] || []) ids.add(id);
    }
    return [...ids];
}
