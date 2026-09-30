"""Mesh quality checks surfaced in the Utilities panel."""

from __future__ import annotations

import numpy as np

from ..abaqus_io import Mesh

_2D_TYPES = {"CGAX3", "CGAX4"}


def _signed_area(coords: np.ndarray) -> float:
    x, y = coords[:, 0], coords[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)


def check(mesh: Mesh) -> list[dict]:
    """Returns a list of issues, each `{severity, kind, message, node_ids?, element_id?}`.

    Checks performed: degenerate/inverted 2D elements (non-positive signed
    area), duplicate elements (identical connectivity within a block),
    orphan nodes (not referenced by any element).
    """
    if not mesh:
        return []

    issues: list[dict] = []
    id_to_index = {pid: i for i, pid in enumerate(mesh.point_ids)}
    used_nodes: set[int] = set()

    for block in mesh.cells:
        seen_conn: dict[tuple, int] = {}
        for i, eid in enumerate(block.ids):
            conn = [int(n) for n in block.connectivity[i]]
            used_nodes.update(conn)

            if block.element_type in _2D_TYPES:
                coords = mesh.points[[id_to_index[n] for n in conn], :2]
                area = _signed_area(coords)
                if area <= 0:
                    issues.append(
                        {
                            "severity": "error",
                            "kind": "inverted_element" if area < 0 else "degenerate_element",
                            "message": f"Element {int(eid)} ({block.element_type}) has non-positive area ({area:.6g}).",
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
