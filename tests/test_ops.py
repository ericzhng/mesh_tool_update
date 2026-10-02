import unittest

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh
from planemeshforge.core import ops


def square_mesh():
    points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
    tri = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [1, 3, 4]])
    return Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[tri])


class TestNodeOps(unittest.TestCase):
    def test_add_nodes_assigns_ids(self):
        mesh = square_mesh()
        result = ops.add_nodes(mesh, [{"x": 2.0, "y": 2.0}, {"id": 10, "x": 3.0, "y": 3.0}])
        self.assertEqual(result["created_ids"], [5, 10])
        self.assertEqual(len(mesh.point_ids), 6)

    def test_delete_nodes_cascades_to_elements(self):
        mesh = square_mesh()
        result = ops.delete_nodes(mesh, [1])
        self.assertIn(1, result["removed_element_ids"])
        self.assertIn(2, result["removed_element_ids"])
        self.assertEqual(len(mesh.cells[0].ids), 0)
        self.assertNotIn(1, mesh.point_ids)

    def test_move_nodes(self):
        mesh = square_mesh()
        ops.move_nodes(mesh, [{"id": 1, "x": 5.0, "y": 6.0}])
        idx = mesh.point_ids.index(1)
        np.testing.assert_array_almost_equal(mesh.points[idx, :2], [5.0, 6.0])


class TestElementOps(unittest.TestCase):
    def test_add_elements_rejects_unknown_node(self):
        mesh = square_mesh()
        with self.assertRaises(ValueError):
            ops.add_elements(mesh, "CGAX3", [[1, 2, 99]])

    def test_add_elements_creates_new_block_for_new_type(self):
        mesh = square_mesh()
        result = ops.add_elements(mesh, "SFMGAX1", [[1, 2]])
        self.assertEqual(len(result["created_ids"]), 1)
        types = {b.element_type for b in mesh.cells}
        self.assertEqual(types, {"CGAX3", "SFMGAX1"})

    def test_delete_elements(self):
        mesh = square_mesh()
        ops.delete_elements(mesh, [1])
        self.assertEqual(list(mesh.cells[0].ids), [2])

    def test_split_quads(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[quad])
        result = ops.split_quads(mesh, [1])
        self.assertEqual(len(result["created_ids"]), 2)
        self.assertEqual(len(mesh.cells), 1)
        self.assertEqual(mesh.cells[0].element_type, "CGAX3")

    def test_split_quads_drops_split_elements_from_elem_sets(self):
        # Regression test: a quad that belongs to an ELSET (e.g. imported
        # from an Abaqus deck's `*ELSET`) must be removed from that set when
        # split, otherwise `Mesh._validate_data` rejects the now-dangling id.
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[quad], elem_sets={"quads": [1]})
        result = ops.split_quads(mesh, [1])
        self.assertEqual(len(result["created_ids"]), 2)
        self.assertEqual(mesh.elem_sets["quads"], [])
        mesh._validate_data()  # must not raise

    def test_fix_orientation_reverses_clockwise_elements(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 3, 2]])  # clockwise
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        result = ops.fix_orientation(mesh)
        self.assertEqual(result["reversed_ids"], [1])
        np.testing.assert_array_equal(mesh.cells[0].connectivity[0], [1, 2, 3])

    def test_fix_orientation_no_op_on_clean_mesh(self):
        mesh = square_mesh()
        result = ops.fix_orientation(mesh)
        self.assertEqual(result["reversed_ids"], [])


class TestTransform(unittest.TestCase):
    def test_rotate_about_centroid(self):
        mesh = square_mesh()
        ops.transform(mesh, [1, 2, 3, 4], "rotate", {"angle_deg": 90})
        # centroid stays put, square rotates onto itself (within tolerance)
        centroid = mesh.points[:, :2].mean(axis=0)
        np.testing.assert_array_almost_equal(centroid, [0.5, 0.5])

    def test_translate(self):
        mesh = square_mesh()
        ops.transform(mesh, [1, 2, 3, 4], "translate", {"dx": 1.0, "dy": 0.0})
        np.testing.assert_array_almost_equal(mesh.points[0, :2], [1.0, 0.0])

    def test_unknown_kind_raises(self):
        mesh = square_mesh()
        with self.assertRaises(ValueError):
            ops.transform(mesh, [1], "shear", {})


