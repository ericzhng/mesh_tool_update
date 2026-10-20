import unittest

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh
from planemeshforge.core import quality
from planemeshforge.core.improve import adjacency
from planemeshforge.core.improve.flipping import flip_edges
from planemeshforge.core.improve.pipeline import improve_quality
from planemeshforge.core.improve.presets import PRESETS
from planemeshforge.core.improve.refine import refine_quads, refine_slivers
from planemeshforge.core.improve.smoothing import smooth_nodes


def _structured_grid(n: int = 4, jitter: float = 0.15, seed: int = 0) -> Mesh:
    """An n x n grid of unit squares, split into triangles, with jittered
    interior nodes (boundary nodes stay exactly on the unit square)."""
    rng = np.random.default_rng(seed)
    ids = {}
    points = []
    pid = 1
    for j in range(n + 1):
        for i in range(n + 1):
            ids[(i, j)] = pid
            x, y = float(i) / n, float(j) / n
            boundary = i in (0, n) or j in (0, n)
            if not boundary:
                x += rng.uniform(-jitter, jitter) / n
                y += rng.uniform(-jitter, jitter) / n
            points.append([x, y, 0.0])
            pid += 1

    conn = []
    for j in range(n):
        for i in range(n):
            a, b, c, d = ids[(i, j)], ids[(i + 1, j)], ids[(i + 1, j + 1)], ids[(i, j + 1)]
            conn.append([a, b, c])
            conn.append([a, c, d])

    tri = ElementBlock("CGAX3", list(range(1, len(conn) + 1)), conn)
    return Mesh(points=np.array(points), point_ids=list(ids.values()), cells=[tri])


class TestAdjacency(unittest.TestCase):
    def test_boundary_nodes_are_fixed(self):
        mesh = _structured_grid(n=3, jitter=0.0)
        adj = adjacency.build(mesh)
        corner = mesh.point_ids[0]  # (0, 0)
        self.assertIn(corner, adj.boundary_node_ids)
        self.assertIn(corner, adj.fixed_node_ids)

    def test_interior_node_is_free(self):
        mesh = _structured_grid(n=4, jitter=0.0)
        adj = adjacency.build(mesh)
        interior_ids = set(mesh.point_ids) - adj.boundary_node_ids
        self.assertTrue(interior_ids)
        for node_id in interior_ids:
            self.assertNotIn(node_id, adj.fixed_node_ids)

    @staticmethod
    def _grid_3x3_with_interior_surface_edge():
        """A 3x3-node grid (8 triangles) with a surface face on the
        *interior* diagonal edge (2, 5) - node 5 is the fully interior
        center node, never on the true mesh boundary. Used to tell apart
        "this node is on a physical surface" from "this node is on the
        mesh boundary", which a single-ring mesh (every surface edge also
        happens to be the outer boundary) can't distinguish."""
        points = np.array(
            [
                [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0],
                [0.0, 1.0, 0.0], [1.0, 1.0, 0.0], [2.0, 1.0, 0.0],
                [0.0, 2.0, 0.0], [1.0, 2.0, 0.0], [2.0, 2.0, 0.0],
            ]
        )
        conn = [
            [1, 2, 5], [1, 5, 4],
            [2, 3, 6], [2, 6, 5],
            [4, 5, 8], [4, 8, 7],
            [5, 6, 9], [5, 9, 8],
        ]
        tri = ElementBlock("CGAX3", list(range(1, 9)), conn)
        # Face S2 of element 1 ([1, 2, 5]) is the edge between nodes 2 and
        # 5 - shared with element 4 ([2, 6, 5]), i.e. interior.
        return Mesh(points=points, point_ids=list(range(1, 10)), cells=[tri], surface_sets={"s1": ["1", "S2"]})

    def test_surface_set_nodes_are_not_fixed_by_default(self):
        mesh = self._grid_3x3_with_interior_surface_edge()
        adj = adjacency.build(mesh)
        self.assertNotIn(5, adj.boundary_node_ids)
        self.assertNotIn(5, adj.fixed_node_ids)

    def test_lock_surface_sets_opts_into_fixing_surface_nodes(self):
        mesh = self._grid_3x3_with_interior_surface_edge()
        adj = adjacency.build(mesh, lock_surface_sets=True)
        self.assertIn(5, adj.fixed_node_ids)


