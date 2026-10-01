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
// named element set. Unlabeled/legacy entries have no face geometry and are
// skipped - callers fall back to highlighting their elements instead.
export function resolveSurfaceFaces(tokens, elementSets) {
    const keys = [];
    for (const [token, label] of surfacePairs(tokens)) {
        const faceIndex = faceIndexForLabel(label);
        if (faceIndex === null) continue;
        if (NUMERIC_RE.test(token)) {
            keys.push(`${Number(token)}:${faceIndex}`);
        } else {
            for (const elementId of elementSets[token] || []) keys.push(`${elementId}:${faceIndex}`);
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
