import os
import csv
import json
import re


def read_abaqus_inp(filepath):
    """
    Reads mesh data from an Abaqus input file (.inp).

    Args:
        filepath (str): The path to the .inp file.

    Returns:
        dict: A dictionary containing the mesh nodes and connections.
    """
    nodes = []
    connections = []
    with open(filepath, "r") as f:
        lines = f.readlines()
    node_section = False
    elem_section = False
    for line in lines:
        line = line.strip()
        if line.lower().startswith("*node"):
            node_section = True
            elem_section = False
            continue
        if line.lower().startswith("*element"):
            elem_section = True
            node_section = False
            continue
        if line.startswith("*"):
            node_section = False
            elem_section = False
            continue
        if node_section and line:
            parts = re.split(r"[ ,]+", line)
            if len(parts) >= 3:
                nodes.append(
                    {"id": int(parts[0]), "x": float(parts[1]), "y": float(parts[2])}
                )
        if elem_section and line:
            parts = re.split(r"[ ,]+", line)
            if len(parts) >= 3:
                # For 2-node elements (lines), add as connection
                if len(parts) == 3:
                    connections.append(
                        {"source": int(parts[1]), "target": int(parts[2])}
                    )
                # For 3+ node elements (triangles, quads), add as edges between consecutive nodes
                else:
                    node_ids = [int(pid) for pid in parts[1:] if pid]
                    for i in range(len(node_ids)):
                        connections.append(
                            {
                                "source": node_ids[i],
                                "target": node_ids[(i + 1) % len(node_ids)],
                            }
                        )
    return {"nodes": nodes, "connections": connections}


def read_csv(filepath):
    """
    Reads mesh data from a CSV file.

    The CSV file should have a 'nodes' section and a 'connections' section.

    Args:
        filepath (str): The path to the .csv file.

    Returns:
        dict: A dictionary containing the mesh nodes and connections.
    """
    nodes = []
    connections = []
    section = "nodes"
    with open(filepath, newline="") as csvfile:
        reader = csv.reader(csvfile)
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
                connections.append({"source": int(row[0]), "target": int(row[1])})
    return {"nodes": nodes, "connections": connections}


def read_json(filepath):
    """
    Reads mesh data from a JSON file.

    Args:
        filepath (str): The path to the .json file.

    Returns:
        dict: A dictionary containing the mesh nodes and connections.
    """
    with open(filepath) as f:
        data = json.load(f)
    return {"nodes": data.get("nodes", []), "connections": data.get("connections", [])}


def read_deck(filepath):
    """
    Reads mesh data from a .deck file.

    Treats .deck files as Abaqus .inp files.

    Args:
        filepath (str): The path to the .deck file.

    Returns:
        dict: A dictionary containing the mesh nodes and connections.
    """
    # Treat deck files like Abaqus inp files for node/element parsing
    return read_abaqus_inp(filepath)


def read_mesh(filepath):
    """
    Reads mesh data from a file, determining the file type by its extension.

    Supported extensions: .inp, .deck, .csv, .json

    Args:
        filepath (str): The path to the mesh file.

    Returns:
        dict: A dictionary containing the mesh nodes and connections.

    Raises:
        ValueError: If the file extension is not supported.
    """
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".inp":
        return read_abaqus_inp(filepath)
    elif ext == ".deck":
        return read_deck(filepath)
    elif ext == ".csv":
        return read_csv(filepath)
    elif ext == ".json":
        return read_json(filepath)
    else:
        raise ValueError(f"Unsupported mesh file format: {ext}")
