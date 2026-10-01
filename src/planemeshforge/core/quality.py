"""Mesh quality checks surfaced in the Utilities panel."""

from __future__ import annotations

from ..abaqus_io import Mesh
from .topology import signed_areas

_2D_TYPES = {"CGAX3", "CGAX4"}


def check(mesh: Mesh) -> list[dict]:
    """Returns a list of issues, each `{severity, kind, message, node_ids?, element_id?}`.

    Checks performed: inverted/degenerate 2D elements (non-positive signed
    area), duplicate elements (identical connectivity within a block),
    orphan nodes (not referenced by any element).

    Inverted (clockwise-wound) elements are normally prevented by
    `topology.orient_ccw`, which `MeshEditor` runs after every edit and
    load, so this mostly only ever flags genuinely degenerate elements.
    """
    if not mesh:
        return []

    issues: list[dict] = []
    used_nodes: set[int] = set()

    for block in mesh.cells:
        seen_conn: dict[tuple, int] = {}
        areas = signed_areas(mesh.points, mesh.point_ids, block.connectivity) if block.element_type in _2D_TYPES else None
        for i, eid in enumerate(block.ids):
            conn = [int(n) for n in block.connectivity[i]]
            used_nodes.update(conn)

            if areas is not None:
                area = areas[i]
                if area <= 0:
                    kind = "inverted_element" if area < 0 else "degenerate_element"
                    detail = "non-positive area" if area < 0 else "zero area (collinear/coincident nodes)"
                    issues.append(
                        {
                            "severity": "error",
                            "kind": kind,
                            "message": f"Element {int(eid)} ({block.element_type}) has {detail} ({area:.6g}).",
                            "element_id": int(eid),
                            "node_ids": conn,
                        }
                    )

            key = tuple(sorted(conn))
            if key in seen_conn:
                issues.append(
                    {
                        "severity": "warning",
                        "kind": "duplicate_element",
                        "message": f"Element {int(eid)} duplicates element {seen_conn[key]} ({block.element_type}).",
                        "element_id": int(eid),
                        "node_ids": conn,
                    }
                )
            else:
                seen_conn[key] = int(eid)

    for pid in mesh.point_ids:
        if pid not in used_nodes:
            issues.append(
                {
                    "severity": "info",
                    "kind": "orphan_node",
                    "message": f"Node {pid} is not used by any element.",
                    "node_ids": [pid],
                }
            )

    return issues
