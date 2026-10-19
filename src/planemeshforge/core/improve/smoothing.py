"""Node-relocation smoothing to reduce skewness and balance aspect ratio."""

from __future__ import annotations

import math

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
    the node where it was. Boundary nodes and nodes of 1D elements are
    never moved; nodes referenced by a surface set are too, but only if
    `scope["lock_surface_sets"]` is set (see `adjacency.build`).
    """
    if mesh is None:
        raise ValueError("No mesh is loaded.")
    if method not in _METHODS:
        raise ValueError(f"Unknown smoothing method: {method!r}")

    before_summary = quality_mod.metrics(mesh)["summary"]

    adjacency = build_adjacency(
        mesh,
        extra_fixed_node_ids=set(fixed_node_ids or []),
        lock_surface_sets=bool((scope or {}).get("lock_surface_sets")),
    )
    free_node_ids = sorted(resolve_node_scope(mesh, adjacency, scope) & set(adjacency.node_to_neighbors))

    # Plain Python float coordinates, not a numpy view: this loop runs
    # per-node, per-shrink-retry, per-iteration (tens of thousands of times
    # on a real mesh), and numpy's per-call overhead on 2-4 point inputs
    # dominates actual math at that scale. Written back to `mesh.points`
    # only once, at the end.
    xs = [float(v) for v in mesh.points[:, 0]]
    ys = [float(v) for v in mesh.points[:, 1]]
    index_of = adjacency.id_to_index
    ideal_angle_of = {eid: quality_mod.IDEAL_ANGLE.get(t) for eid, t in adjacency.element_to_type.items()}

    moved_node_ids: set[int] = set()
    iterations_run = 0

    for _ in range(max(1, iterations)):
        max_shift = 0.0
        for node_id in free_node_ids:
            idx = index_of[node_id]
            current_x, current_y = xs[idx], ys[idx]
            neighbor_idx = [index_of[n] for n in adjacency.node_to_neighbors[node_id]]
            centroid_x = sum(xs[i] for i in neighbor_idx) / len(neighbor_idx)
            centroid_y = sum(ys[i] for i in neighbor_idx) / len(neighbor_idx)
            step_x = omega * (centroid_x - current_x)
            step_y = omega * (centroid_y - current_y)
            incident_ids = adjacency.node_to_elements.get(node_id, [])

            if method == "laplacian":
                xs[idx], ys[idx] = current_x + step_x, current_y + step_y
                moved_node_ids.add(node_id)
                max_shift = max(max_shift, math.hypot(step_x, step_y))
                continue

            before_shapes = _element_shapes(xs, ys, adjacency, ideal_angle_of, incident_ids)
            accepted_shift = 0.0
            for shrink in _STEP_SHRINKS:
                xs[idx] = current_x + step_x * shrink
                ys[idx] = current_y + step_y * shrink
                if _move_is_valid(xs, ys, adjacency, ideal_angle_of, incident_ids, before_shapes):
                    accepted_shift = math.hypot(step_x * shrink, step_y * shrink)
                    break
            else:
                xs[idx], ys[idx] = current_x, current_y

            if accepted_shift:
                moved_node_ids.add(node_id)
                max_shift = max(max_shift, accepted_shift)

        iterations_run += 1
        if max_shift < tolerance:
            break

    if moved_node_ids:
        indices = [index_of[n] for n in moved_node_ids]
        mesh.points[indices, 0] = [xs[i] for i in indices]
        mesh.points[indices, 1] = [ys[i] for i in indices]

    after_summary = quality_mod.metrics(mesh)["summary"]
    return {
        "moved_node_ids": sorted(moved_node_ids),
        "iterations_run": iterations_run,
        "before": before_summary,
        "after": after_summary,
    }


def _shape_metrics(points: list[tuple[float, float]], ideal_angle: float) -> tuple[float, float | None]:
    """`(skewness, aspect_ratio)` for an ordered list of 2D points - same
    definitions as `quality.element_shape_metrics`, computed with plain
    floats (no numpy) since this runs in the tight smoothing inner loop."""
    n = len(points)
    edge_lens = []
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        edge_lens.append(math.hypot(x2 - x1, y2 - y1))
    min_edge, max_edge = min(edge_lens), max(edge_lens)
    if min_edge <= 1e-12:
        return 1.0, None
    aspect_ratio = max_edge / min_edge

    min_angle, max_angle = 180.0, 0.0
    for i in range(n):
        px, py = points[i]
        prev_x, prev_y = points[i - 1]
        next_x, next_y = points[(i + 1) % n]
        v1x, v1y = prev_x - px, prev_y - py
        v2x, v2y = next_x - px, next_y - py
        norm = math.hypot(v1x, v1y) * math.hypot(v2x, v2y)
        cos_angle = 0.0 if norm <= 1e-12 else max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / norm))
        angle = math.degrees(math.acos(cos_angle))
        if angle < min_angle:
            min_angle = angle
        if angle > max_angle:
            max_angle = angle

    skewness = max((max_angle - ideal_angle) / (180.0 - ideal_angle), (ideal_angle - min_angle) / ideal_angle)
    return max(0.0, min(1.0, skewness)), aspect_ratio


def _signed_area(points: list[tuple[float, float]]) -> float:
    n = len(points)
    total = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return 0.5 * total


def _element_points(xs: list[float], ys: list[float], adjacency, element_id: int) -> list[tuple[float, float]]:
    index_of = adjacency.id_to_index
    return [(xs[index_of[n]], ys[index_of[n]]) for n in adjacency.element_to_nodes[element_id]]


def _element_shapes(xs, ys, adjacency, ideal_angle_of: dict, element_ids: list[int]) -> dict[int, tuple[float, float | None]]:
    shapes = {}
    for eid in element_ids:
        ideal_angle = ideal_angle_of.get(eid)
        if ideal_angle is None:
            continue
        shapes[eid] = _shape_metrics(_element_points(xs, ys, adjacency, eid), ideal_angle)
    return shapes


def _move_is_valid(xs, ys, adjacency, ideal_angle_of: dict, element_ids: list[int], before_shapes: dict) -> bool:
    """Accepts a candidate move if it inverts nothing and doesn't push the
    *worst* skewness/aspect ratio among the node's incident elements any
    higher than it was before - individual elements may trade places (one
    improves while another gets slightly worse) as long as the local worst
    case doesn't regress."""
    worst_before_skew = worst_before_aspect = 0.0
    worst_after_skew = worst_after_aspect = 0.0

    for eid in element_ids:
        points = _element_points(xs, ys, adjacency, eid)
        if _signed_area(points) <= 0:
            return False

        before = before_shapes.get(eid)
        if before is None:
            continue
        before_skew, before_aspect = before
        after_skew, after_aspect = _shape_metrics(points, ideal_angle_of[eid])

        worst_before_skew = max(worst_before_skew, before_skew)
        worst_after_skew = max(worst_after_skew, after_skew)
        if before_aspect is not None:
            worst_before_aspect = max(worst_before_aspect, before_aspect)
        if after_aspect is not None:
            worst_after_aspect = max(worst_after_aspect, after_aspect)

    if worst_after_skew > worst_before_skew + 1e-9:
        return False
    if worst_after_aspect > worst_before_aspect + 1e-6:
        return False
    return True
