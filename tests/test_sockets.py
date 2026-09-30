import tempfile
import unittest

from planemeshforge.app import app, editor, init_storage, socketio


class TestSockets(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        init_storage(self._tmpdir.name)
        editor.set_mesh(None, record_history=False)
        self.client = socketio.test_client(app)
        self.client.get_received()  # drain the connect ack, if any

    def tearDown(self):
        self.client.disconnect()
        self._tmpdir.cleanup()

    def _last_state(self):
        received = self.client.get_received()
        states = [msg["args"][0] for msg in received if msg["name"] == "mesh_state"]
        return states[-1] if states else None

    def test_add_node_op_round_trip(self):
        ack = self.client.emit("op", {"op": "add_nodes", "args": {"nodes": [{"id": 1, "x": 0, "y": 0}]}}, callback=True)
        self.assertTrue(ack["ok"])
        state = self._last_state()
        self.assertIsNotNone(state)
        self.assertEqual(state["summary"]["num_nodes"], 1)

    def test_invalid_op_does_not_broadcast(self):
        ack = self.client.emit("op", {"op": "add_elements", "args": {"element_type": "CGAX3", "connectivity": [[1, 2, 3]]}}, callback=True)
        self.assertFalse(ack["ok"])
        self.assertIsNone(self._last_state())

    def test_undo_redo(self):
        self.client.emit("op", {"op": "add_nodes", "args": {"nodes": [{"id": 1, "x": 0, "y": 0}]}}, callback=True)
        self.client.get_received()

        undo_ack = self.client.emit("undo", {}, callback=True)
        self.assertTrue(undo_ack["ok"])
        state = self._last_state()
        self.assertEqual(state["summary"]["num_nodes"], 0)

        redo_ack = self.client.emit("redo", {}, callback=True)
        self.assertTrue(redo_ack["ok"])
        state = self._last_state()
        self.assertEqual(state["summary"]["num_nodes"], 1)

    def test_load_mesh_replaces_state_without_history(self):
        mesh_dict = {"nodes": [{"id": 1, "x": 0, "y": 0, "z": 0}], "elements": [], "node_sets": {}, "element_sets": {}, "surface_sets": {}}
        ack = self.client.emit("load_mesh", {"mesh": mesh_dict}, callback=True)
        self.assertTrue(ack["ok"])
        self.assertFalse(editor.can_undo())
        self.client.get_received()

    def test_get_mesh_returns_state(self):
        self.client.emit("get_mesh")
        state = self._last_state()
        self.assertIsNotNone(state)
        self.assertEqual(state["summary"]["num_nodes"], 0)


if __name__ == "__main__":
    unittest.main()
