import os
import tempfile
import shutil
import json
import io
import numpy as np

from flask import Flask, render_template, request, jsonify, Response
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

from abaqus_io import read_deck, write_buffer, Mesh, ElementBlock

app = Flask(__name__)
socketio = SocketIO(app)

# Global variable to hold the mesh object
mesh: Mesh | None = None
# Global variable to hold connections for frontend visualization
connections: list = []


# Path for storing information about the last used mesh file
MESH_INFO_PATH = os.path.join(os.getcwd(), "temp", "mesh_info.json")
TEMP_MESH_DIR = os.path.join(os.getcwd(), "temp", "mesh_files")

# Ensure the temporary directories exist
os.makedirs(os.path.dirname(MESH_INFO_PATH), exist_ok=True)
os.makedirs(TEMP_MESH_DIR, exist_ok=True)

def save_mesh_to_disk():
    """Saves the current mesh to disk."""
    if not mesh:
        return

    try:
        with open(MESH_INFO_PATH, "r") as f:
            mesh_info = json.load(f)
            mesh_filepath = mesh_info.get("filepath")
            if mesh_filepath:
                with open(mesh_filepath, "w") as f:
                    write_buffer(f, mesh)
                print(f"[DEBUG] Mesh saved to {mesh_filepath}")
    except (json.JSONDecodeError, IOError) as e:
        print(f"[ERROR] Failed to save mesh to disk: {e}")

def mesh_to_dict(mesh_obj: Mesh | None):
    """Converts a Mesh object to a JSON-serializable dictionary."""
    if not mesh_obj:
        return {}

    nodes = [
        {"id": int(pid), "x": p[0], "y": p[1], "z": p[2]}
        for pid, p in zip(mesh_obj.point_ids, mesh_obj.points)
    ]

    elements = []
    for cell_block in mesh_obj.cells:
        for i, element_id in enumerate(cell_block.ids):
            elements.append(
                {
                    "id": int(element_id),
                    "type": cell_block.element_type,
                    "node_ids": cell_block.connectivity[i].tolist(),
                }
            )

    return {
        "nodes": nodes,
        "elements": elements,
        "node_sets": mesh_obj.node_sets,
        "element_sets": mesh_obj.elem_sets,
        "surface_sets": mesh_obj.surface_sets,
    }


def dict_to_mesh(mesh_dict: dict):
    """Converts a dictionary to a Mesh object."""
    print(f"[DEBUG] dict_to_mesh received: {mesh_dict.keys()}")
    if not mesh_dict:
        print("[DEBUG] dict_to_mesh: Empty dictionary received.")
        return None

    nodes = mesh_dict.get("nodes", [])
    points = np.array([[n["x"], n["y"], n["z"]] for n in nodes])
    point_ids = [n["id"] for n in nodes]

    # Group elements by type to create ElementBlocks
    elements_by_type = {}
    for element in mesh_dict.get("elements", []):
        el_type = element["type"]
        if el_type not in elements_by_type:
            elements_by_type[el_type] = {"ids": [], "connectivity": []}
        elements_by_type[el_type]["ids"].append(element["id"])
        elements_by_type[el_type]["connectivity"].append(element["node_ids"])

    cells = []
    for el_type, data in elements_by_type.items():
        cells.append(
            ElementBlock(
                element_type=el_type,
                ids=np.array(data["ids"]),
                connectivity=np.array(data["connectivity"]),
            )
        )

    new_mesh = Mesh(
        points=points,
        point_ids=point_ids,
        cells=cells,
        node_sets=mesh_dict.get("node_sets", {}),
        elem_sets=mesh_dict.get("element_sets", {}),
        surface_sets=mesh_dict.get("surface_sets", {}),
    )
    print(f"[DEBUG] dict_to_mesh returning mesh with {len(new_mesh.points)} nodes and {len(new_mesh.cells)} cell blocks.")
    return new_mesh


# Load the last used mesh on startup
if os.path.exists(MESH_INFO_PATH):
    try:
        with open(MESH_INFO_PATH, "r") as f:
            mesh_info = json.load(f)
            mesh_filepath = mesh_info.get("filepath")
            if mesh_filepath and os.path.exists(mesh_filepath):
                print(f"[DEBUG] Loading initial mesh from {mesh_filepath}")
                mesh = read_deck(mesh_filepath)
                print(f"[DEBUG] Mesh loaded successfully on startup: {mesh is not None}")
    except (json.JSONDecodeError, IOError) as e:
        print(f"[ERROR] Failed to load initial mesh info: {e}")


def allowed_file(filename):
    """Checks if a file has an allowed extension."""
    ALLOWED_EXTENSIONS = {"inp", "deck"}
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_mesh_summary():
    """Returns a summary of the current mesh."""
    print("[DEBUG] get_mesh_summary called.")
    if not mesh:
        return {
            "num_nodes": 0,
            "num_elements": 0,
            "num_node_sets": 0,
            "num_element_sets": 0,
            "num_surface_sets": 0,
        }

    total_elements = sum(len(block.ids) for block in mesh.cells)

    return {
        "num_nodes": len(mesh.points),
        "num_elements": total_elements,
        "num_node_sets": len(mesh.node_sets),
        "num_element_sets": len(mesh.elem_sets),
        "num_surface_sets": len(mesh.surface_sets),
    }


