"""Flask + Flask-SocketIO application wiring.

The actual mesh-editing logic lives in `core/` (pure Python, unit-testable);
`server/` adapts it to HTTP routes and Socket.IO events. This module just
creates the app, the shared `MeshEditor`/`SessionStorage`, and registers
routes and socket handlers once at import time.
"""

from flask import Flask
from flask_socketio import SocketIO

from .core import MeshEditor
from .server import SessionStorage, register_routes, register_sockets

app = Flask(__name__)
socketio = SocketIO(app)

editor = MeshEditor()
storage = SessionStorage()

register_routes(app, editor, storage)
register_sockets(socketio, editor, storage)


def init_storage(data_dir: str) -> None:
    """Points the app at its storage directory and reloads the last mesh, if any."""
    storage.configure(data_dir)
    editor.set_mesh(storage.load_last_mesh(), record_history=False)
