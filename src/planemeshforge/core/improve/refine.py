"""Sliver refinement: insert a node to split a triangle that smoothing and
edge-flipping genuinely cannot fix - the triangle's shape itself is bad,
not just its node positions or which diagonal was chosen. The standard
remedy from Delaunay-refinement mesh generators (Triangle, Gmsh, TetGen):
split the triangle's longest edge at its midpoint."""

from __future__ import annotations

import math

import numpy as np

from ...abaqus_io import ElementBlock, Mesh
from .. import quality as quality_mod
from .. import topology as topo
from .adjacency import build as build_adjacency, resolve_element_scope
from .triangles import locked_edges, sorted_edge, triangle_topology


def refine_slivers(
    mesh: Mesh | None,
    scope: dict | None = None,
    skew_threshold: float = 0.85,
    aspect_ratio_threshold: float | None = None,
) -> dict:
    """Splits CGAX3 elements at/above `skew_threshold` skewness, or (if
    `aspect_ratio_threshold` is given) at/above that aspect ratio, by
    inserting a node at the midpoint of their longest edge.

    Skewness alone misses "slivers" that are merely long and thin but not
    badly angled, and some such elements genuinely drag down mesh quality
    without smoothing/flipping being able to fix them (the shape, not the
    node positions or diagonal choice, is the problem) - the same
    justification as skew-based splitting, just a different metric. A
    triangle is a candidate if either threshold is met.

    If that edge is interior and shared with another triangle, both
    triangles are replaced by 4 new ones (the classic Delaunay-refinement
    edge split); if it's a mesh-boundary edge, the one triangle is replaced
    by 2. Either way the split is always geometrically valid (no convexity
    requirement, unlike `flip_edges`) since it just substitutes the new
    midpoint for one endpoint in each affected triangle's own vertex list,
    preserving its winding.

    If the longest edge is shared with a CGAX4 (quad) instead, or is
    locked by a `*SURFACE` face token, the element is left alone and
    reported in `skipped_element_ids` - splitting it would leave a
    non-conforming "T-junction" against the quad, or move/orphan a named
    physical face.

    Worst elements are processed first (ranked by how far each exceeds
    whichever threshold it triggered, as a fraction of that threshold);
    `scope` restricts which elements are considered, the same shape as
    `flip_edges`'s scope. New nodes/elements get fresh ids (via
    `topology.next_point_id`/`next_element_id`) and start in no sets; old
    element ids are dropped from `elem_sets` and `surface_sets` the same
    way `topology.split_quads` already does.

    Returns `{"created_node_ids": [...], "created_element_ids": [...],
    "removed_element_ids": [...], "skipped_element_ids": [...], "before":
    summary, "after": summary}`.
    """
    if mesh is None:
        raise ValueError("No mesh is loaded.")

    before_summary = quality_mod.metrics(mesh)["summary"]
    id_to_index = {pid: i for i, pid in enumerate(mesh.point_ids)}

    element_to_nodes, element_to_block_row, tri_edge_to_elements = triangle_topology(mesh)
    locked = locked_edges(mesh, element_to_nodes)
    full_edge_degree = _full_2d_edge_degree(mesh)

    adjacency = build_adjacency(mesh)
    allowed_elements = resolve_element_scope(mesh, adjacency, scope)

    def point(node_id: int) -> tuple[float, float]:
        p = mesh.points[id_to_index[node_id]]
        return float(p[0]), float(p[1])

    def shape_of(nodes: list[int]) -> dict:
        pts = np.array([point(n) for n in nodes])
        return quality_mod.element_shape_metrics(pts, 60.0)

    def badness_of(nodes: list[int]) -> float:
        """How far past whichever threshold it exceeds, as a fraction of
        that threshold; 0 or below means it isn't a candidate at all."""
        shape = shape_of(nodes)
        score = shape["skewness"] / skew_threshold
        if aspect_ratio_threshold is not None and shape["aspect_ratio"] is not None:
            score = max(score, shape["aspect_ratio"] / aspect_ratio_threshold)
        return score

    candidates = [
        eid
        for eid, nodes in element_to_nodes.items()
        if (allowed_elements is None or eid in allowed_elements) and badness_of(nodes) >= 1.0
    ]
    candidates.sort(key=lambda eid: badness_of(element_to_nodes[eid]), reverse=True)

    consumed: set[int] = set()
    skipped_element_ids: list[int] = []
    removed_element_ids: list[int] = []
    created_node_ids: list[int] = []
    new_points: list[list[float]] = []
    created_element_ids: list[int] = []
    new_conn: list[list[int]] = []

    next_point_id = topo.next_point_id(mesh)
    next_element_id = topo.next_element_id(mesh)

    for eid in candidates:
        if eid in consumed:
            continue
        nodes = element_to_nodes[eid]
        a, b = _longest_edge(nodes, point)
        edge = sorted_edge(a, b)

        if edge in locked:
            skipped_element_ids.append(eid)
            continue

        degree = full_edge_degree.get(edge, 1)
        if degree == 1:
            other_id = None
        elif degree == 2:
            neighbors = tri_edge_to_elements.get(edge)
            other_id = next((n for n in (neighbors or []) if n != eid), None) if neighbors and len(neighbors) == 2 else None
            if other_id is None or other_id in consumed:
                skipped_element_ids.append(eid)
                continue
        else:
            # Shouldn't happen for a manifold 2D mesh; be conservative.
            skipped_element_ids.append(eid)
            continue

        ax, ay = point(a)
        bx, by = point(b)
        az = float(mesh.points[id_to_index[a], 2])
        bz = float(mesh.points[id_to_index[b], 2])
        m = next_point_id
        next_point_id += 1
        created_node_ids.append(m)
        new_points.append([(ax + bx) / 2.0, (ay + by) / 2.0, (az + bz) / 2.0])

        for child in _split_at_edge(nodes, edge, m):
            new_conn.append(child)
            created_element_ids.append(next_element_id)
            next_element_id += 1
        removed_element_ids.append(eid)
        consumed.add(eid)

        if other_id is not None:
            other_nodes = element_to_nodes[other_id]
            for child in _split_at_edge(other_nodes, edge, m):
                new_conn.append(child)
                created_element_ids.append(next_element_id)
                next_element_id += 1
            removed_element_ids.append(other_id)
            consumed.add(other_id)

    if new_points:
        mesh.points = np.vstack([mesh.points, new_points])
        mesh.point_ids.extend(created_node_ids)

    if removed_element_ids:
        removed_set = set(removed_element_ids)
        remaining_blocks = []
        for block in mesh.cells:
            if block.element_type != "CGAX3":
                remaining_blocks.append(block)
                continue
            keep_mask = np.array([int(eid) not in removed_set for eid in block.ids])
            if keep_mask.any():
                remaining_blocks.append(ElementBlock("CGAX3", block.ids[keep_mask], block.connectivity[keep_mask]))
        mesh.cells = remaining_blocks
        if new_conn:
            new_block = ElementBlock("CGAX3", np.array(created_element_ids), np.array(new_conn))
            mesh.cells = topo.merge_element_blocks(mesh.cells + [new_block])

        for name in list(mesh.elem_sets):
            mesh.elem_sets[name] = [i for i in mesh.elem_sets[name] if i not in removed_set]
        topo.remap_surface_sets(mesh, removed_element_ids=removed_element_ids)
        mesh._validate_data()

    after_summary = quality_mod.metrics(mesh)["summary"]
    return {
        "created_node_ids": created_node_ids,
        "created_element_ids": created_element_ids,
        "removed_element_ids": removed_element_ids,
        "skipped_element_ids": skipped_element_ids,
        "before": before_summary,
        "after": after_summary,
    }


