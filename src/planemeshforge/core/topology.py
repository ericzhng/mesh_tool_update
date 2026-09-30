"""Structural mesh-editing helpers: id allocation, node merging, renumbering,
and quad-to-triangle splitting."""

from __future__ import annotations

import numpy as np

from ..abaqus_io import Mesh, ElementBlock


def merge_element_blocks(blocks: list[ElementBlock]) -> list[ElementBlock]:
    """Concatenates blocks into one block per element type.

    Unlike `ElementBlock.unique_cat`, this keeps element types that occur in
    only a single block instead of dropping them.
    """
    by_type: dict[str, list[ElementBlock]] = {}
    order: list[str] = []
    for block in blocks:
        if len(block.ids) == 0:
            continue
        if block.element_type not in by_type:
            by_type[block.element_type] = []
            order.append(block.element_type)
        by_type[block.element_type].append(block)

    merged = []
    for element_type in order:
        group = by_type[element_type]
        ids = np.concatenate([b.ids for b in group])
        connectivity = np.concatenate([b.connectivity for b in group])
        merged.append(ElementBlock(element_type, ids, connectivity))
    return merged


def next_point_id(mesh: Mesh) -> int:
    """Returns an unused node id, one greater than the current maximum."""
    return (max(mesh.point_ids) + 1) if mesh.point_ids else 1


def next_element_id(mesh: Mesh) -> int:
    """Returns an unused element id, one greater than the current maximum."""
    max_id = 0
    for block in mesh.cells:
        if len(block.ids):
            max_id = max(max_id, int(block.ids.max()))
    return max_id + 1


def merge_coincident_nodes(mesh: Mesh, tolerance: float = 1e-6, node_ids: list[int] | None = None) -> dict[int, int]:
    """Merges nodes that are within `tolerance` of each other.

    If `node_ids` is given, only those nodes are considered as merge
    candidates (each is merged into the lowest-id coincident node found
    anywhere in the mesh); otherwise all nodes are checked pairwise.

    Returns a mapping of {removed_node_id: kept_node_id}. Mutates `mesh` in
    place: removed nodes are dropped and every element/set reference is
    remapped to the kept node.
    """
    candidate_ids = set(node_ids) if node_ids is not None else set(mesh.point_ids)
    id_to_index = {pid: i for i, pid in enumerate(mesh.point_ids)}

    merge_map: dict[int, int] = {}
    n = len(mesh.point_ids)
    for i in range(n):
        id_i = mesh.point_ids[i]
        if id_i in merge_map:
            continue
        for j in range(i + 1, n):
            id_j = mesh.point_ids[j]
            if id_j in merge_map:
                continue
            if id_i not in candidate_ids and id_j not in candidate_ids:
                continue
            if np.linalg.norm(mesh.points[i] - mesh.points[j]) <= tolerance:
                kept, removed = (id_i, id_j) if id_i < id_j else (id_j, id_i)
                merge_map[removed] = kept

    if not merge_map:
        return {}

    remove_indices = [id_to_index[rid] for rid in merge_map]
    mesh.points = np.delete(mesh.points, remove_indices, axis=0)
    mesh.point_ids = [pid for pid in mesh.point_ids if pid not in merge_map]

    def remap(node_id):
        return merge_map.get(node_id, node_id)

    for block in mesh.cells:
        block.connectivity = np.vectorize(remap)(block.connectivity) if block.connectivity.size else block.connectivity

    for name, ids in mesh.node_sets.items():
        mesh.node_sets[name] = sorted({remap(i) for i in ids})

    mesh._validate_data()
    return merge_map


def renumber(mesh: Mesh, start: int = 1) -> tuple[dict[int, int], dict[int, int]]:
    """Renumbers node and element ids sequentially, preserving current order.

    Returns (node_id_map, element_id_map) of {old_id: new_id}.
    """
    node_id_map = {old: start + i for i, old in enumerate(mesh.point_ids)}
    mesh.point_ids = [node_id_map[old] for old in mesh.point_ids]

    for block in mesh.cells:
        if block.connectivity.size:
            block.connectivity = np.vectorize(node_id_map.get)(block.connectivity)

    for name, ids in mesh.node_sets.items():
        mesh.node_sets[name] = sorted(node_id_map[i] for i in ids)

    element_id_map: dict[int, int] = {}
    next_id = start
    for block in mesh.cells:
        for i in range(len(block.ids)):
            element_id_map[int(block.ids[i])] = next_id
            next_id += 1
        block.ids = np.array([element_id_map[int(old)] for old in block.ids], dtype=np.int32)

    for name, ids in mesh.elem_sets.items():
        mesh.elem_sets[name] = sorted(element_id_map[i] for i in ids)

    mesh._validate_data()
    return node_id_map, element_id_map


def split_quads(mesh: Mesh, element_ids: list[int]) -> list[int]:
    """Splits the given CGAX4 (quad) elements into pairs of CGAX3 triangles.

    Returns the ids of the newly created triangle elements. The original quad
    elements are removed.
    """
    target_ids = set(element_ids)
    new_ids: list[int] = []
    new_conn: list[list[int]] = []
    next_id = next_element_id(mesh)

    remaining_blocks = []
    for block in mesh.cells:
        if block.element_type != "CGAX4":
            remaining_blocks.append(block)
            continue

        keep_mask = np.ones(len(block.ids), dtype=bool)
        for i, eid in enumerate(block.ids):
            if int(eid) not in target_ids:
                continue
            keep_mask[i] = False
            a, b, c, d = (int(x) for x in block.connectivity[i])
            new_conn.append([a, b, c])
            new_ids.append(next_id)
            next_id += 1
            new_conn.append([a, c, d])
            new_ids.append(next_id)
            next_id += 1

        if keep_mask.any():
            remaining_blocks.append(ElementBlock(block.element_type, block.ids[keep_mask], block.connectivity[keep_mask]))

    mesh.cells = remaining_blocks
    if new_conn:
        tri_block = ElementBlock("CGAX3", np.array(new_ids), np.array(new_conn))
        mesh.cells = merge_element_blocks(mesh.cells + [tri_block])

    mesh._validate_data()
    return new_ids
