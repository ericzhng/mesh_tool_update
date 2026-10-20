"""Built-in step lists for `improve_quality`, from gentlest to most aggressive.

Each step is `{"op": name, **args}`; `name` must be one of
`pipeline.ALLOWED_STEP_OPS`. `scope`/`limits` passed to `improve_quality`
itself are merged into every scoped step, so a preset doesn't need to
repeat them.
"""

from __future__ import annotations

PRESETS: dict[str, list[dict]] = {
    "gentle": [
        {"op": "smooth_nodes", "method": "smart_laplacian", "iterations": 10, "omega": 0.5},
    ],
    "balanced": [
        {"op": "merge_nodes"},
        {"op": "flip_edges"},
        {"op": "smooth_nodes", "method": "smart_laplacian", "iterations": 20, "omega": 0.5},
    ],
    # The only preset that changes node/element counts: smoothing and
    # flipping alone can't fix an element that's just fundamentally badly
    # shaped (not a position or diagonal-choice problem), so this one adds
    # splitting passes (triangles, then boundary-safe quads) before
    # relaxing the result.
    "aggressive": [
        {"op": "merge_nodes"},
        {"op": "flip_edges"},
        {"op": "smooth_nodes", "method": "laplacian", "iterations": 5, "omega": 0.3},
        {"op": "flip_edges"},
        {"op": "refine_slivers", "skew_threshold": 0.85},
        {"op": "refine_quads", "skew_threshold": 0.85},
        {"op": "smooth_nodes", "method": "smart_laplacian", "iterations": 30, "omega": 0.6},
    ],
}
