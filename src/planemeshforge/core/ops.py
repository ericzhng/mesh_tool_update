"""The mutation operations the editor exposes to the client.

Every op is a plain function `(mesh, **args) -> dict`. It mutates `mesh` in
place and returns a small result payload (e.g. server-assigned ids). Raise
`ValueError` for invalid input; `MeshEditor.apply` will roll back to the
pre-op snapshot and surface the message to the client.
"""

from __future__ import annotations

import numpy as np

from ..abaqus_io import Mesh, ElementBlock
from . import transform as tf
from . import topology as topo


def _require_mesh(mesh: Mesh | None) -> Mesh:
    if mesh is None:
        raise ValueError("No mesh is loaded.")
    return mesh


def _node_indices(mesh: Mesh, ids: list[int]) -> list[int]:
    try:
        return [mesh.point_ids.index(i) for i in ids]
    except ValueError as exc:
        raise ValueError(f"Unknown node id referenced: {exc}") from None


def add_nodes(mesh: Mesh | None, nodes: list[dict]) -> dict:
    """Adds nodes. Each item may include an explicit `id`, else one is assigned.

    If no mesh exists yet, creates one (this is how a brand-new project gets
    its first nodes). In that case the result carries the new mesh under
    `"mesh"` for `MeshEditor.apply` to install.
    """
    created_mesh = mesh is None
    if mesh is None:
        mesh = Mesh(points=np.zeros((0, 3)), point_ids=[], cells=[])

    existing = set(mesh.point_ids)
    next_id = topo.next_point_id(mesh)

    created_ids = []
    new_points = []
    for node in nodes:
        node_id = node.get("id")
        if node_id is None or node_id in existing:
            node_id = next_id
            next_id += 1
        existing.add(node_id)
        created_ids.append(node_id)
        new_points.append([node.get("x", 0.0), node.get("y", 0.0), node.get("z", 0.0)])

    mesh.points = np.vstack([mesh.points, new_points]) if len(mesh.points) else np.array(new_points)
    mesh.point_ids.extend(created_ids)

    result = {"created_ids": created_ids}
    if created_mesh:
        result["mesh"] = mesh
    return result


def delete_nodes(mesh: Mesh, ids: list[int]) -> dict:
    """Deletes nodes, cascading to elements, sets, and set membership that reference them."""
    mesh = _require_mesh(mesh)
    id_set = set(ids)
    indices = _node_indices(mesh, ids)

    mesh.points = np.delete(mesh.points, indices, axis=0)
    mesh.point_ids = [pid for pid in mesh.point_ids if pid not in id_set]

    for name in list(mesh.node_sets):
        mesh.node_sets[name] = [i for i in mesh.node_sets[name] if i not in id_set]

    removed_element_ids = []
    remaining_blocks = []
    for block in mesh.cells:
        if block.connectivity.size:
            mask = np.isin(block.connectivity, list(id_set), invert=True).all(axis=1)
        else:
            mask = np.ones(len(block.ids), dtype=bool)
        removed_element_ids.extend(int(e) for e in block.ids[~mask])
        block.ids = block.ids[mask]
        block.connectivity = block.connectivity[mask]
        remaining_blocks.append(block)
    mesh.cells = remaining_blocks

    removed_set = set(removed_element_ids)
    for name in list(mesh.elem_sets):
        mesh.elem_sets[name] = [i for i in mesh.elem_sets[name] if i not in removed_set]
    topo.remap_surface_sets(mesh, removed_element_ids=removed_element_ids)

    return {"removed_element_ids": removed_element_ids}


def move_nodes(mesh: Mesh, nodes: list[dict]) -> dict:
    """Sets absolute (x, y) for each `{id, x, y}` entry."""
    mesh = _require_mesh(mesh)
    for node in nodes:
        idx = mesh.point_ids.index(node["id"])
        mesh.points[idx, 0] = node["x"]
        mesh.points[idx, 1] = node["y"]
    return {}


