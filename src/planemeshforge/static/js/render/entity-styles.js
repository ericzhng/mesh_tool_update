// Centralized visual styling for canvas entities (nodes, elements, surface
// edges) across their interaction states - modeled on Abaqus/CAE conventions:
//   - default: solid green elements with thin dark borders; nodes are not
//              drawn at all unless hovered/selected (see drawNodes in
//              renderer.js) - Abaqus only reveals nodes on demand.
//   - hover:   the element/edge/node under the cursor outlines in bright
//              orange, so the user sees what they're about to pick.
//   - selected: a bold red highlight - the "picked" state.
//   - ghost:   dashed and muted - the classic technical-drawing convention
//              for a hidden line whose parent geometry is still shown (used
//              when a surface edge's own set is hidden/isolated-out but
//              its element remains visible - AutoCAD/SolidWorks draw
//              suppressed/hidden edges the same way instead of just
//              deleting them from view).
//   - isolated: the members of the currently-isolated node or surface set
//              (Sets panel), in the same orange as hover - a node set's
//              nodes are otherwise hidden by default, and a surface set's
//              edges otherwise look identical to any other element border,
//              so isolating one needs its own visible highlight.
// Each draw pass in renderer.js resolves ONE of these per entity per frame
// and asks here for the concrete colors/widths, instead of hand-rolling its
// own ternaries - keeps the three passes (elements/edges/nodes) visually in
// sync and makes future palette tweaks a one-file change.
export const EntityState = Object.freeze({
    DEFAULT: "default",
    HOVER: "hover",
    SELECTED: "selected",
    GHOST: "ghost",
    ISOLATED: "isolated",
    // Shape-quality overlay (Utilities > Mesh Quality > Highlight in view):
    // flags elements whose skewness/aspect-ratio crosses the warn/bad limit.
    QUALITY_WARN: "quality-warn",
    QUALITY_BAD: "quality-bad",
});

export function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function nodeStyle(state) {
    switch (state) {
        case EntityState.SELECTED:
            return { color: cssVar("--node-selected"), radiusDelta: 1.5 };
        case EntityState.HOVER:
            return { color: cssVar("--hover-highlight"), radiusDelta: 1 };
        case EntityState.ISOLATED:
            return { color: cssVar("--isolate-highlight"), radiusDelta: 1 };
        default:
            return { color: cssVar("--node-color"), radiusDelta: 0 };
    }
}

export function elementStyle(state) {
    switch (state) {
        case EntityState.SELECTED:
            return { fill: cssVar("--element-selected-fill"), stroke: cssVar("--node-selected"), width: 2.5 };
        case EntityState.HOVER:
            return { fill: cssVar("--element-hover-fill"), stroke: cssVar("--hover-highlight"), width: 2.5 };
        case EntityState.QUALITY_BAD:
            return { fill: cssVar("--quality-bad-fill"), stroke: cssVar("--quality-bad-stroke"), width: 2 };
        case EntityState.QUALITY_WARN:
            return { fill: cssVar("--quality-warn-fill"), stroke: cssVar("--quality-warn-stroke"), width: 2 };
        default:
            return { fill: cssVar("--element-fill"), stroke: cssVar("--element-stroke"), width: 1 };
    }
}

export function edgeFaceStyle(state) {
    switch (state) {
        case EntityState.SELECTED:
            return { stroke: cssVar("--node-selected"), width: 3.5, dashed: false, alpha: 1 };
        case EntityState.HOVER:
            return { stroke: cssVar("--hover-highlight"), width: 2.5, dashed: false, alpha: 1 };
        case EntityState.ISOLATED:
            // The isolated surface set's own edges, drawn bold over the
            // element's plain border so the set reads clearly against the
            // rest of the mesh.
            return { stroke: cssVar("--isolate-highlight"), width: 3, dashed: false, alpha: 1 };
        case EntityState.GHOST:
            // Thick and dashed, at near-full opacity, so it reads clearly
            // on top of the element's own (thin, solid) border - a thin
            // faint overlay would be indistinguishable from it.
            return { stroke: cssVar("--text-muted"), width: 4, dashed: true, alpha: 0.9 };
        default:
            // Not drawn - the element's own border (drawElements) already
            // traces this exact line; redrawing it here would double its
            // apparent width and defeat the thin-dark-edge look.
            return { stroke: cssVar("--element-stroke"), width: 1, dashed: false, alpha: 0 };
    }
}
