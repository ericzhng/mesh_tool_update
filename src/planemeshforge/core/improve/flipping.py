"""Edge flipping for triangle pairs: the classic Delaunay max-min-angle
swap, applied without ever moving a node."""

from __future__ import annotations

from collections import deque

import numpy as np

from ...abaqus_io import Mesh
from .. import quality as quality_mod
from .adjacency import build as build_adjacency, resolve_element_scope
from .triangles import (
    ccw_order,
    locked_edges,
    reassign_edge,
    signed_area,
    sorted_edge,
    triangle_topology,
    write_connectivity,
)


def flip_edges(mesh: Mesh | None, scope: dict | None = None, max_passes: int = 5) -> dict:
    """Flips the shared edge of two triangles whenever doing so raises the
    minimum angle of the pair (the Delaunay criterion: flip if the two
    angles opposite the shared edge sum to more than 180 degrees).

    Only interior edges shared by exactly two CGAX3 (triangle) elements are
    considered; a quad on either side, a mesh-boundary edge, or an edge
    referenced by a `*SURFACE` face token is never touched. `scope`
    restricts which elements are considered, the same shape as
    `smooth_nodes`'s scope (`mode` `"all"`/`"elements"`/`"flagged"`, with
    `grow_rings`). A flip rewrites the connectivity of both triangles but
    keeps their element ids, so sets and ids stay valid.

    Flipped edges are re-queued along with their 4 new neighbors, so a
    chain of bad diagonals converges within one call; `max_passes` bounds
    how many full sweeps that worklist is allowed to take.

    Returns `{"flipped_edges": [[a, b], ...], "flip_count": n, "before":
    summary, "after": summary}` (summaries from `quality.metrics`).
    """
    if mesh is None:
        raise ValueError("No mesh is loaded.")

    before_summary = quality_mod.metrics(mesh)["summary"]
    id_to_index = {pid: i for i, pid in enumerate(mesh.point_ids)}

    element_to_nodes, element_to_block_row, edge_to_elements = triangle_topology(mesh)
    locked = locked_edges(mesh, element_to_nodes)

    adjacency = build_adjacency(mesh)
    allowed_elements = resolve_element_scope(mesh, adjacency, scope)

    def edge_is_flippable(edge: tuple[int, int]) -> bool:
        elements = edge_to_elements.get(edge)
        if not elements or len(elements) != 2 or edge in locked:
            return False
        if allowed_elements is not None and not (set(elements) & allowed_elements):
            return False
        return True

    worklist = deque(edge for edge in edge_to_elements if edge_is_flippable(edge))
    queued = set(worklist)
    flipped_edges: list[tuple[int, int]] = []
    budget = max(1, max_passes) * max(1, len(edge_to_elements))

    while worklist and budget > 0:
        budget -= 1
        edge = worklist.popleft()
        queued.discard(edge)
        if not edge_is_flippable(edge):
            continue

        a, b = edge
        e1, e2 = edge_to_elements[edge]
        p = next(n for n in element_to_nodes[e1] if n not in edge)
        q = next(n for n in element_to_nodes[e2] if n not in edge)

        points = {n: mesh.points[id_to_index[n], :2] for n in (a, b, p, q)}
        angle_p = _angle_at(points[p], points[a], points[b])
        angle_q = _angle_at(points[q], points[a], points[b])
        if angle_p + angle_q <= 180.0 + 1e-9:
            continue  # already Delaunay-legal for this diagonal

        side_a = signed_area(points[p], points[q], points[a])
        side_b = signed_area(points[p], points[q], points[b])
        if side_a * side_b >= 0:
            continue  # quad p-a-q-b isn't convex: flipping would invert a triangle

        new_t1 = ccw_order(points, p, a, q)
        new_t2 = ccw_order(points, p, q, b)
        write_connectivity(mesh, element_to_block_row[e1], new_t1)
        write_connectivity(mesh, element_to_block_row[e2], new_t2)
        element_to_nodes[e1] = new_t1
        element_to_nodes[e2] = new_t2

        del edge_to_elements[edge]
        edge_to_elements[sorted_edge(p, q)] = [e1, e2]
        # The two "rim" edges touching the old apexes swap which triangle
        # they belong to; the other two rim edges (a-p, q-b) are unaffected.
        reassign_edge(edge_to_elements, sorted_edge(b, p), e1, e2)
        reassign_edge(edge_to_elements, sorted_edge(a, q), e2, e1)

        flipped_edges.append((a, b))

        for touched in (sorted_edge(p, q), sorted_edge(a, p), sorted_edge(q, b), sorted_edge(b, p), sorted_edge(a, q)):
            if touched not in queued and edge_is_flippable(touched):
                worklist.append(touched)
                queued.add(touched)

    after_summary = quality_mod.metrics(mesh)["summary"]
    return {
        "flipped_edges": [list(e) for e in flipped_edges],
        "flip_count": len(flipped_edges),
        "before": before_summary,
        "after": after_summary,
    }


def _angle_at(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> float:
    """Interior angle at `p0`, in degrees, of the triangle `p0`-`p1`-`p2`."""
    v1, v2 = p1 - p0, p2 - p0
    cos_angle = np.dot(v1, v2) / max(float(np.linalg.norm(v1) * np.linalg.norm(v2)), 1e-12)
    return float(np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0))))