def add_elements(mesh: Mesh, element_type: str, connectivity: list[list[int]]) -> dict:
    """Creates one or more elements of `element_type` (e.g. SFMGAX1/CGAX3/CGAX4)."""
    mesh = _require_mesh(mesh)
    known_ids = set(mesh.point_ids)
    for conn in connectivity:
        missing = [n for n in conn if n not in known_ids]
        if missing:
            raise ValueError(f"Unknown node id(s) in element connectivity: {missing}")

    next_id = topo.next_element_id(mesh)
    created_ids = list(range(next_id, next_id + len(connectivity)))
    new_block = ElementBlock(element_type, created_ids, connectivity)
    mesh.cells = topo.merge_element_blocks(mesh.cells + [new_block])
    return {"created_ids": created_ids}


def delete_elements(mesh: Mesh, ids: list[int]) -> dict:
    """Deletes elements by id, and drops them from any element sets."""
    mesh = _require_mesh(mesh)
    id_set = set(ids)
    remaining_blocks = []
    for block in mesh.cells:
        mask = ~np.isin(block.ids, list(id_set))
        block.ids = block.ids[mask]
        block.connectivity = block.connectivity[mask]
        remaining_blocks.append(block)
    mesh.cells = remaining_blocks

    for name in list(mesh.elem_sets):
        mesh.elem_sets[name] = [i for i in mesh.elem_sets[name] if i not in id_set]
    topo.remap_surface_sets(mesh, removed_element_ids=ids)
    return {}


_TRANSFORM_KINDS = {
    "translate": lambda mesh, ids, p: tf.translate(mesh, ids, p["dx"], p["dy"]),
    "rotate": lambda mesh, ids, p: tf.rotate(mesh, ids, p["angle_deg"], p.get("pivot")),
    "scale": lambda mesh, ids, p: tf.scale(mesh, ids, p["factor_x"], p["factor_y"], p.get("pivot")),
    "mirror": lambda mesh, ids, p: tf.mirror(mesh, ids, p["axis"], p.get("pivot")),
}


def transform(mesh: Mesh, node_ids: list[int], kind: str, params: dict) -> dict:
    """Applies a translate/rotate/scale/mirror transform to the given nodes."""
    mesh = _require_mesh(mesh)
    if kind not in _TRANSFORM_KINDS:
        raise ValueError(f"Unknown transform kind: {kind}")
    _node_indices(mesh, node_ids)  # validates ids exist
    _TRANSFORM_KINDS[kind](mesh, node_ids, params or {})
    return {}


def merge_nodes(mesh: Mesh, ids: list[int] | None = None, tolerance: float = 1e-6) -> dict:
    """Merges coincident nodes (within `tolerance`), restricted to `ids` if given."""
    mesh = _require_mesh(mesh)
    merge_map = topo.merge_coincident_nodes(mesh, tolerance=tolerance, node_ids=ids)
    return {"merged": merge_map}


def fix_orientation(mesh: Mesh) -> dict:
    """Reverses the node order of any clockwise-wound 2D element."""
    mesh = _require_mesh(mesh)
    reversed_ids = topo.orient_ccw(mesh)
    return {"reversed_ids": reversed_ids}


def renumber(mesh: Mesh, start: int = 1) -> dict:
    """Renumbers node and element ids sequentially from `start`."""
    mesh = _require_mesh(mesh)
    node_map, element_map = topo.renumber(mesh, start=start)
    return {"node_id_map": node_map, "element_id_map": element_map}


def split_quads(mesh: Mesh, element_ids: list[int]) -> dict:
    """Splits the given quad (CGAX4) elements into triangle (CGAX3) pairs."""
    mesh = _require_mesh(mesh)
    created_ids = topo.split_quads(mesh, element_ids)
    return {"created_ids": created_ids}


def triangulate(mesh: Mesh, triangles: list[list[int]]) -> dict:
    """Creates CGAX3 elements from client-computed triangle indices (e.g. Delaunay)."""
    return add_elements(mesh, "CGAX3", triangles)


def _set_dict(mesh: Mesh, set_kind: str) -> dict:
    if set_kind == "node":
        return mesh.node_sets
    if set_kind == "element":
        return mesh.elem_sets
    if set_kind == "surface":
        return mesh.surface_sets
    raise ValueError("set_kind must be 'node', 'element', or 'surface'")


def _require_simple_set_kind(set_kind: str) -> None:
    if set_kind not in ("node", "element"):
        raise ValueError("set_kind must be 'node' or 'element' for this operation; use create_surface for surfaces.")


