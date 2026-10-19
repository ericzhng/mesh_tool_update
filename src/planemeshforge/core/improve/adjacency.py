"""Shared topology queries for the mesh-improvement ops: which nodes are
free to move, which are fixed, and who neighbors whom."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ...abaqus_io import Mesh
from ...abaqus_io.deck_utility import surface_pairs
from .. import quality as quality_mod

_2D_TYPES = set(quality_mod.IDEAL_ANGLE)


@dataclass
class Adjacency:
    """Precomputed node/element topology for one mesh snapshot."""

    id_to_index: dict[int, int]
    node_to_elements: dict[int, list[int]] = field(default_factory=dict)
    node_to_neighbors: dict[int, set[int]] = field(default_factory=dict)
    element_to_nodes: dict[int, list[int]] = field(default_factory=dict)
    element_to_type: dict[int, str] = field(default_factory=dict)
    boundary_node_ids: set[int] = field(default_factory=set)
    fixed_node_ids: set[int] = field(default_factory=set)


def build(
    mesh: Mesh, extra_fixed_node_ids: set[int] | None = None, lock_surface_sets: bool = False
) -> Adjacency:
    """Builds node/element adjacency and the fixed-node set for `mesh`.

    A node is always fixed (never relocated) if it lies on the mesh
    boundary (an edge used by exactly one 2D element), belongs to a 1D
    element (e.g. SFMGAX1), or is explicitly passed in
    `extra_fixed_node_ids`. Interior nodes of 2D elements are free.

    `lock_surface_sets=True` additionally fixes every node referenced by
    any `*SURFACE` set. Off by default: a `*SURFACE, TYPE=ELEMENT` token is
    a topological reference (element id + face label), not a geometric
    constraint, so most of the time there's nothing to protect by locking
    it - and in a real deck, contact/tie surfaces can cover the majority of
    the mesh, which would otherwise make smoothing/flipping unable to touch
    the very elements most in need of it. Opt back in when a surface's
    exact position genuinely matters (e.g. a precisely-defined contact face).
    """
    id_to_index = {pid: i for i, pid in enumerate(mesh.point_ids)}
    node_to_elements: dict[int, list[int]] = defaultdict(list)
    node_to_neighbors: dict[int, set[int]] = defaultdict(set)
    element_to_nodes: dict[int, list[int]] = {}
    element_to_type: dict[int, str] = {}
    edge_counts: dict[tuple[int, int], int] = defaultdict(int)
    line_node_ids: set[int] = set()

    for block in mesh.cells:
        if block.element_type not in _2D_TYPES:
            if block.dim == 1:
                for conn in block.connectivity:
                    line_node_ids.update(int(n) for n in conn)
            continue
        for eid, conn in zip(block.ids, block.connectivity):
            eid = int(eid)
            nodes = [int(n) for n in conn]
            element_to_nodes[eid] = nodes
            element_to_type[eid] = block.element_type
            n = len(nodes)
            for i in range(n):
                a, b = nodes[i], nodes[(i + 1) % n]
                node_to_elements[a].append(eid)
                node_to_neighbors[a].add(b)
                node_to_neighbors[b].add(a)
                edge_counts[tuple(sorted((a, b)))] += 1

    boundary_node_ids: set[int] = set()
    for (a, b), count in edge_counts.items():
        if count == 1:
            boundary_node_ids.add(a)
            boundary_node_ids.add(b)

    surface_node_ids: set[int] = set()
    if lock_surface_sets:
        for tokens in mesh.surface_sets.values():
            for token, _label in surface_pairs(tokens):
                element_ids = [int(token)] if token.lstrip("-").isdigit() else mesh.elem_sets.get(token, [])
                for eid in element_ids:
                    nodes = element_to_nodes.get(int(eid))
                    if nodes:
                        surface_node_ids.update(nodes)

    fixed_node_ids = boundary_node_ids | line_node_ids | surface_node_ids
    if extra_fixed_node_ids:
        fixed_node_ids |= set(extra_fixed_node_ids)

    return Adjacency(
        id_to_index=id_to_index,
        node_to_elements=dict(node_to_elements),
        node_to_neighbors=dict(node_to_neighbors),
        element_to_nodes=element_to_nodes,
        element_to_type=element_to_type,
        boundary_node_ids=boundary_node_ids,
        fixed_node_ids=fixed_node_ids,
    )


def resolve_node_scope(mesh: Mesh, adjacency: Adjacency, scope: dict | None = None) -> set[int]:
    """Resolves a `{mode, element_ids?, limits?, grow_rings?}` scope dict to
    a set of free (non-fixed) node ids a smoothing/flipping pass should touch.

    `mode` is one of `"all"` (default), `"elements"` (expands the nodes of
    `element_ids`), or `"flagged"` (expands the nodes of elements over the
    skewness/aspect-ratio `limits`). `grow_rings` additionally pulls in that
    many layers of neighboring nodes, so a fix blends into its surroundings.
    """
    scope = scope or {}
    mode = scope.get("mode", "all")

    if mode == "all":
        node_ids = set(mesh.point_ids)
    elif mode == "elements":
        element_ids = set(scope.get("element_ids", []))
        node_ids = {n for eid in element_ids for n in adjacency.element_to_nodes.get(eid, [])}
    elif mode == "flagged":
        limits = scope.get("limits", {})
        skew_limit = limits.get("skewness", 0.5)
        aspect_limit = limits.get("aspect_ratio", 5.0)
        result = quality_mod.metrics(mesh)
        flagged_ids = {
            e["id"]
            for e in result["elements"]
            if e["skewness"] >= skew_limit or (e["aspect_ratio"] or 0) >= aspect_limit
        }
        node_ids = {n for eid in flagged_ids for n in adjacency.element_to_nodes.get(eid, [])}
    else:
        raise ValueError(f"Unknown scope mode: {mode!r}")

    for _ in range(int(scope.get("grow_rings", 0))):
        grown = set(node_ids)
        for node_id in node_ids:
            grown.update(adjacency.node_to_neighbors.get(node_id, ()))
        node_ids = grown

    return node_ids - adjacency.fixed_node_ids


def resolve_element_scope(mesh: Mesh, adjacency: Adjacency, scope: dict | None = None) -> set[int] | None:
    """Like `resolve_node_scope`, but resolves to a set of target element
    ids rather than free node ids - used by `flipping.flip_edges`, where
    `"elements"`/`"flagged"` describe which triangles to consider for a
    flip, not which nodes are movable (an edge flip never moves a node, so
    there's no fixed-node concept here). Returns `None` for scope mode
    `"all"`, meaning "don't restrict - consider every element".
    """
    scope = scope or {}
    mode = scope.get("mode", "all")

    if mode == "all":
        element_ids = None
    elif mode == "elements":
        element_ids = set(scope.get("element_ids", []))
    elif mode == "flagged":
        limits = scope.get("limits", {})
        skew_limit = limits.get("skewness", 0.5)
        aspect_limit = limits.get("aspect_ratio", 5.0)
        result = quality_mod.metrics(mesh)
        element_ids = {
            e["id"]
            for e in result["elements"]
            if e["skewness"] >= skew_limit or (e["aspect_ratio"] or 0) >= aspect_limit
        }
    else:
        raise ValueError(f"Unknown scope mode: {mode!r}")

    if element_ids is not None:
        for _ in range(int(scope.get("grow_rings", 0))):
            grown = set(element_ids)
            for eid in element_ids:
                for node_id in adjacency.element_to_nodes.get(eid, []):
                    grown.update(adjacency.node_to_elements.get(node_id, ()))
            element_ids = grown

    return element_ids