class TestSmoothNodes(unittest.TestCase):
    def test_rejects_unknown_method(self):
        mesh = _structured_grid()
        with self.assertRaises(ValueError):
            smooth_nodes(mesh, method="bogus")

    def test_rejects_missing_mesh(self):
        with self.assertRaises(ValueError):
            smooth_nodes(None)

    def test_smart_laplacian_reduces_skewness_without_moving_boundary(self):
        mesh = _structured_grid(n=5, jitter=0.4, seed=1)
        adj = adjacency.build(mesh)
        boundary_before = {pid: mesh.points[adj.id_to_index[pid]].copy() for pid in adj.boundary_node_ids}
        before_summary = quality.metrics(mesh)["summary"]

        result = smooth_nodes(mesh, iterations=20)

        self.assertLess(result["after"]["skewness"]["mean"], before_summary["skewness"]["mean"])
        self.assertLessEqual(result["after"]["skewness"]["max"], before_summary["skewness"]["max"] + 1e-9)

        for pid, original in boundary_before.items():
            np.testing.assert_array_equal(mesh.points[adj.id_to_index[pid]], original)

    def test_smart_laplacian_never_inverts_an_element(self):
        mesh = _structured_grid(n=5, jitter=0.4, seed=2)
        smooth_nodes(mesh, iterations=20)
        for block in mesh.cells:
            areas = quality.check(mesh)
            self.assertFalse(any(i["kind"] in ("inverted_element", "degenerate_element") for i in areas))

    def test_preserves_ids_and_sets(self):
        mesh = _structured_grid(n=4, jitter=0.3, seed=3)
        mesh.elem_sets["some"] = [1, 2, 3]
        before_ids = list(mesh.point_ids)
        before_element_ids = [list(b.ids) for b in mesh.cells]

        smooth_nodes(mesh, iterations=10)

        self.assertEqual(mesh.point_ids, before_ids)
        self.assertEqual([list(b.ids) for b in mesh.cells], before_element_ids)
        self.assertEqual(mesh.elem_sets["some"], [1, 2, 3])

    def test_scope_elements_only_moves_requested_region(self):
        mesh = _structured_grid(n=6, jitter=0.3, seed=4)
        adj = adjacency.build(mesh)
        far_boundary_adjacent = next(iter(adj.boundary_node_ids))
        # Pick one element far from any particular node to keep this simple:
        # scope to a single element and confirm nodes outside its 0-ring
        # (and all boundary nodes) never move.
        target_element = next(iter(adj.element_to_nodes))
        result = smooth_nodes(mesh, scope={"mode": "elements", "element_ids": [target_element]}, iterations=5)
        allowed = set(adj.element_to_nodes[target_element]) - adj.fixed_node_ids
        self.assertTrue(set(result["moved_node_ids"]) <= allowed)

    def test_laplacian_method_moves_interior_nodes(self):
        mesh = _structured_grid(n=4, jitter=0.3, seed=5)
        result = smooth_nodes(mesh, method="laplacian", iterations=1, omega=1.0)
        self.assertTrue(result["moved_node_ids"])

    def test_op_registered_and_undoable_via_editor(self):
        from planemeshforge.core.editor import MeshEditor

        mesh = _structured_grid(n=4, jitter=0.3, seed=6)
        editor = MeshEditor(mesh)
        before_points = mesh.points.copy()

        response = editor.apply("smooth_nodes", {"iterations": 10})
        self.assertTrue(response["ok"])

        self.assertTrue(editor.undo())
        np.testing.assert_array_equal(editor.mesh.points, before_points)