def _element_node_counts(mesh: Mesh) -> dict[int, int]:
    counts: dict[int, int] = {}
    for block in mesh.cells:
        for element_id, conn in zip(block.ids, block.connectivity):
            counts[int(element_id)] = len(conn)
    return counts


def create_set(mesh: Mesh, set_kind: str, name: str, ids: list[int]) -> dict:
    """Creates (or overwrites) a node/element set with the given members."""
    mesh = _require_mesh(mesh)
    _require_simple_set_kind(set_kind)
    _set_dict(mesh, set_kind)[name] = sorted(set(ids))
    return {}


def create_surface(mesh: Mesh, name: str, faces: list[list[int]]) -> dict:
    """Creates (or overwrites) a surface set from `(element_id, face_index)` pairs.

    `face_index` is 0-based (edge between `node_ids[i]` and the next node),
    matching Abaqus face labels `S1`, `S2`, ... (`face_index + 1`). Abaqus
    lets a `*SURFACE, TYPE=ELEMENT` line reference an element id directly
    (no backing `*ELSET` needed), so each face becomes its own
    `elementId, Sn` token pair.
    """
    mesh = _require_mesh(mesh)
    if not faces:
        raise ValueError("No faces given to create a surface from.")

    node_counts = _element_node_counts(mesh)
    pairs: list[tuple[int, str]] = []
    for element_id, face_index in faces:
        element_id = int(element_id)
        face_index = int(face_index)
        num_nodes = node_counts.get(element_id)
        if num_nodes is None:
            raise ValueError(f"Unknown element id referenced: {element_id}")
        if num_nodes < 3:
            raise ValueError(f"Element {element_id} is not a 2D element; it has no faces.")
        if not (0 <= face_index < num_nodes):
            raise ValueError(f"Face index {face_index} out of range for element {element_id}.")
        pairs.append((element_id, f"S{face_index + 1}"))

    tokens: list[str] = []
    for element_id, label in sorted(set(pairs)):
        tokens.extend([str(element_id), label])

    mesh.surface_sets[name] = tokens
    return {}


def delete_set(mesh: Mesh, set_kind: str, name: str) -> dict:
    """Deletes a node/element/surface set."""
    mesh = _require_mesh(mesh)
    _set_dict(mesh, set_kind).pop(name, None)
    return {}


def rename_set(mesh: Mesh, set_kind: str, name: str, new_name: str) -> dict:
    """Renames a node/element/surface set."""
    mesh = _require_mesh(mesh)
    sets = _set_dict(mesh, set_kind)
    if name not in sets:
        raise ValueError(f"Set '{name}' does not exist.")
    if new_name in sets:
        raise ValueError(f"A set named '{new_name}' already exists.")
    sets[new_name] = sets.pop(name)
    return {}


def set_add_members(mesh: Mesh, set_kind: str, name: str, ids: list[int]) -> dict:
    """Adds ids to an existing (or new) node/element set."""
    mesh = _require_mesh(mesh)
    _require_simple_set_kind(set_kind)
    sets = _set_dict(mesh, set_kind)
    sets[name] = sorted(set(sets.get(name, [])) | set(ids))
    return {}


def set_remove_members(mesh: Mesh, set_kind: str, name: str, ids: list[int]) -> dict:
    """Removes ids from a node/element set."""
    mesh = _require_mesh(mesh)
    _require_simple_set_kind(set_kind)
    sets = _set_dict(mesh, set_kind)
    if name in sets:
        remove = set(ids)
        sets[name] = [i for i in sets[name] if i not in remove]
    return {}


def clear_mesh(mesh: Mesh) -> dict:
    """No-op placeholder; clearing is handled by the editor replacing the mesh entirely."""
    return {}


OPS = {
    "add_nodes": add_nodes,
    "delete_nodes": delete_nodes,
    "move_nodes": move_nodes,
    "add_elements": add_elements,
    "delete_elements": delete_elements,
    "transform": transform,
    "merge_nodes": merge_nodes,
    "fix_orientation": fix_orientation,
    "renumber": renumber,
    "split_quads": split_quads,
    "triangulate": triangulate,
    "create_set": create_set,
    "create_surface": create_surface,
    "delete_set": delete_set,
    "rename_set": rename_set,
    "set_add_members": set_add_members,
    "set_remove_members": set_remove_members,
}