class TestSets(unittest.TestCase):
    def test_create_and_modify_node_set(self):
        mesh = square_mesh()
        ops.create_set(mesh, "node", "left", [1, 4])
        self.assertEqual(mesh.node_sets["left"], [1, 4])
        ops.set_add_members(mesh, "node", "left", [2])
        self.assertEqual(mesh.node_sets["left"], [1, 2, 4])
        ops.set_remove_members(mesh, "node", "left", [1])
        self.assertEqual(mesh.node_sets["left"], [2, 4])
        ops.rename_set(mesh, "node", "left", "renamed")
        self.assertNotIn("left", mesh.node_sets)
        self.assertIn("renamed", mesh.node_sets)
        ops.delete_set(mesh, "node", "renamed")
        self.assertNotIn("renamed", mesh.node_sets)

    def test_rename_to_existing_raises(self):
        mesh = square_mesh()
        ops.create_set(mesh, "node", "a", [1])
        ops.create_set(mesh, "node", "b", [2])
        with self.assertRaises(ValueError):
            ops.rename_set(mesh, "node", "a", "b")


class TestSurfaceSets(unittest.TestCase):
    def test_create_surface_stores_direct_element_face_tokens(self):
        mesh = square_mesh()
        ops.create_surface(mesh, "surf1", [[1, 0], [2, 1]])
        self.assertEqual(mesh.surface_sets["surf1"], ["1", "S1", "2", "S2"])
        self.assertEqual(mesh.elem_sets, {})

    def test_create_surface_rejects_unknown_element(self):
        mesh = square_mesh()
        with self.assertRaises(ValueError):
            ops.create_surface(mesh, "surf1", [[99, 0]])

    def test_create_surface_rejects_out_of_range_face(self):
        mesh = square_mesh()
        with self.assertRaises(ValueError):
            ops.create_surface(mesh, "surf1", [[1, 3]])

    def test_recreate_surface_overwrites_previous_faces(self):
        mesh = square_mesh()
        ops.create_surface(mesh, "surf1", [[1, 0], [2, 1]])
        ops.create_surface(mesh, "surf1", [[1, 0]])
        self.assertEqual(mesh.surface_sets["surf1"], ["1", "S1"])

    def test_delete_surface(self):
        mesh = square_mesh()
        ops.create_surface(mesh, "surf1", [[1, 0], [2, 1]])
        ops.delete_set(mesh, "surface", "surf1")
        self.assertNotIn("surf1", mesh.surface_sets)

    def test_rename_surface(self):
        mesh = square_mesh()
        ops.create_surface(mesh, "surf1", [[1, 0], [2, 1]])
        ops.rename_set(mesh, "surface", "surf1", "renamed")
        self.assertNotIn("surf1", mesh.surface_sets)
        self.assertEqual(mesh.surface_sets["renamed"], ["1", "S1", "2", "S2"])

    def test_create_set_rejects_surface_kind(self):
        mesh = square_mesh()
        with self.assertRaises(ValueError):
            ops.create_set(mesh, "surface", "surf1", [1])


class TestMergeAndRenumber(unittest.TestCase):
    def test_merge_coincident_nodes(self):
        points = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[ElementBlock.empty()])
        result = ops.merge_nodes(mesh, tolerance=1e-9)
        self.assertEqual(result["merged"], {2: 1})
        self.assertEqual(mesh.point_ids, [1, 3])

    def test_renumber(self):
        mesh = square_mesh()
        result = ops.renumber(mesh, start=100)
        self.assertEqual(mesh.point_ids, [100, 101, 102, 103])
        self.assertEqual(list(mesh.cells[0].ids), [100, 101])
        self.assertEqual(result["node_id_map"][1], 100)


if __name__ == "__main__":
    unittest.main()