class TestImproveQuality(unittest.TestCase):
    def test_rejects_missing_mesh(self):
        with self.assertRaises(ValueError):
            improve_quality(None, preset="gentle")

    def test_requires_exactly_one_of_steps_or_preset(self):
        mesh = _structured_grid()
        with self.assertRaises(ValueError):
            improve_quality(mesh)
        with self.assertRaises(ValueError):
            improve_quality(mesh, steps=[{"op": "smooth_nodes"}], preset="gentle")

    def test_rejects_disallowed_step_op(self):
        mesh = _structured_grid()
        with self.assertRaises(ValueError):
            improve_quality(mesh, steps=[{"op": "delete_nodes", "ids": [1]}])

    def test_unknown_preset(self):
        mesh = _structured_grid()
        with self.assertRaises(ValueError):
            improve_quality(mesh, preset="bogus")

    def test_each_preset_reduces_skewness(self):
        for name in PRESETS:
            with self.subTest(preset=name):
                mesh = _structured_grid(n=5, jitter=0.4, seed=7)
                before = quality.metrics(mesh)["summary"]["skewness"]["mean"]
                result = improve_quality(mesh, preset=name)
                self.assertLess(result["after"]["skewness"]["mean"], before)
                self.assertTrue(result["steps"])
                for issue in quality.check(mesh):
                    self.assertNotIn(issue["kind"], ("inverted_element", "degenerate_element"))

    def test_progress_callback_fires_once_per_step(self):
        mesh = _structured_grid(n=5, jitter=0.4, seed=7)
        calls = []
        improve_quality(mesh, preset="balanced", progress=calls.append)
        self.assertEqual(len(calls), 3)  # merge_nodes, flip_edges, smooth_nodes
        self.assertEqual([c["op"] for c in calls], ["merge_nodes", "flip_edges", "smooth_nodes"])
        self.assertEqual([c["step"] for c in calls], [1, 2, 3])
        for call in calls:
            self.assertIn("skewness", call["after"])

    def test_custom_steps_and_scope_limits_are_merged_into_smooth_nodes(self):
        mesh = _structured_grid(n=5, jitter=0.4, seed=8)
        result = improve_quality(
            mesh,
            scope={"mode": "all"},
            limits={"skewness": 0.9},
            steps=[{"op": "smooth_nodes", "method": "smart_laplacian", "iterations": 5}],
        )
        smooth_step = result["steps"][0]
        self.assertEqual(smooth_step["args"]["scope"]["mode"], "all")
        self.assertEqual(smooth_step["args"]["scope"]["limits"], {"skewness": 0.9})

    def test_step_level_scope_overrides_recipe_level_scope(self):
        mesh = _structured_grid(n=5, jitter=0.4, seed=9)
        result = improve_quality(
            mesh,
            scope={"mode": "all"},
            steps=[{"op": "smooth_nodes", "scope": {"mode": "elements", "element_ids": [1]}}],
        )
        self.assertEqual(result["steps"][0]["args"]["scope"]["mode"], "elements")

    def test_is_a_single_undo_step(self):
        from planemeshforge.core.editor import MeshEditor

        mesh = _structured_grid(n=5, jitter=0.4, seed=10)
        editor = MeshEditor(mesh)
        before_points = mesh.points.copy()

        response = editor.apply("improve_quality", {"preset": "balanced"})
        self.assertTrue(response["ok"])
        self.assertTrue((editor.mesh.points != before_points).any())

        self.assertTrue(editor.undo())
        np.testing.assert_array_equal(editor.mesh.points, before_points)
        self.assertFalse(editor.can_undo())

    def test_failing_step_rolls_back_via_editor(self):
        from planemeshforge.core.editor import MeshEditor

        mesh = _structured_grid(n=4, jitter=0.2, seed=11)
        editor = MeshEditor(mesh)
        before_points = mesh.points.copy()

        response = editor.apply(
            "improve_quality",
            {"steps": [{"op": "smooth_nodes", "method": "smart_laplacian"}, {"op": "smooth_nodes", "method": "bogus"}]},
        )
        self.assertFalse(response["ok"])
        np.testing.assert_array_equal(editor.mesh.points, before_points)


def _quad_mesh(diagonal: str) -> Mesh:
    """A convex, non-parallelogram quad split by one of its two diagonals.
    Diagonal "13" (nodes 1-3) is the Delaunay-legal choice; "24" is not."""
    points = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 2.0, 0.0], [0.0, 3.0, 0.0]])
    if diagonal == "13":
        conn = [[1, 2, 3], [1, 3, 4]]
    else:
        conn = [[1, 2, 4], [2, 3, 4]]
    tri = ElementBlock("CGAX3", [1, 2], conn)
    return Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[tri])


