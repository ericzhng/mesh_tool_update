"""Node-relocation smoothing to reduce skewness and balance aspect ratio."""

from __future__ import annotations

import numpy as np

from ...abaqus_io import Mesh
from .. import quality as quality_mod
from .adjacency import build as build_adjacency, resolve_node_scope

_METHODS = {"laplacian", "smart_laplacian"}
_STEP_SHRINKS = (1.0, 0.5, 0.25)


def smooth_nodes(
    mesh: Mesh | None,
    scope: dict | None = None,
    method: str = "smart_laplacian",
    iterations: int = 10,
    omega: float = 0.5,
    tolerance: float = 1e-4,
    fixed_node_ids: list[int] | None = None,
) -> dict:
    """Relocates free nodes toward their neighbors' centroid to improve shape quality.

    `method="laplacian"` moves every eligible node unconditionally each
    pass. `method="smart_laplacian"` (default) only commits a move if it
    doesn't invert an incident element and doesn't raise that element's
    skewness or aspect ratio above what it was before the move; it retries
    at a smaller step (half, then a quarter) before giving up and leaving
    the node where it was. Boundary nodes, nodes of 1D elements, and nodes
    referenced by a surface set are never moved (see `adjacency.build`).
    """
    if mesh is None:
        raise ValueError("No mesh is loaded.")
    if method not in _METHODS:
        raise ValueError(f"Unknown smoothing method: {method!r}")

    before_summary = quality_mod.metrics(mesh)["summary"]

    adjacency = build_adjacency(mesh, extra_fixed_node_ids=set(fixed_node_ids or []))
    free_node_ids = sorted(resolve_node_scope(mesh, adjacency, scope) & set(adjacency.node_to_neighbors))

    moved_node_ids: set[int] = set()
    iterations_run = 0

    for _ in range(max(1, iterations)):
        max_shift = 0.0
        for node_id in free_node_ids:
            idx = adjacency.id_to_index[node_id]
            current = mesh.points[idx, :2].copy()
            neighbor_idx = [adjacency.id_to_index[n] for n in adjacency.node_to_neighbors[node_id]]
            centroid = mesh.points[neighbor_idx, :2].mean(axis=0)
            step = omega * (centroid - current)
            incident_ids = adjacency.node_to_elements.get(node_id, [])

            if method == "laplacian":
                mesh.points[idx, :2] = current + step
                moved_node_ids.add(node_id)
                max_shift = max(max_shift, float(np.linalg.norm(step)))
                continue

            before_shapes = _element_shapes(mesh, adjacency, incident_ids)
            accepted_shift = 0.0
            for shrink in _STEP_SHRINKS:
                mesh.points[idx, :2] = current + step * shrink
                if _move_is_valid(mesh, adjacency, incident_ids, before_shapes):
                    accepted_shift = float(np.linalg.norm(step * shrink))
                    break
            else:
                mesh.points[idx, :2] = current

            if accepted_shift:
                moved_node_ids.add(node_id)
                max_shift = max(max_shift, accepted_shift)

        iterations_run += 1
        if max_shift < tolerance:
            break

    after_summary = quality_mod.metrics(mesh)["summary"]
    return {
        "moved_node_ids": sorted(moved_node_ids),
        "iterations_run": iterations_run,
        "before": before_summary,
        "after": after_summary,
    }


def _element_shapes(mesh: Mesh, adjacency, element_ids: list[int]) -> dict[int, dict]:
    shapes = {}
    for eid in element_ids:
        ideal_angle = quality_mod.IDEAL_ANGLE.get(adjacency.element_to_type[eid])
        if ideal_angle is None:
            continue
        idx = [adjacency.id_to_index[n] for n in adjacency.element_to_nodes[eid]]
        shapes[eid] = quality_mod.element_shape_metrics(mesh.points[idx, :2], ideal_angle)
    return shapes


def _signed_area(pts: np.ndarray) -> float:
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _move_is_valid(mesh: Mesh, adjacency, element_ids: list[int], before_shapes: dict[int, dict]) -> bool:
    """Accepts a candidate move if it inverts nothing and doesn't push the
    *worst* skewness/aspect ratio among the node's incident elements any
    higher than it was before - individual elements may trade places (one
    improves while another gets slightly worse) as long as the local worst
    case doesn't regress."""
    worst_before_skew = 0.0
    worst_before_aspect = 0.0
    worst_after_skew = 0.0
    worst_after_aspect = 0.0

    for eid in element_ids:
        idx = [adjacency.id_to_index[n] for n in adjacency.element_to_nodes[eid]]
        pts = mesh.points[idx, :2]
        if _signed_area(pts) <= 0:
            return False

        before = before_shapes.get(eid)
        if before is None:
            continue
        ideal_angle = quality_mod.IDEAL_ANGLE[adjacency.element_to_type[eid]]
        after = quality_mod.element_shape_metrics(pts, ideal_angle)

        worst_before_skew = max(worst_before_skew, before["skewness"])
        worst_after_skew = max(worst_after_skew, after["skewness"])
        if before["aspect_ratio"] is not None:
            worst_before_aspect = max(worst_before_aspect, before["aspect_ratio"])
        if after["aspect_ratio"] is not None:
            worst_after_aspect = max(worst_after_aspect, after["aspect_ratio"])

    if worst_after_skew > worst_before_skew + 1e-9:
        return False
    if worst_after_aspect > worst_before_aspect + 1e-6:
        return False
    return True
