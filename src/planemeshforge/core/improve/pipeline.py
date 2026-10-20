"""Recipe pipeline: runs an ordered list of improvement steps as one op, so
the whole recipe is a single undoable action (see `MeshEditor.apply`)."""

from __future__ import annotations

from ...abaqus_io import Mesh
from .. import quality as quality_mod
from .. import ops as ops_module
from .presets import PRESETS

# Only step ops that are safe to run unattended as part of a recipe: they
# don't delete geometry a user didn't ask to delete (refine_slivers and
# refine_quads are the exceptions - they add geometry, which is exactly
# what they're for), and they're idempotent enough to repeat across passes.
ALLOWED_STEP_OPS = {
    "merge_nodes",
    "fix_orientation",
    "smooth_nodes",
    "flip_edges",
    "refine_slivers",
    "refine_quads",
}

# Steps whose own `scope` dict should inherit the recipe-level scope/limits
# (a step's own `scope` wins on conflicting keys) - every step that takes a
# `scope` argument at all.
_SCOPED_STEP_OPS = {"smooth_nodes", "flip_edges", "refine_slivers", "refine_quads"}


def improve_quality(
    mesh: Mesh | None,
    scope: dict | None = None,
    limits: dict | None = None,
    steps: list[dict] | None = None,
    preset: str | None = None,
    max_passes: int = 1,
    progress=None,
) -> dict:
    """Runs a recipe of improvement steps against `mesh` as one operation.

    Give either `steps` (a list of `{"op": name, **args}`, `name` in
    `ALLOWED_STEP_OPS`) or a built-in `preset` name (see `presets.PRESETS`),
    not both. `scope` and `limits`, if given, are merged into every scoped
    step's own `scope` (a step's own `scope` wins on conflicting keys), so
    a recipe can be aimed at e.g. just the flagged elements without
    repeating that in every step.

    `max_passes` reruns the full step list until the worst skewness stops
    improving or drops to/below `limits["skewness"]` (if given) - most
    presets converge in 1-2 passes.

    `progress`, if given, is called after each completed step with
    `{"step": i, "total_steps": n, "op": op_name, "pass": pass_index,
    "after": step_summary}` - server-side only (never a client-supplied
    arg, since it's not JSON-serializable); see `server/sockets.py`'s
    handling of the `improve_quality` op for how it's wired to a live
    progress event.

    Returns `{"steps": [...one entry per step ran...], "before": summary,
    "after": summary}`, where each step entry is `{op, args, result,
    before, after}` (summaries from `quality.metrics`).
    """
    if mesh is None:
        raise ValueError("No mesh is loaded.")
    if bool(steps) == bool(preset):
        raise ValueError("Give exactly one of `steps` or `preset`.")

    step_list = steps if steps is not None else PRESETS.get(preset)
    if step_list is None:
        raise ValueError(f"Unknown preset: {preset!r}")

    before_summary = quality_mod.metrics(mesh)["summary"]
    step_reports: list[dict] = []
    previous_worst_skew: float | None = None
    total_steps = len(step_list) * max(1, max_passes)
    step_number = 0

    for pass_index in range(max(1, max_passes)):
        for raw_step in step_list:
            step_args = dict(raw_step)
            op_name = step_args.pop("op", None)
            if op_name not in ALLOWED_STEP_OPS:
                raise ValueError(f"Step op not allowed in a recipe: {op_name!r}")

            if op_name in _SCOPED_STEP_OPS:
                step_args["scope"] = {**(scope or {}), **step_args.get("scope", {})}
                if limits:
                    step_args["scope"].setdefault("limits", limits)

            before_step = quality_mod.metrics(mesh)["summary"]
            result = ops_module.OPS[op_name](mesh, **step_args)
            after_step = quality_mod.metrics(mesh)["summary"]
            step_reports.append(
                {"op": op_name, "args": step_args, "result": result, "before": before_step, "after": after_step}
            )

            step_number += 1
            if progress is not None:
                progress(
                    {
                        "step": step_number,
                        "total_steps": total_steps,
                        "op": op_name,
                        "pass": pass_index + 1,
                        "after": after_step,
                    }
                )

        worst_skew = step_reports[-1]["after"].get("skewness", {}).get("max")
        if worst_skew is None:
            break
        if limits and worst_skew <= limits.get("skewness", 0.0):
            break
        if previous_worst_skew is not None and worst_skew >= previous_worst_skew - 1e-9:
            break
        previous_worst_skew = worst_skew

    after_summary = quality_mod.metrics(mesh)["summary"]
    return {"steps": step_reports, "before": before_summary, "after": after_summary}