class TestFlipEdges(unittest.TestCase):
    def test_rejects_missing_mesh(self):
        with self.assertRaises(ValueError):
            flip_edges(None)

    def test_flips_the_bad_diagonal(self):
        mesh = _quad_mesh("24")
        before_min_angle = quality.metrics(mesh)["summary"]["min_angle"]["min"]

        result = flip_edges(mesh)

        self.assertEqual(result["flip_count"], 1)
        self.assertEqual(sorted(result["flipped_edges"][0]), [2, 4])
        after_min_angle = quality.metrics(mesh)["summary"]["min_angle"]["min"]
        self.assertGreater(after_min_angle, before_min_angle)
        # The diagonal is now 1-3: every element uses exactly nodes {1,2,3} or {1,3,4}.
        conns = {frozenset(c) for b in mesh.cells for c in b.connectivity.tolist()}
        self.assertEqual(conns, {frozenset({1, 2, 3}), frozenset({1, 3, 4})})

    def test_leaves_the_good_diagonal_alone(self):
        mesh = _quad_mesh("13")
        before_conn = [b.connectivity.copy() for b in mesh.cells]

        result = flip_edges(mesh)

        self.assertEqual(result["flip_count"], 0)
        for before, block in zip(before_conn, mesh.cells):
            np.testing.assert_array_equal(before, block.connectivity)

    def test_preserves_element_ids_and_no_inversions(self):
        mesh = _quad_mesh("24")
        before_ids = [list(b.ids) for b in mesh.cells]

        flip_edges(mesh)

        self.assertEqual([list(b.ids) for b in mesh.cells], before_ids)
        for issue in quality.check(mesh):
            self.assertNotIn(issue["kind"], ("inverted_element", "degenerate_element"))

    def test_never_flips_a_boundary_or_quad_edge(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[quad])
        result = flip_edges(mesh)
        self.assertEqual(result["flip_count"], 0)

    def test_never_flips_a_surface_set_edge(self):
        # Same bad-diagonal quad, but the diagonal itself is pinned as a
        # surface face (S2 of element 1 is nodes 2-4): it must stay put
        # even though flipping it would improve quality.
        mesh = _quad_mesh("24")
        mesh.surface_sets["pinned"] = ["1", "S2"]
        result = flip_edges(mesh)
        self.assertEqual(result["flip_count"], 0)

    def test_scope_elements_restricts_which_edges_are_considered(self):
        mesh = _quad_mesh("24")
        result = flip_edges(mesh, scope={"mode": "elements", "element_ids": [999]})
        self.assertEqual(result["flip_count"], 0)

    def test_op_registered_and_undoable_via_editor(self):
        from planemeshforge.core.editor import MeshEditor

        mesh = _quad_mesh("24")
        editor = MeshEditor(mesh)
        before_points = mesh.points.copy()

        response = editor.apply("flip_edges", {})
        self.assertTrue(response["ok"])
        self.assertEqual(response["flip_count"], 1)

        self.assertTrue(editor.undo())
        np.testing.assert_array_equal(editor.mesh.points, before_points)

    def test_balanced_and_aggressive_presets_include_flip_edges(self):
        self.assertIn({"op": "flip_edges"}, PRESETS["balanced"])
        self.assertIn({"op": "flip_edges"}, PRESETS["aggressive"])


