"""Mesh quality checks surfaced in the Utilities panel."""

from __future__ import annotations

import numpy as np

from ..abaqus_io import Mesh
from .topology import signed_areas

_2D_TYPES = {"CGAX3", "CGAX4"}

# Equiangle-skew reference angle (degrees) for each 2D element type: the
# interior angle of the "ideal" (equilateral triangle / square) shape.
_IDEAL_ANGLE = {"CGAX3": 60.0, "CGAX4": 90.0}


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


def metrics(mesh: Mesh) -> dict:
    """Per-element shape-quality metrics for every 2D element.

    For each element, computes `area`, `aspect_ratio` (longest edge /
    shortest edge, `None` if degenerate), `min_angle`/`max_angle` (interior
    angles in degrees), and `skewness` (equiangle skew against the ideal
    angle for the element type - 60 deg for triangles, 90 deg for quads;
    0 = ideal shape, 1 = degenerate).

    Returns `{"elements": [...], "summary": {metric: {min, mean, max}}}`.
    """
    if not mesh:
        return {"elements": [], "summary": {}}

    id_to_index = {pid: i for i, pid in enumerate(mesh.point_ids)}
    elements: list[dict] = []

    for block in mesh.cells:
        ideal_angle = _IDEAL_ANGLE.get(block.element_type)
        if ideal_angle is None or block.connectivity.size == 0:
            continue

        indices = np.vectorize(id_to_index.get)(block.connectivity)
        pts = mesh.points[indices][..., :2]  # (n_elements, n_nodes, 2)
        next_pts = np.roll(pts, -1, axis=1)
        prev_pts = np.roll(pts, 1, axis=1)

        edge_lens = np.linalg.norm(next_pts - pts, axis=2)
        min_edge = edge_lens.min(axis=1)
        max_edge = edge_lens.max(axis=1)
        degenerate = min_edge <= 1e-12
        aspect_ratio = np.where(degenerate, np.inf, max_edge / np.where(degenerate, 1.0, min_edge))

        v1 = prev_pts - pts
        v2 = next_pts - pts
        dot = np.sum(v1 * v2, axis=2)
        norms = np.linalg.norm(v1, axis=2) * np.linalg.norm(v2, axis=2)
        cos_angle = np.clip(np.divide(dot, norms, out=np.zeros_like(dot), where=norms > 1e-12), -1.0, 1.0)
        angles = np.degrees(np.arccos(cos_angle))
        min_angle = angles.min(axis=1)
        max_angle = angles.max(axis=1)

        skewness = np.maximum((max_angle - ideal_angle) / (180.0 - ideal_angle), (ideal_angle - min_angle) / ideal_angle)
        skewness = np.where(degenerate, 1.0, np.clip(skewness, 0.0, 1.0))

        areas = signed_areas(mesh.points, mesh.point_ids, block.connectivity)

        for i, eid in enumerate(block.ids):
            elements.append(
                {
                    "id": int(eid),
                    "type": block.element_type,
                    "area": float(areas[i]),
                    "aspect_ratio": None if np.isinf(aspect_ratio[i]) else float(aspect_ratio[i]),
                    "min_angle": float(min_angle[i]),
                    "max_angle": float(max_angle[i]),
                    "skewness": float(skewness[i]),
                }
            )

    summary = {}
    for key in ("area", "aspect_ratio", "min_angle", "max_angle", "skewness"):
        vals = [e[key] for e in elements if e[key] is not None]
        if vals:
            summary[key] = {"min": min(vals), "mean": sum(vals) / len(vals), "max": max(vals)}

    return {"elements": elements, "summary": summary}
