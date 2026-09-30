"""Socket.IO protocol.

A single `op` event carries every mesh mutation (`{op, args}`); the server
applies it through `MeshEditor`, acks the result to the sender, and
broadcasts the resulting `mesh_state` to all connected clients so multiple
tabs/windows stay in sync. `undo`/`redo`/`get_mesh`/`load_mesh` are the only
other events.
"""

from __future__ import annotations

from flask_socketio import SocketIO, emit

from ..core import MeshEditor, dict_to_mesh
from .session import SessionStorage


def register_sockets(socketio: SocketIO, editor: MeshEditor, storage: SessionStorage) -> None:
    def broadcast_state():
        emit("mesh_state", editor.state(), broadcast=True)
        storage.save_mesh(editor.mesh)

    @socketio.on("get_mesh")
    def handle_get_mesh(_data=None):
        emit("mesh_state", editor.state())

    @socketio.on("op")
    def handle_op(data, ack=None):
        op_name = data.get("op")
        args = data.get("args", {})
        result = editor.apply(op_name, args)
        if result.get("ok"):
            broadcast_state()
        return result

    @socketio.on("undo")
    def handle_undo(_data=None):
        ok = editor.undo()
        if ok:
            broadcast_state()
        return {"ok": ok}

    @socketio.on("redo")
    def handle_redo(_data=None):
        ok = editor.redo()
        if ok:
            broadcast_state()
        return {"ok": ok}

    @socketio.on("quality_check")
    def handle_quality_check(_data=None):
        """Read-only: returns mesh quality issues without mutating anything."""
        return {"ok": True, "issues": editor.quality_check()}

    @socketio.on("load_mesh")
    def handle_load_mesh(data):
        """Replaces the whole mesh (project open) without touching undo history."""
        try:
            mesh = dict_to_mesh(data.get("mesh"))
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        editor.set_mesh(mesh, record_history=False)
        broadcast_state()
        return {"ok": True}