class TestRefineSlivers(unittest.TestCase):
    def test_rejects_missing_mesh(self):
        with self.assertRaises(ValueError):
            refine_slivers(None)

    def test_splits_a_boundary_sliver_into_two(self):
        # A long, scalene sliver with no neighbor: splitting its longest
        # edge (opposite the obtuse apex) can't change the two small
        # angles at that edge's own endpoints (a split point sits on the
        # same ray, so their direction - and therefore their angle - is
        # unchanged by construction) but does measurably help the side
        # that inherits the apex's share of the angle.
        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.3, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        before_elements = quality.metrics(mesh)["elements"]

        result = refine_slivers(mesh, skew_threshold=0.5)

        self.assertEqual(result["removed_element_ids"], [1])
        self.assertEqual(len(result["created_node_ids"]), 1)
        self.assertEqual(len(result["created_element_ids"]), 2)
        self.assertEqual(sum(len(b.ids) for b in mesh.cells), 2)
        after_elements = quality.metrics(mesh)["elements"]
        self.assertLess(min(e["skewness"] for e in after_elements), before_elements[0]["skewness"])
        for issue in quality.check(mesh):
            self.assertNotIn(issue["kind"], ("inverted_element", "degenerate_element"))

    def test_splits_an_interior_sliver_pair_into_four(self):
        # Two triangles sharing edge (1, 2) as their mutual longest edge
        # (10 vs ~5.02 for the other two sides of each) - an interior split
        # replaces both with 4 children around the new midpoint node.
        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [5.0, 0.5, 0.0], [5.0, -0.5, 0.0]])
        tri = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [2, 1, 4]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[tri])

        result = refine_slivers(mesh, skew_threshold=0.5)

        self.assertEqual(sorted(result["removed_element_ids"]), [1, 2])
        self.assertEqual(len(result["created_node_ids"]), 1)
        self.assertEqual(len(result["created_element_ids"]), 4)
        self.assertEqual(sum(len(b.ids) for b in mesh.cells), 4)
        for issue in quality.check(mesh):
            self.assertNotIn(issue["kind"], ("inverted_element", "degenerate_element"))

    def test_skips_a_sliver_whose_long_edge_borders_a_quad(self):
        # Triangle (1,2,3)'s longest edge is (1,2), shared with quad
        # (2,1,5,6) - splitting it would leave a non-conforming T-junction
        # against the quad, so it must be left alone.
        points = np.array(
            [[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.3, 1.0, 0.0], [0.0, -1.0, 0.0], [10.0, -1.0, 0.0]]
        )
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        quad = ElementBlock("CGAX4", [2], [[2, 1, 4, 5]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4, 5], cells=[tri, quad])

        result = refine_slivers(mesh, skew_threshold=0.5)

        self.assertEqual(result["skipped_element_ids"], [1])
        self.assertEqual(result["removed_element_ids"], [])
        self.assertEqual(sum(len(b.ids) for b in mesh.cells), 2)

    def test_skips_a_sliver_whose_long_edge_is_a_locked_surface_face(self):
        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.3, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri], surface_sets={"pinned": ["1", "S1"]})

        result = refine_slivers(mesh, skew_threshold=0.5)

        self.assertEqual(result["skipped_element_ids"], [1])
        self.assertEqual(result["removed_element_ids"], [])

    def test_preserves_elem_sets_and_remaps_surface_sets(self):
        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.3, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri], elem_sets={"s": [1]})

        result = refine_slivers(mesh, skew_threshold=0.5)

        self.assertEqual(mesh.elem_sets["s"], [])
        self.assertEqual(sorted(mesh.point_ids), [1, 2, 3, result["created_node_ids"][0]])
        mesh._validate_data()

    def test_op_registered_and_undoable_via_editor(self):
        from planemeshforge.core.editor import MeshEditor

        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.3, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        editor = MeshEditor(mesh)
        before_points = mesh.points.copy()

        response = editor.apply("refine_slivers", {"skew_threshold": 0.5})
        self.assertTrue(response["ok"])
        self.assertEqual(len(response["created_node_ids"]), 1)

        self.assertTrue(editor.undo())
        np.testing.assert_array_equal(editor.mesh.points, before_points)

    def test_aspect_ratio_threshold_catches_slivers_skew_alone_would_miss(self):
        # Isoceles sliver: aspect ratio ~1.99 (10 / sqrt(5**2 + 0.5**2)).
        # `skew_threshold` is set above 1 so skewness (capped at 1.0) can
        # never trigger it on its own - only the aspect-ratio check can.
        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [5.0, 0.5, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])

        result = refine_slivers(mesh, skew_threshold=10.0, aspect_ratio_threshold=1.9)

        self.assertEqual(result["removed_element_ids"], [1])
        self.assertEqual(len(result["created_node_ids"]), 1)
        self.assertEqual(len(result["created_element_ids"]), 2)

    def test_aspect_ratio_threshold_none_keeps_skew_only_behavior(self):
        points = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [5.0, 0.5, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])

        result = refine_slivers(mesh, skew_threshold=10.0)

        self.assertEqual(result["removed_element_ids"], [])
        self.assertEqual(result["created_node_ids"], [])

    def test_aggressive_preset_includes_refine_slivers(self):
        self.assertTrue(any(step["op"] == "refine_slivers" for step in PRESETS["aggressive"]))
        self.assertFalse(any(step["op"] == "refine_slivers" for step in PRESETS["gentle"]))
        self.assertFalse(any(step["op"] == "refine_slivers" for step in PRESETS["balanced"]))


