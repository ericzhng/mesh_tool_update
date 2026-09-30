"""Geometric transforms (translate/rotate/scale/mirror) applied to a subset
of a mesh's nodes."""

from __future__ import annotations

import numpy as np

from ..abaqus_io import Mesh


def _pivot(mesh: Mesh, node_ids: list[int], pivot: list[float] | None) -> np.ndarray:
    if pivot is not None:
        return np.array([pivot[0], pivot[1], 0.0])
    indices = [mesh.point_ids.index(i) for i in node_ids]
    return np.append(mesh.points[indices, :2].mean(axis=0), 0.0)


def translate(mesh: Mesh, node_ids: list[int], dx: float, dy: float) -> None:
    """Moves the given nodes by (dx, dy)."""
    indices = [mesh.point_ids.index(i) for i in node_ids]
    mesh.points[indices, 0] += dx
    mesh.points[indices, 1] += dy


def rotate(mesh: Mesh, node_ids: list[int], angle_deg: float, pivot: list[float] | None = None) -> None:
    """Rotates the given nodes by `angle_deg` degrees about `pivot` (defaults to their centroid)."""
    indices = [mesh.point_ids.index(i) for i in node_ids]
    center = _pivot(mesh, node_ids, pivot)
    theta = np.radians(angle_deg)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    rel = mesh.points[indices, :2] - center[:2]
    mesh.points[indices, :2] = rel @ rot.T + center[:2]


def scale(mesh: Mesh, node_ids: list[int], factor_x: float, factor_y: float, pivot: list[float] | None = None) -> None:
    """Scales the given nodes by (factor_x, factor_y) about `pivot` (defaults to their centroid)."""
    indices = [mesh.point_ids.index(i) for i in node_ids]
    center = _pivot(mesh, node_ids, pivot)
    mesh.points[indices, 0] = (mesh.points[indices, 0] - center[0]) * factor_x + center[0]
    mesh.points[indices, 1] = (mesh.points[indices, 1] - center[1]) * factor_y + center[1]


def mirror(mesh: Mesh, node_ids: list[int], axis: str, pivot: list[float] | None = None) -> None:
    """Mirrors the given nodes about a vertical ('y') or horizontal ('x') line through `pivot`."""
    if axis == "x":
        scale(mesh, node_ids, 1.0, -1.0, pivot)
    elif axis == "y":
        scale(mesh, node_ids, -1.0, 1.0, pivot)
    else:
        raise ValueError("axis must be 'x' or 'y'")
