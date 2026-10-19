"""Built-in step lists for `improve_quality`, from gentlest to most aggressive.

Each step is `{"op": name, **args}`; `name` must be one of
`pipeline.ALLOWED_STEP_OPS`. `scope`/`limits` passed to `improve_quality`
itself are merged into every `smooth_nodes` step, so a preset doesn't need
to repeat them.
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
    "aggressive": [
        {"op": "merge_nodes"},
        {"op": "flip_edges"},
        {"op": "smooth_nodes", "method": "laplacian", "iterations": 5, "omega": 0.3},
        {"op": "flip_edges"},
        {"op": "smooth_nodes", "method": "smart_laplacian", "iterations": 30, "omega": 0.6},
    ],
}