def _full_2d_edge_degree(mesh: Mesh) -> dict[tuple[int, int], int]:
    """Edge -> number of 2D elements (triangles *and* quads) touching it.

    Used to tell a true mesh-boundary edge (degree 1) from one that's only
    "not shared by another triangle" because the other side is a quad
    (degree 2, but absent from the triangle-only `tri_edge_to_elements`) -
    `refine_slivers` must not split the latter.
    """
    counts: dict[tuple[int, int], int] = {}
    for block in mesh.cells:
        if block.element_type not in quality_mod.IDEAL_ANGLE:
            continue
        n = block.num_nodes
        for conn in block.connectivity:
            nodes = [int(v) for v in conn]
            for i in range(n):
                edge = sorted_edge(nodes[i], nodes[(i + 1) % n])
                counts[edge] = counts.get(edge, 0) + 1
    return counts


def _longest_edge(nodes: list[int], point) -> tuple[int, int]:
    n = len(nodes)
    best_edge, best_len = (nodes[0], nodes[1]), -1.0
    for i in range(n):
        a, b = nodes[i], nodes[(i + 1) % n]
        ax, ay = point(a)
        bx, by = point(b)
        length = math.hypot(bx - ax, by - ay)
        if length > best_len:
            best_len, best_edge = length, (a, b)
    return best_edge


def _split_at_edge(nodes: list[int], edge: tuple[int, int], m: int) -> tuple[list[int], list[int]]:
    """Splits a triangle's `nodes` (in their original winding order) at the
    midpoint `m` of `edge`, returning its two children in that same
    winding - valid for any triangle, no convexity requirement."""
    n = len(nodes)
    i = next(k for k in range(n) if {nodes[k], nodes[(k + 1) % n]} == set(edge))
    v0, v1, v2 = nodes[i], nodes[(i + 1) % n], nodes[(i + 2) % n]
    return [v0, m, v2], [m, v1, v2]
