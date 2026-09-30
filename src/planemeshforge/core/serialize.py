"""Conversion between `Mesh` objects and JSON-serializable dicts, and the
client-facing element type registry."""

from __future__ import annotations

import numpy as np

from ..abaqus_io import Mesh, ElementBlock
from ..abaqus_io._common import read_config


def element_type_registry() -> dict:
    """Returns the supported element types and their dimensionality/node count.

    Used by the frontend to know which element types are valid to create and
    how many nodes each one needs.
    """
    return read_config()


def mesh_to_dict(mesh: Mesh | None) -> dict:
    """Converts a Mesh object to a JSON-serializable dictionary."""
    if not mesh:
        return {"nodes": [], "elements": [], "node_sets": {}, "element_sets": {}, "surface_sets": {}}

    nodes = [
        {"id": int(pid), "x": float(p[0]), "y": float(p[1]), "z": float(p[2])}
        for pid, p in zip(mesh.point_ids, mesh.points)
    ]

    elements = []
    for cell_block in mesh.cells:
        for i, element_id in enumerate(cell_block.ids):
            elements.append(
                {
                    "id": int(element_id),
                    "type": cell_block.element_type,
                    "node_ids": [int(n) for n in cell_block.connectivity[i]],
                }
            )

    return {
        "nodes": nodes,
        "elements": elements,
        "node_sets": {k: [int(i) for i in v] for k, v in mesh.node_sets.items()},
        "element_sets": {k: [int(i) for i in v] for k, v in mesh.elem_sets.items()},
        "surface_sets": mesh.surface_sets,
    }


def dict_to_mesh(mesh_dict: dict | None) -> Mesh | None:
    """Converts a mesh dictionary (as produced by `mesh_to_dict`) back into a Mesh."""
    if not mesh_dict or not mesh_dict.get("nodes"):
        return None

    nodes = mesh_dict.get("nodes", [])
    points = np.array([[n["x"], n["y"], n.get("z", 0)] for n in nodes])
    point_ids = [n["id"] for n in nodes]

    elements_by_type: dict[str, dict[str, list]] = {}
    for element in mesh_dict.get("elements", []):
        el_type = element["type"]
        bucket = elements_by_type.setdefault(el_type, {"ids": [], "connectivity": []})
        bucket["ids"].append(element["id"])
        bucket["connectivity"].append(element["node_ids"])

    cells = [
        ElementBlock(element_type=el_type, ids=np.array(data["ids"]), connectivity=np.array(data["connectivity"]))
        for el_type, data in elements_by_type.items()
    ]

    return Mesh(
        points=points,
        point_ids=point_ids,
        cells=cells,
        node_sets=mesh_dict.get("node_sets", {}),
        elem_sets=mesh_dict.get("element_sets", {}),
        surface_sets=mesh_dict.get("surface_sets", {}),
    )


def mesh_summary(mesh: Mesh | None) -> dict:
    """Returns node/element/set counts for the status bar."""
    if not mesh:
        return {
            "num_nodes": 0,
            "num_elements": 0,
            "num_node_sets": 0,
            "num_element_sets": 0,
            "num_surface_sets": 0,
        }

    return {
        "num_nodes": len(mesh.points),
        "num_elements": sum(len(block.ids) for block in mesh.cells),
        "num_node_sets": len(mesh.node_sets),
        "num_element_sets": len(mesh.elem_sets),
        "num_surface_sets": len(mesh.surface_sets),
    }
