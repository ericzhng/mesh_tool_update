import os
import tempfile
import shutil

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename
from meshtool import abaqusIO


app = Flask(__name__)
socketio = SocketIO(app)


ALLOWED_EXTENSIONS = {"inp", "deck"}


def allowed_file(filename):
    """Checks if a file has an allowed extension."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_mesh_summary():
    """Returns a summary of the current mesh."""
    return {
        "num_nodes": len(mesh["nodes"]),
        "num_lines": len(mesh["connections"]),
        "num_elements": len(mesh["elements"]),
    }


@app.route("/")
def index():
    """Renders the main page."""
    return render_template("index.html")


@app.route("/load", methods=["POST"])
def load_mesh():
    """Loads a mesh from a file."""
    print("[DEBUG] /load endpoint called")
    if "file" not in request.files:
        return "No file part", 400
    file = request.files["file"]
    if file.filename == "":
        return "No selected file", 400
    if file and file.filename and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        temp_dir = tempfile.mkdtemp()
        filepath = os.path.join(temp_dir, filename)
        file.save(filepath)
        try:
            mesh_data = abaqusIO.read_mesh(filepath)
            mesh["nodes"] = mesh_data["nodes"]
            mesh["connections"] = mesh_data["connections"]
            mesh["elements"] = mesh_data.get("elements", [])
            print(f"[DEBUG] Mesh loaded from uploaded file: {filepath}")
        except Exception as e:
            print(f"[ERROR] Failed to parse mesh from {filepath}: {e}")
            return f"Failed to parse mesh: {e}", 400
        finally:
            shutil.rmtree(temp_dir) # Clean up the temporary directory
        return "Mesh loaded", 200
    return "Invalid file", 400


@app.route("/last_mesh")
def last_mesh():
    """Returns the last loaded."""
    print("[DEBUG] /last_mesh endpoint called. Returning current mesh state.")
    return jsonify(mesh)


@socketio.on("get_mesh")
def handle_get_mesh(data=None):
    """Handles a request to get the current mesh."""
    print("[DEBUG] get_mesh SocketIO event received.")
    emit("mesh_data", {"mesh": mesh, "isDragging": False})


@socketio.on("add_node")
def handle_add_node(data):
    """Handles a request to add a node to the mesh."""
    print(f"[DEBUG] add_node SocketIO event received. Node ID: {data.get('id')}")
    mesh["nodes"].append(data)
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_node")
def handle_delete_node(data):
    """Handles a request to delete a node from the mesh."""
    node_id = data["id"]
    print(f"[DEBUG] delete_node SocketIO event received. Node ID: {node_id}")
    mesh["nodes"] = [n for n in mesh["nodes"] if n["id"] != node_id]
    mesh["connections"] = [
        c
        for c in mesh["connections"]
        if c["source"] != node_id and c["target"] != node_id
    ]
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("update_node")
def handle_update_node(data):
    """Handles a request to update a node in the mesh."""
    print(f"[DEBUG] update_node SocketIO event received. Node ID: {data.get('id')}")
    for n in mesh["nodes"]:
        if n["id"] == data["id"]:
            n["x"] = data["x"]
            n["y"] = data["y"]
    is_dragging = data.get("isDragging", False)
    dragging_node_id = data.get("draggingNodeId")

    emit(
        "mesh_data",
        {"mesh": mesh, "isDragging": is_dragging, "draggingNodeId": dragging_node_id},
        broadcast=True,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("update_nodes_bulk")
def handle_update_nodes_bulk(data):
    """Handles a request to update multiple nodes in the mesh."""
    node_ids = [n.get("id") for n in data.get("nodes", [])]
    print(f"[DEBUG] update_nodes_bulk SocketIO event received. Node IDs: {node_ids}")
    updated_nodes_data = data.get("nodes", [])
    is_dragging = data.get("isDragging", False)
    dragging_node_id = data.get("draggingNodeId")

    # Create a dictionary for quick lookup of nodes by ID
    nodes_to_update_map = {
        node_data["id"]: node_data for node_data in updated_nodes_data
    }

    for n in mesh["nodes"]:
        if n["id"] in nodes_to_update_map:
            updated_data = nodes_to_update_map[n["id"]]
            n["x"] = updated_data["x"]
            n["y"] = updated_data["y"]

    emit(
        "mesh_data",
        {"mesh": mesh, "isDragging": is_dragging, "draggingNodeId": dragging_node_id},
        broadcast=True,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_nodes_bulk")
def handle_delete_nodes_bulk(data):
    """Handles a request to delete multiple nodes from the mesh."""
    node_ids_to_delete = set(data.get("ids", []))
    print(
        f"[DEBUG] delete_nodes_bulk SocketIO event received. Node IDs to delete: {list(node_ids_to_delete)}"
    )

    # Filter out deleted nodes
    mesh["nodes"] = [n for n in mesh["nodes"] if n["id"] not in node_ids_to_delete]

    # Filter out connections involving deleted nodes
    mesh["connections"] = [
        c
        for c in mesh["connections"]
        if c["source"] not in node_ids_to_delete
        and c["target"] not in node_ids_to_delete
    ]

    # Filter out elements involving deleted nodes
    mesh["elements"] = [
        e
        for e in mesh["elements"]
        if not any(node_id in node_ids_to_delete for node_id in e["node_ids"])
    ]

    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("add_connection")
def handle_add_connection(data):
    """Handles a request to add a connection to the mesh."""
    print(
        f"[DEBUG] add_connection SocketIO event received. Source: {data.get('source')}, Target: {data.get('target')}"
    )
    mesh["connections"].append(data)

    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_connection")
def handle_delete_connection(data):
    """Handles a request to delete a connection from the mesh."""
    print(
        f"[DEBUG] delete_connection SocketIO event received. Source: {data.get('source')}, Target: {data.get('target')}"
    )
    # Remove both directions for undirected mesh
    mesh["connections"] = [
        c
        for c in mesh["connections"]
        if not (
            (c["source"] == data["source"] and c["target"] == data["target"])
            or (c["source"] == data["target"] and c["target"] == data["source"])
        )
    ]
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("clear_mesh")
def handle_clear_mesh():
    """Handles a request to clear the mesh."""
    print("[DEBUG] clear_mesh SocketIO event received.")
    mesh["nodes"] = []
    mesh["connections"] = []
    mesh["elements"] = []
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("sync_mesh")
def handle_sync_mesh(data):
    """Handles a request to sync the mesh from a client."""
    print("[DEBUG] sync_mesh SocketIO event received.")
    global mesh
    mesh = data.get("mesh", {"nodes": [], "connections": [], "elements": []})
    # Broadcast the synced mesh to all clients except the sender
    emit(
        "mesh_data",
        {"mesh": mesh, "isDragging": False},
        broadcast=True,
        include_self=False,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("save_mesh")
def handle_save_mesh():
    """Handles a request to save the mesh to the server."""
    print("[DEBUG] save_mesh SocketIO event received.")


@app.route("/export")
def export_connectivity():
    """Exports the connectivity matrix of the mesh."""
    print("[DEBUG] /export endpoint called.")
    return jsonify(mesh["connections"])


if __name__ == "__main__":
    socketio.run(app, debug=True, port=5050)