@app.route("/")
def index():
    """Renders the main page."""
    return render_template("index.html")


@app.route("/load", methods=["POST"])
def load_mesh():
    """Loads a mesh from a file."""
    global mesh
    print("[DEBUG] /load endpoint called")
    if "file" not in request.files:
        return "No file part", 400
    file = request.files["file"]
    if file.filename == "":
        return "No selected file", 400
    if file and file.filename and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(TEMP_MESH_DIR, filename)
        file.save(filepath)
        try:
            mesh = read_deck(filepath)
            # Save the path for persistence
            with open(MESH_INFO_PATH, "w") as f:
                json.dump({"filepath": filepath}, f)
            print(f"[DEBUG] Mesh loaded from uploaded file: {filepath}")
        except Exception as e:
            print(f"[ERROR] Failed to parse mesh from {filepath}: {e}")
            return f"Failed to parse mesh: {e}", 400
        return "Mesh loaded", 200
    return "Invalid file", 400


@app.route("/export")
def export_mesh():
    """Exports the current mesh and returns it as a file download."""
    print("[DEBUG] /export endpoint called.")
    if not mesh:
        return "No mesh to export", 400

    try:
        # Use an in-memory text buffer to write the deck content
        deck_buffer = io.StringIO()
        write_buffer(deck_buffer, mesh)
        deck_content = deck_buffer.getvalue()
        deck_buffer.close()

        print(f"[DEBUG] Mesh exported to in-memory buffer")

        # Return the content as a downloadable file
        return Response(
            deck_content,
            mimetype="text/plain",
            headers={"Content-Disposition": "attachment;filename=mesh.deck"},
        )

    except Exception as e:
        print(f"[ERROR] Failed to export mesh: {e}")
        return f"Failed to export mesh: {e}", 500


@app.route("/last_mesh")
def last_mesh():
    """Returns the last loaded mesh."""
    print("[DEBUG] /last_mesh endpoint called. Returning current mesh state.")
    mesh_dict_for_client = mesh_to_dict(mesh)
    mesh_dict_for_client["connections"] = connections
    print(f"[DEBUG] /last_mesh sending mesh_dict: nodes={len(mesh_dict_for_client.get('nodes', []))}, elements={len(mesh_dict_for_client.get('elements', []))}")
    return jsonify(mesh_dict_for_client)


@socketio.on("get_mesh")
def handle_get_mesh(data=None):
    """Handles a request to get the current mesh."""
    print("[DEBUG] get_mesh SocketIO event received.")
    emit("mesh_data", {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False})