class TestRefineQuads(unittest.TestCase):
    # A sheared parallelogram: angles ~68.2/111.8 deg, skewness ~0.24
    # against the 90 deg ideal - skewed enough to be a candidate at
    # skew_threshold=0.2, but still a valid convex quad.
    _SKEWED_QUAD_POINTS = np.array(
        [[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [12.0, 5.0, 0.0], [2.0, 5.0, 0.0]]
    )

    def test_rejects_missing_mesh(self):
        with self.assertRaises(ValueError):
            refine_quads(None)

    def test_splits_an_isolated_skewed_quad_into_four(self):
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(points=self._SKEWED_QUAD_POINTS, point_ids=[1, 2, 3, 4], cells=[quad])
        before_elements = quality.metrics(mesh)["elements"]

        result = refine_quads(mesh, skew_threshold=0.2)

        self.assertEqual(result["removed_element_ids"], [1])
        self.assertEqual(result["skipped_element_ids"], [])
        self.assertEqual(len(result["created_node_ids"]), 5)  # 4 midpoints + 1 centroid
        self.assertEqual(len(result["created_element_ids"]), 4)
        self.assertEqual(sum(len(b.ids) for b in mesh.cells), 4)
        after_elements = quality.metrics(mesh)["elements"]
        self.assertLessEqual(max(e["skewness"] for e in after_elements), before_elements[0]["skewness"])
        for issue in quality.check(mesh):
            self.assertNotIn(issue["kind"], ("inverted_element", "degenerate_element"))

    def test_skips_a_quad_with_an_interior_edge(self):
        # quad 1's (1, 2) edge is shared with quad 2 (a plain, unskewed
        # rectangle) - splitting quad 1 would need quad 2 to split in
        # lock-step too, which this op deliberately never attempts, so
        # quad 1 must be left alone even though it's badly skewed.
        points = np.vstack([self._SKEWED_QUAD_POINTS, [[0.0, -5.0, 0.0], [10.0, -5.0, 0.0]]])
        quad1 = ElementBlock("CGAX4", [1, 2], [[1, 2, 3, 4], [2, 1, 5, 6]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4, 5, 6], cells=[quad1])

        result = refine_quads(mesh, skew_threshold=0.2)

        self.assertEqual(result["skipped_element_ids"], [1])
        self.assertEqual(result["removed_element_ids"], [])
        self.assertEqual(sum(len(b.ids) for b in mesh.cells), 2)

    def test_skips_a_quad_whose_edge_is_a_locked_surface_face(self):
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(
            points=self._SKEWED_QUAD_POINTS,
            point_ids=[1, 2, 3, 4],
            cells=[quad],
            surface_sets={"pinned": ["1", "S1"]},
        )

        result = refine_quads(mesh, skew_threshold=0.2)

        self.assertEqual(result["skipped_element_ids"], [1])
        self.assertEqual(result["removed_element_ids"], [])

    def test_preserves_elem_sets_and_remaps_surface_sets(self):
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(
            points=self._SKEWED_QUAD_POINTS, point_ids=[1, 2, 3, 4], cells=[quad], elem_sets={"s": [1]}
        )

        result = refine_quads(mesh, skew_threshold=0.2)

        self.assertEqual(mesh.elem_sets["s"], [])
        self.assertEqual(sorted(mesh.point_ids), sorted([1, 2, 3, 4] + result["created_node_ids"]))
        mesh._validate_data()

    def test_op_registered_and_undoable_via_editor(self):
        from planemeshforge.core.editor import MeshEditor

        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(points=self._SKEWED_QUAD_POINTS, point_ids=[1, 2, 3, 4], cells=[quad])
        editor = MeshEditor(mesh)
        before_points = mesh.points.copy()

        response = editor.apply("refine_quads", {"skew_threshold": 0.2})
        self.assertTrue(response["ok"])
        self.assertEqual(len(response["created_node_ids"]), 5)

        self.assertTrue(editor.undo())
        np.testing.assert_array_equal(editor.mesh.points, before_points)

    def test_aggressive_preset_includes_refine_quads(self):
        self.assertTrue(any(step["op"] == "refine_quads" for step in PRESETS["aggressive"]))
        self.assertFalse(any(step["op"] == "refine_quads" for step in PRESETS["gentle"]))
        self.assertFalse(any(step["op"] == "refine_quads" for step in PRESETS["balanced"]))


if __name__ == "__main__":
    unittest.main()
