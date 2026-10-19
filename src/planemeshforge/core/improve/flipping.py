"""Edge flipping for triangle pairs: the classic Delaunay max-min-angle
swap, applied without ever moving a node."""

from __future__ import annotations

from collections import defaultdict, deque

import numpy as np

from ...abaqus_io import Mesh
from ...abaqus_io.deck_utility import surface_pairs
from .. import quality as quality_mod
from .adjacency import build as build_adjacency, resolve_element_scope


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

    element_to_nodes, element_to_block_row, edge_to_elements = _triangle_topology(mesh)
    locked_edges = _locked_edges(mesh, element_to_nodes)

    adjacency = build_adjacency(mesh)
    allowed_elements = resolve_element_scope(mesh, adjacency, scope)

    def edge_is_flippable(edge: tuple[int, int]) -> bool:
        elements = edge_to_elements.get(edge)
        if not elements or len(elements) != 2 or edge in locked_edges:
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

        side_a = _signed_area(points[p], points[q], points[a])
        side_b = _signed_area(points[p], points[q], points[b])
        if side_a * side_b >= 0:
            continue  # quad p-a-q-b isn't convex: flipping would invert a triangle

        new_t1 = _ccw_order(points, p, a, q)
        new_t2 = _ccw_order(points, p, q, b)
        _write_connectivity(mesh, element_to_block_row[e1], new_t1)
        _write_connectivity(mesh, element_to_block_row[e2], new_t2)
        element_to_nodes[e1] = new_t1
        element_to_nodes[e2] = new_t2

        del edge_to_elements[edge]
        edge_to_elements[_sorted_edge(p, q)] = [e1, e2]
        # The two "rim" edges touching the old apexes swap which triangle
        # they belong to; the other two rim edges (a-p, q-b) are unaffected.
        _reassign_edge(edge_to_elements, _sorted_edge(b, p), e1, e2)
        _reassign_edge(edge_to_elements, _sorted_edge(a, q), e2, e1)

        flipped_edges.append((a, b))

        for touched in (_sorted_edge(p, q), _sorted_edge(a, p), _sorted_edge(q, b), _sorted_edge(b, p), _sorted_edge(a, q)):
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


def _triangle_topology(
    mesh: Mesh,
) -> tuple[dict[int, list[int]], dict[int, tuple[int, int]], dict[tuple[int, int], list[int]]]:
    """CGAX3-only `element_to_nodes`, `element_to_block_row` (for writing
    connectivity back in place), and `edge -> [element_id, ...]` (1 or 2
    incident triangles per edge)."""
    element_to_nodes: dict[int, list[int]] = {}
    element_to_block_row: dict[int, tuple[int, int]] = {}
    edge_to_elements: dict[tuple[int, int], list[int]] = defaultdict(list)

    for block_index, block in enumerate(mesh.cells):
        if block.element_type != "CGAX3":
            continue
        for row, (eid, conn) in enumerate(zip(block.ids, block.connectivity)):
            eid = int(eid)
            nodes = [int(n) for n in conn]
            element_to_nodes[eid] = nodes
            element_to_block_row[eid] = (block_index, row)
            for i in range(3):
                edge_to_elements[_sorted_edge(nodes[i], nodes[(i + 1) % 3])].append(eid)

    return element_to_nodes, element_to_block_row, dict(edge_to_elements)


def _locked_edges(mesh: Mesh, element_to_nodes: dict[int, list[int]]) -> set[tuple[int, int]]:
    """Edges referenced by a `*SURFACE, TYPE=ELEMENT` face token: a
    physical/contact face, never safe to flip away from under the user."""
    locked: set[tuple[int, int]] = set()
    for tokens in mesh.surface_sets.values():
        for token, label in surface_pairs(tokens):
            if not label or label[:1].upper() != "S" or not label[1:].isdigit():
                continue
            face_index = int(label[1:]) - 1
            element_ids = [int(token)] if token.lstrip("-").isdigit() else mesh.elem_sets.get(token, [])
            for eid in element_ids:
                nodes = element_to_nodes.get(int(eid))
                if not nodes or not (0 <= face_index < len(nodes)):
                    continue
                locked.add(_sorted_edge(nodes[face_index], nodes[(face_index + 1) % len(nodes)]))
    return locked


def _sorted_edge(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def _reassign_edge(edge_to_elements: dict[tuple[int, int], list[int]], edge: tuple[int, int], old_id: int, new_id: int) -> None:
    elements = edge_to_elements.get(edge)
    if elements is None:
        return
    edge_to_elements[edge] = [new_id if eid == old_id else eid for eid in elements]


def _angle_at(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> float:
    """Interior angle at `p0`, in degrees, of the triangle `p0`-`p1`-`p2`."""
    v1, v2 = p1 - p0, p2 - p0
    cos_angle = np.dot(v1, v2) / max(float(np.linalg.norm(v1) * np.linalg.norm(v2)), 1e-12)
    return float(np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0))))


def _signed_area(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))


def _ccw_order(points: dict[int, np.ndarray], a: int, b: int, c: int) -> list[int]:
    """Orders 3 node ids so their triangle has non-negative signed area."""
    if _signed_area(points[a], points[b], points[c]) >= 0:
        return [a, b, c]
    return [a, c, b]


def _write_connectivity(mesh: Mesh, block_row: tuple[int, int], nodes: list[int]) -> None:
    block_index, row = block_row
    mesh.cells[block_index].connectivity[row] = nodes
