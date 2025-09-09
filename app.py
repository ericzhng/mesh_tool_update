from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename
import os
import meshio.abaqusIO as abaqusIO


app = Flask(__name__)
socketio = SocketIO(app)

# Mesh data structure
mesh = {
    "nodes": [],  # [{'id': int, 'x': float, 'y': float}]
    "connections": [],  # [{'source': int, 'target': int}]
    "elements": [], # [{'id': int, 'node_ids': list}]
}

UPLOAD_FOLDER = "data"
ALLOWED_EXTENSIONS = {"csv", "json", "inp", "deck"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

last_uploaded_file = {"path": ""}


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
    if "file" not in request.files:
        return "No file part", 400
    file = request.files["file"]
    if file.filename == "":
        return "No selected file", 400
    if file and file.filename and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)
        try:
            mesh_data = abaqusIO.read_mesh(filepath)
            mesh["nodes"] = mesh_data["nodes"]
            mesh["connections"] = mesh_data["connections"]
            mesh["elements"] = mesh_data.get("elements", [])
            last_uploaded_file["path"] = filepath  # remember last file
        except Exception as e:
            return f"Failed to parse mesh: {e}", 400
        return "Mesh loaded", 200
    return "Invalid file", 400


@app.route("/last_mesh")
def last_mesh():
    """Returns the last loaded mesh."""
    # If mesh is empty but last file exists, reload it
    if (
        not mesh["nodes"]
        and last_uploaded_file["path"]
        and os.path.exists(last_uploaded_file["path"])
    ):
        try:
            mesh_data = abaqusIO.read_mesh(last_uploaded_file["path"])
            mesh["nodes"] = mesh_data["nodes"]
            mesh["connections"] = mesh_data["connections"]
            mesh["elements"] = mesh_data.get("elements", [])
        except Exception:
            pass
    return jsonify(mesh)


@socketio.on("get_mesh")
def handle_get_mesh(data):
    """Handles a request to get the current mesh."""
    emit("mesh_data", {"mesh": mesh, "isDragging": False}) # Changed 'data' to 'mesh'


@socketio.on("add_node")
def handle_add_node(data):
    """Handles a request to add a node to the mesh."""
    mesh["nodes"].append(data)
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_node")
def handle_delete_node(data):
    """Handles a request to delete a node from the mesh."""
    node_id = data["id"]
    mesh["nodes"] = [n for n in mesh["nodes"] if n["id"] != node_id]
    mesh["connections"] = [
        c
        for c in mesh["connections"]
        if not (
            (c["source"] == node_id and c["target"] == node_id)
            or (c["source"] == node_id and c["target"] == node_id)
        )
    ]
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("update_node")
def handle_update_node(data):
    """Handles a request to update a node in the mesh."""
    for n in mesh["nodes"]:
        if n["id"] == data["id"]:
            n["x"] = data["x"]
            n["y"] = data["y"]
    is_dragging = data.get("isDragging", False)
    emit("mesh_data", {"mesh": mesh, "isDragging": is_dragging}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("add_connection")
def handle_add_connection(data):
    """Handles a request to add a connection to the mesh."""
    mesh["connections"].append(data)
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_connection")
def handle_delete_connection(data):
    """Handles a request to delete a connection from the mesh."""
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
    mesh["nodes"] = []
    mesh["connections"] = []
    mesh["elements"] = []
    emit("mesh_data", {"mesh": mesh, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@app.route("/export")
def export_connectivity():
    """Exports the connectivity matrix of the mesh."""
    return jsonify(mesh["connections"])


if __name__ == "__main__":
    socketio.run(app, debug=True, port=5050)
