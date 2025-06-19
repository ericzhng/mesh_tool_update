from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

app = Flask(__name__)
socketio = SocketIO(app)

# Mesh data structure
mesh = {
    "nodes": [],  # [{'id': int, 'x': float, 'y': float}]
    "connections": [],  # [{'source': int, 'target': int}]
}


def get_mesh_summary():
    return {
        "num_nodes": len(mesh["nodes"]),
        "num_connections": len(mesh["connections"]),
    }


@app.route("/")
def index():
    return render_template("index.html")


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
