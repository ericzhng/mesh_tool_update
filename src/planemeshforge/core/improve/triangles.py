"""CGAX3-only topology helpers shared by `flipping.py` and `refine.py`:
both rewrite triangle connectivity in place and need to know which edges
are interior vs. boundary/locked, and how to keep that bookkeeping in sync
as connectivity changes."""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from ...abaqus_io import Mesh
from ...abaqus_io.deck_utility import surface_pairs


def triangle_topology(
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
                edge_to_elements[sorted_edge(nodes[i], nodes[(i + 1) % 3])].append(eid)

    return element_to_nodes, element_to_block_row, dict(edge_to_elements)


def locked_edges(mesh: Mesh, element_to_nodes: dict[int, list[int]]) -> set[tuple[int, int]]:
    """Edges referenced by a `*SURFACE, TYPE=ELEMENT` face token: a
    physical/contact face, never safe to flip or split away from under the
    user (unlike a plain node position, a face's topology is part of what
    the surface definition means)."""
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
                locked.add(sorted_edge(nodes[face_index], nodes[(face_index + 1) % len(nodes)]))
    return locked


def sorted_edge(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def reassign_edge(
    edge_to_elements: dict[tuple[int, int], list[int]], edge: tuple[int, int], old_id: int, new_id: int
) -> None:
    elements = edge_to_elements.get(edge)
    if elements is None:
        return
    edge_to_elements[edge] = [new_id if eid == old_id else eid for eid in elements]


def signed_area(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))


def ccw_order(points: dict[int, np.ndarray], a: int, b: int, c: int) -> list[int]:
    """Orders 3 node ids so their triangle has non-negative signed area."""
    if signed_area(points[a], points[b], points[c]) >= 0:
        return [a, b, c]
    return [a, c, b]


def write_connectivity(mesh: Mesh, block_row: tuple[int, int], nodes: list[int]) -> None:
    block_index, row = block_row
    mesh.cells[block_index].connectivity[row] = nodes
