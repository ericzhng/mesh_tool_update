"""
I/O for Abaqus inp files.
"""

from pathlib import Path
from typing import List

import numpy as np
from numpy.typing import ArrayLike

from abaqus_io.mesh_io import Mesh
from .element_block import ElementBlock
from .deck_utility import _get_option_map, _read_cells, _read_nodes, _read_set


def read_deck(filename, validate_flag: bool = True):
    """Reads an Abaqus inp file."""
    with open(filename, "r") as f:
        return _read_buffer(f, validate_flag)


def _read_buffer(f, validate_flag: bool = True):
    # Initialize data fields, later to combine together
    points: list[np.ndarray] = []
    point_ids: list[list] = []

    cells: List[ElementBlock] = []

    node_sets: dict[str, list] = {}
    elem_sets: dict[str, list] = {}
    surf_sets: dict[str, list] = {}

    # later to combine into above sets
    node_sets_in_node = {}  # Handle cell sets defined in NODE
    cell_sets_in_element = {}  # Handle cell sets defined in ELEMENT

    mesh_ext = None

    # start parsing data
    line = f.readline()
    while True:
        if not line:  # Check for EOF
            break

        if not line.strip():  # Check for empty line
            line = f.readline()
            continue
        if line.strip().startswith("**"):  # Check for comment line
            line = f.readline()
            continue

        keyword = line.partition(",")[0].strip().replace("*", "").upper()

        if keyword == "NODE":
            options_map = _get_option_map(line)
            coords, ids, sets, line = _read_nodes(f, options_map)
            if sets:
                node_sets_in_node.update(sets)
            points.append(coords)
            point_ids.append(ids)

        elif keyword == "ELEMENT":
            if not point_ids:
                raise Exception("Expected *NODE definition before *ELEMENT definition")

            options_map = _get_option_map(line, required_keys=["TYPE"])
            nodes, ids, sets, line = _read_cells(f, options_map, point_ids)
            if sets:
                cell_sets_in_element.update(sets)
            cells.append(ElementBlock(options_map["TYPE"], ids, nodes))

        elif keyword == "NSET":
            options_map = _get_option_map(line, required_keys=["NSET"])
            # skip possible node sets defined by element, to implement in future
            set_ids, _, line = _read_set(f, options_map)
            name = options_map["NSET"]
            if name in node_sets.keys():
                node_sets[name].extend(set_ids)
            else:
                node_sets[name] = set_ids

        elif keyword == "ELSET":
            options_map = _get_option_map(line, required_keys=["ELSET"])
            set_ids, set_names, line = _read_set(f, options_map)

            elem_sets_local = []
            if set_ids:
                elem_sets_local.extend(set_ids)
            elif set_names:
                # otherwise sets are defined by set names defined previously
                for set_name in set_names:
                    if set_name in elem_sets.keys():
                        elem_sets_local.extend(elem_sets[set_name])
                    elif set_name in cell_sets_in_element.keys():
                        elem_sets_local.extend(cell_sets_in_element[set_name])
                    else:
                        raise Exception(f"Unknown element set '{set_name}'")

            name = options_map["ELSET"]
            if name in elem_sets.keys():
                elem_sets[name].extend(elem_sets_local)
            else:
                elem_sets[name] = elem_sets_local

        elif keyword == "SURFACE":
            options_map = _get_option_map(line, required_keys=["NAME", "TYPE"])
            set_ids, set_names, line = _read_set(f, options_map)

            name = options_map["NAME"]
            if set_names:
                if name in surf_sets.keys():
                    surf_sets[name].append(set_names)
                else:
                    surf_sets[name] = set_names

        elif keyword == "INCLUDE":
            # split line to get external deck filepath (example: *INCLUDE, INPUT=bulk.inp)
            ext_input_file = Path(f.name).parent / Path(line.split("=")[-1].strip())
            if not ext_input_file.exists():
                raise IOError(f"INCLUDE deck file does not exist {str(ext_input_file)}")

            mesh_ext = read_deck(ext_input_file, False)
            line = f.readline()

        else:
            line = f.readline()

    # Parse node sets defined in NODE
    for name in node_sets_in_node.keys():
        if name in node_sets.keys():
            node_sets[name].extend(node_sets_in_node[name])
        else:
            node_sets[name] = node_sets_in_node[name]

    # Parse cell sets defined in ELEMENT
    for name in cell_sets_in_element.keys():
        if name in elem_sets.keys():
            elem_sets[name].extend(cell_sets_in_element[name])
        else:
            elem_sets[name] = cell_sets_in_element[name]

    if mesh_ext is not None:
        points, point_ids, cells, node_sets, elem_sets, surf_sets = _merge(
            points,
            point_ids,
            cells,
            node_sets,
            elem_sets,
            surf_sets,
            mesh_ext,
        )

    # # move the checking to the Mesh class validate function
    # if point_ids:
    #     # concatenate the list to an full array
    #     point_ids_total = np.concatenate(point_ids)
    #     point_ids_set = set(point_ids_total.tolist())
    #     # check if node_ids are not defined in points_id
    #     if not set(node_ids).issubset(point_ids_set):
    #         undefined_nodes = set(node_ids) - point_ids_set
    #         raise ValueError(
    #             f"Element {elem_id} references undefined node IDs: {', '.join(map(str, undefined_nodes))}"
    #         )

    point_coords = np.concatenate(points)
    point_ids_total = [item for sublist in point_ids for item in sublist]

    return Mesh(
        point_coords,
        point_ids_total,
        cells,
        node_sets,
        elem_sets,
        surf_sets,
        validate_flag,
    )


def _merge(
    points,
    point_ids,
    cells,
    node_sets,
    elem_sets,
    surf_sets,
    mesh_ext: Mesh,
):
    """Merge existing variables with external mesh object."""
    points_update = np.concatenate(points + [mesh_ext.points])
    point_ids_total = np.concatenate(point_ids + [mesh_ext.point_ids])

    cells.cat(mesh_ext.cells)

    for name, val in mesh_ext.node_sets.items():
        if name in node_sets.keys():
            node_sets[name].extend(val)
        else:
            node_sets[name] = val

    for name, val in mesh_ext.elem_sets.items():
        if name in elem_sets.keys():
            elem_sets[name].extend(val)
        else:
            elem_sets[name] = val

    for name, val in mesh_ext.surface_sets.items():
        if name in surf_sets.keys():
            surf_sets[name].extend(val)
        else:
            surf_sets[name] = val

    return points_update, point_ids, cells, node_sets, elem_sets, surf_sets
