// Centralized visual styling for canvas entities (nodes, elements, surface
// edges) across their interaction states - modeled on conventions common to
// CAD/FEA tools (Abaqus/CAE, SolidWorks, AutoCAD):
//   - default: the entity's normal "model" appearance.
//   - hover:   a light preview highlight shown before a click commits a
//              pick, so the user sees what they're about to select.
//   - selected: a bold, saturated highlight - the "picked" state.
//   - ghost:   dashed and muted - the classic technical-drawing convention
//              for a hidden line whose parent geometry is still shown (used
//              when a surface edge's own set is hidden/isolated-out but
//              its element remains visible - AutoCAD/SolidWorks draw
//              suppressed/hidden edges the same way instead of just
//              deleting them from view).
// Each draw pass in renderer.js resolves ONE of these per entity per frame
// and asks here for the concrete colors/widths, instead of hand-rolling its
// own ternaries - keeps the three passes (elements/edges/nodes) visually in
// sync and makes future palette tweaks a one-file change.
export const EntityState = Object.freeze({
    DEFAULT: "default",
    HOVER: "hover",
    SELECTED: "selected",
    GHOST: "ghost",
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
        default:
            return { color: cssVar("--node-color"), radiusDelta: 0 };
    }
}

export function elementStyle(state) {
    switch (state) {
        case EntityState.SELECTED:
            return { fill: cssVar("--element-selected-fill"), stroke: cssVar("--node-selected"), width: 3 };
        case EntityState.HOVER:
            return { fill: cssVar("--element-hover-fill"), stroke: cssVar("--hover-highlight"), width: 2 };
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
        case EntityState.GHOST:
            // Thick and dashed, at near-full opacity, so it reads clearly
            // on top of the element's own (thin, solid) border - a thin
            // faint overlay would be indistinguishable from it.
            return { stroke: cssVar("--text-muted"), width: 4, dashed: true, alpha: 0.9 };
        default:
            return { stroke: cssVar("--element-stroke"), width: 2, dashed: false, alpha: 0.55 };
    }
}