@socketio.on("add_node")
def handle_add_node(data):
    """Handles a request to add a node to the mesh."""
    global mesh
    if not mesh:
        return

    print(f"[DEBUG] add_node SocketIO event received. Node ID: {data.get('id')}")
    new_point_id = data.get("id")
    new_point_coords = [data.get("x", 0), data.get("y", 0), 0]  # Assuming 2D for now

    mesh.points = np.vstack([mesh.points, new_point_coords])
    mesh.point_ids.append(new_point_id)

    emit("mesh_data", {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("delete_node")
def handle_delete_node(data):
    """Handles a request to delete a node from the mesh."""
    global mesh
    if not mesh:
        return

    node_id_to_delete = data["id"]
    print(f"[DEBUG] delete_node SocketIO event received. Node ID: {node_id_to_delete}")

    try:
        node_index = mesh.point_ids.index(node_id_to_delete)
        mesh.points = np.delete(mesh.points, node_index, axis=0)
        mesh.point_ids.pop(node_index)

        # Also remove node from any node sets
        for name, ids in mesh.node_sets.items():
            mesh.node_sets[name] = [i for i in ids if i != node_id_to_delete]

    except ValueError:
        print(f"[WARNING] Node with ID {node_id_to_delete} not found for deletion.")

    emit("mesh_data", {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("update_node")
def handle_update_node(data):
    """Handles a request to update a node in the mesh."""
    if not mesh:
        return

    node_id = data["id"]

    try:
        node_index = mesh.point_ids.index(node_id)
        mesh.points[node_index] = [data["x"], data["y"], 0]  # Assuming 2D
    except ValueError:
        print(f"[WARNING] Node with ID {node_id} not found for update.")

    is_dragging = data.get("isDragging", False)
    dragging_node_id = data.get("draggingNodeId")

    emit(
        "mesh_data",
        {
            "mesh": mesh_to_dict(mesh),
            "connections": connections,
            "isDragging": is_dragging,
            "draggingNodeId": dragging_node_id,
        },
        broadcast=True,
    )
    if not is_dragging:
        emit("mesh_summary", get_mesh_summary(), broadcast=True)
        save_mesh_to_disk()


@socketio.on("update_nodes_bulk")
def handle_update_nodes_bulk(data):
    """Handles a request to update multiple nodes in the mesh."""
    global mesh
    if not mesh:
        return

    nodes_data = data.get("nodes", [])

    for updated_node in nodes_data:
        node_id = updated_node["id"]
        try:
            node_index = mesh.point_ids.index(node_id)
            mesh.points[node_index] = [updated_node["x"], updated_node["y"], 0]  # Assuming 2D
        except ValueError:
            print(f"[WARNING] Node with ID {node_id} not found for bulk update.")

    is_dragging = data.get("isDragging", False)
    dragging_node_id = data.get("draggingNodeId")

    emit(
        "mesh_data",
        {
            "mesh": mesh_to_dict(mesh),
            "connections": connections,
            "isDragging": is_dragging,
            "draggingNodeId": dragging_node_id,
        },
        broadcast=True,
    )
    if not is_dragging:
        emit("mesh_summary", get_mesh_summary(), broadcast=True)
        save_mesh_to_disk()


@socketio.on("delete_nodes_bulk")
def handle_delete_nodes_bulk(data):
    """Handles a request to delete multiple nodes from the mesh."""
    global mesh, connections
    if not mesh:
        return

    node_ids_to_delete = set(data.get("ids", []))
    print(
        f"[DEBUG] delete_nodes_bulk SocketIO event received. Node IDs to delete: {list(node_ids_to_delete)}"
    )

    # Find indices of nodes to delete
    indices_to_delete = [
        i for i, pid in enumerate(mesh.point_ids) if pid in node_ids_to_delete
    ]

    # Remove nodes and point_ids
    mesh.points = np.delete(mesh.points, indices_to_delete, axis=0)
    mesh.point_ids = [pid for pid in mesh.point_ids if pid not in node_ids_to_delete]

    # Remove nodes from node sets
    for name, ids in mesh.node_sets.items():
        mesh.node_sets[name] = [i for i in ids if i not in node_ids_to_delete]

    # Remove elements connected to the deleted nodes
    for cell_block in mesh.cells:
        mask = np.isin(
            cell_block.connectivity, list(node_ids_to_delete), invert=True
        ).all(axis=1)
        cell_block.connectivity = cell_block.connectivity[mask]
        cell_block.ids = cell_block.ids[mask]

    # Filter out connections involving deleted nodes
    connections = [
        c
        for c in connections
        if c["source"] not in node_ids_to_delete
        and c["target"] not in node_ids_to_delete
    ]

    emit("mesh_data", {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False}, broadcast=True)
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("add_connection")
def handle_add_connection(data):
    """Handles a request to add a connection to the mesh."""
    global connections
    print(
        f"[DEBUG] add_connection SocketIO event received. Source: {data.get('source')}, Target: {data.get('target')}"
    )
    new_id = max([c.get("id") or 0 for c in connections]) + 1 if connections else 1
    data["id"] = new_id
    connections.append(data)

    emit(
        "mesh_data",
        {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False},
        broadcast=True,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("delete_connection")
def handle_delete_connection(data):
    """Handles a request to delete a connection from the mesh."""
    global connections
    print(
        f"[DEBUG] delete_connection SocketIO event received. Source: {data.get('source')}, Target: {data.get('target')}"
    )
    connections = [
        c
        for c in connections
        if not (
            (c["source"] == data["source"] and c["target"] == data["target"])
            or (c["source"] == data["target"] and c["target"] == data["source"])
        )
    ]
    emit(
        "mesh_data",
        {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False},
        broadcast=True,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("add_triangulation_connections")
def handle_add_triangulation_connections(data):
    """Handles a request to add multiple triangulation connections to the mesh."""
    global connections
    new_connections = data.get("connections", [])
    print(
        f"[DEBUG] add_triangulation_connections SocketIO event received. Adding {len(new_connections)} connections."
    )
    connections.extend(new_connections)
    emit(
        "mesh_data",
        {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False},
        broadcast=True,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("clear_mesh")
def handle_clear_mesh():
    """Handles a request to clear the mesh."""
    global mesh, connections
    print("[DEBUG] clear_mesh SocketIO event received.")
    mesh = None
    connections = []
    emit(
        "mesh_data",
        {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False},
        broadcast=True,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


@socketio.on("sync_mesh")
def handle_sync_mesh(data):
    """Handles a request to sync the mesh from a client."""
    global mesh, connections
    print("[DEBUG] sync_mesh SocketIO event received.")
    mesh = dict_to_mesh(data.get("mesh"))
    connections = data.get("connections", [])
    # Broadcast the synced mesh to all clients except the sender
    emit(
        "mesh_data",
        {"mesh": mesh_to_dict(mesh), "connections": connections, "isDragging": False},
        broadcast=True,
        include_self=False,
    )
    emit("mesh_summary", get_mesh_summary(), broadcast=True)
    save_mesh_to_disk()


if __name__ == "__main__":
    socketio.run(app, debug=True, port=5050)
