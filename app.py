from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename
import os
import csv
import json


app = Flask(__name__)
socketio = SocketIO(app)

# Mesh data structure
mesh = {
    "nodes": [],  # [{'id': int, 'x': float, 'y': float}]
    "connections": [],  # [{'source': int, 'target': int}]
}

UPLOAD_FOLDER = "uploads"
ALLOWED_EXTENSIONS = {"csv", "json"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_mesh_summary():
    return {
        "num_nodes": len(mesh["nodes"]),
        "num_connections": len(mesh["connections"]),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/load", methods=["POST"])
def load_mesh():
    if "file" not in request.files:
        return "No file part", 400
    file = request.files["file"]
    if file.filename == "":
        return "No selected file", 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)
        # Parse file
        if filename.endswith(".csv"):
            with open(filepath, newline="") as csvfile:
                reader = csv.reader(csvfile)
                nodes = []
                connections = []
                section = "nodes"
                for row in reader:
                    if not row or row[0].startswith("#"):
                        continue
                    if row[0].lower() == "connections":
                        section = "connections"
                        continue
                    if section == "nodes":
                        nodes.append(
                            {"id": int(row[0]), "x": float(row[1]), "y": float(row[2])}
                        )
                    elif section == "connections":
                        connections.append(
                            {"source": int(row[0]), "target": int(row[1])}
                        )
                mesh["nodes"] = nodes
                mesh["connections"] = connections
        elif filename.endswith(".json"):
            with open(filepath) as f:
                data = json.load(f)
                mesh["nodes"] = data.get("nodes", [])
                mesh["connections"] = data.get("connections", [])
                # Optionally, you can use mesh['metadata'] = data.get('metadata', {}) if you want to display metadata
        socketio.emit("mesh_data", mesh, broadcast=True)
        socketio.emit("mesh_summary", get_mesh_summary(), broadcast=True)
        return "Mesh loaded", 200
    return "Invalid file", 400


@socketio.on("get_mesh")
def handle_get_mesh():
    emit("mesh_data", mesh)


@socketio.on("add_node")
def handle_add_node(data):
    mesh["nodes"].append(data)
    emit("mesh_data", mesh, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_node")
def handle_delete_node(data):
    node_id = data["id"]
    mesh["nodes"] = [n for n in mesh["nodes"] if n["id"] != node_id]
    mesh["connections"] = [
        c
        for c in mesh["connections"]
        if c["source"] != node_id and c["target"] != node_id
    ]
    emit("mesh_data", mesh, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("update_node")
def handle_update_node(data):
    for n in mesh["nodes"]:
        if n["id"] == data["id"]:
            n["x"] = data["x"]
            n["y"] = data["y"]
    emit("mesh_data", mesh, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("add_connection")
def handle_add_connection(data):
    mesh["connections"].append(data)
    emit("mesh_data", mesh, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@socketio.on("delete_connection")
def handle_delete_connection(data):
    mesh["connections"] = [
        c
        for c in mesh["connections"]
        if not (c["source"] == data["source"] and c["target"] == data["target"])
    ]
    emit("mesh_data", mesh, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)


@app.route("/export")
def export_connectivity():
    return jsonify(mesh["connections"])


if __name__ == "__main__":
    socketio.run(app, debug=True, port=5050)
