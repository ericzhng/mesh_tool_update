import unittest

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh
from planemeshforge.core import MeshEditor


def square_mesh():
    points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
    tri = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [1, 3, 4]])
    return Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[tri])


class TestMeshEditor(unittest.TestCase):
    def test_apply_success_enables_undo(self):
        editor = MeshEditor(square_mesh())
        self.assertFalse(editor.can_undo())
        result = editor.apply("add_nodes", {"nodes": [{"x": 5, "y": 5}]})
        self.assertTrue(result["ok"])
        self.assertTrue(editor.can_undo())
        self.assertEqual(len(editor.mesh.point_ids), 5)

    def test_apply_failure_leaves_mesh_untouched(self):
        editor = MeshEditor(square_mesh())
        before_ids = list(editor.mesh.point_ids)
        result = editor.apply("add_elements", {"element_type": "CGAX3", "connectivity": [[1, 2, 999]]})
        self.assertFalse(result["ok"])
        self.assertIn("999", result["error"])
        self.assertEqual(editor.mesh.point_ids, before_ids)
        self.assertFalse(editor.can_undo())

    def test_undo_redo_round_trip(self):
        editor = MeshEditor(square_mesh())
        editor.apply("add_nodes", {"nodes": [{"id": 9, "x": 5, "y": 5}]})
        self.assertEqual(len(editor.mesh.point_ids), 5)

        self.assertTrue(editor.undo())
        self.assertEqual(len(editor.mesh.point_ids), 4)
        self.assertTrue(editor.can_redo())

        self.assertTrue(editor.redo())
        self.assertEqual(len(editor.mesh.point_ids), 5)
        self.assertIn(9, editor.mesh.point_ids)

    def test_undo_with_empty_stack_returns_false(self):
        editor = MeshEditor(square_mesh())
        self.assertFalse(editor.undo())

    def test_new_edit_clears_redo_stack(self):
        editor = MeshEditor(square_mesh())
        editor.apply("add_nodes", {"nodes": [{"id": 9, "x": 5, "y": 5}]})
        editor.undo()
        self.assertTrue(editor.can_redo())
        editor.apply("add_nodes", {"nodes": [{"id": 10, "x": 6, "y": 6}]})
        self.assertFalse(editor.can_redo())

    def test_clear_mesh(self):
        editor = MeshEditor(square_mesh())
        result = editor.apply("clear_mesh", {})
        self.assertTrue(result["ok"])
        self.assertIsNone(editor.mesh)
        self.assertTrue(editor.undo())
        self.assertIsNotNone(editor.mesh)

    def test_unknown_op(self):
        editor = MeshEditor(square_mesh())
        result = editor.apply("not_a_real_op", {})
        self.assertFalse(result["ok"])

    def test_state_payload(self):
        editor = MeshEditor(square_mesh())
        state = editor.state()
        self.assertEqual(state["summary"]["num_nodes"], 4)
        self.assertFalse(state["can_undo"])
        self.assertFalse(state["can_redo"])


if __name__ == "__main__":
    unittest.main()
