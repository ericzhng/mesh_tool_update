import numpy as np
from numpy.typing import ArrayLike

from .element_block import _config


def _get_option_map(line, required_keys=None):
    """
    Get the optional arguments on a line.

    Parameters
    ----------
    line : str
        The line to parse.
    required_keys : list of str, optional
        A list of keys that must be present.

    Returns
    -------
    dict
        A dictionary mapping keys to values.

    Example
    -------
    >>> line = 'elset,instance=dummy2,generate'
    >>> params = _get_option_map(line, required_keys=['INSTANCE'])
    >>> params
    {'ELSET': None, 'INSTANCE': 'dummy2', 'GENERATE': None}
    """
    if required_keys is None:
        required_keys = []

    # Sanitize required keys to be uppercase
    required_keys = [key.upper() for key in required_keys]

    option_map = {}
    for part in line.split(","):
        part = part.strip()
        if not part:
            continue

        if "=" in part:
            key, value = part.split("=", 1)
            key = key.strip().upper()
            value = value.strip()
        else:
            key = part.upper()
            value = None
        option_map[key] = value

    missing_keys = [key for key in required_keys if key not in option_map]
    if missing_keys:
        raise ValueError(
            f"Missing required keys: {', '.join(missing_keys)} in line: '{line}'"
        )

    return option_map


def _read_nodes(f, options_map: dict):
    """
    Reads node information from a file object.

    This function parses lines containing node ID and coordinates,
    and optionally identifies node sets based on the provided options.

    Parameters
    ----------
    f : file object
        The file object to read from.
    options_map : dict
        A dictionary of options parsed from the keyword line,
        e.g., {'NSET': 'NODESET_NAME'}.

    Returns
    -------
    tuple
        - coord_array (np.ndarray): A NumPy array of node coordinates with shape (-1, 3).
        - nodes_id_map (dict): A dictionary mapping original node IDs to
                                 their 0-based index in the `nodes` array.
        - node_sets (dict): A dictionary of node sets, where keys are set names
                            and values are NumPy arrays of node IDs belonging to the set.
        - last_line (str): The last line read from the file that caused the loop to break
                           (either an empty line, a line starting with '*', or EOF).
    """
    coords = []
    nodes_ids = []

    while True:
        line = f.readline()
        if not line:  # Check for EOF
            break
        if not line.strip():  # Check for empty line
            continue
        if line.strip().startswith("**"):  # Check for comment line
            continue
        if line.strip().startswith("*"):  # Check for keyword beginning
            break

        parts = line.strip().split(",")
        try:
            node_id = int(parts[0].strip())
            coord = [float(x.strip()) for x in filter(None, parts[1:])]
        except (ValueError, IndexError) as e:
            raise ValueError(f"Malformed node line: '{line.strip()}'. Error: {e}")

        if len(coord) != 3:
            raise ValueError(f"Node {node_id} does not have 3 coordinates: {coord}")

        nodes_ids.append(node_id)
        coords.append(coord)

    coord_array = np.asarray(coords, dtype=float).reshape((-1, 3))

    node_sets = {}
    if "NSET" in options_map:
        nset_name = options_map["NSET"]
        # The keys of nodes_id_map are the original node IDs
        node_sets[nset_name] = nodes_ids

    return coord_array, nodes_ids, node_sets, line


def _read_cells(f, options_map: dict, point_ids: list[list]):
    """
    Reads cell (element) information from a file object.

    This function parses lines containing element ID and node IDs,
    and optionally identifies element sets based on the provided options.

    Parameters
    ----------
    f : file object
        The file object to read from.
    options_map : dict
        A dictionary of options parsed from the keyword line,
        e.g., {'ELSET': 'ELEMENTSET_NAME', 'TYPE': 'C3D8'}.
    nodes_id_map : dict
        A dictionary mapping original node IDs to their 0-based index
        in the global `nodes` array.

    Returns
    -------
    tuple
        - cells (np.ndarray): A NumPy array of cell connectivity with shape (-1, num_nodes_per_cell).
                              Node IDs are mapped to 0-based indices.
        - cells_map (dict): A dictionary mapping original element IDs to
                            their 0-based index in the `cells` array.
        - elem_sets (dict): A dictionary of element sets, where keys are set names
                            and values are NumPy arrays of element IDs belonging to the set.
        - last_line (str): The last line read from the file that caused the loop to break
                           (either an empty line, a line starting with '*', or EOF).
    """
    cell_type = options_map["TYPE"]

    try:
        cell_type_config = _config[cell_type]
        num_nodes_per_cell = cell_type_config["nodes"]
    except KeyError:
        raise ValueError(f"Element type not available or misconfigured: {cell_type}")

    cell_nodes = []
    cell_ids = []

    while True:
        line = f.readline()
        if not line:  # Check for EOF
            break
        if not line.strip():  # Check for empty line
            continue
        if line.strip().startswith("**"):  # Check for comment line
            continue
        if line.strip().startswith("*"):  # Check for keyword beginning
            break

        parts = line.strip().split(",")
        try:
            elem_id = int(parts[0].strip())
            node_ids = [int(x.strip()) for x in filter(None, parts[1:])]
        except (ValueError, IndexError) as e:
            raise ValueError(f"Malformed cell line: '{line.strip()}'. Error: {e}")

        if len(node_ids) != num_nodes_per_cell:
            raise ValueError(
                f"Element {elem_id} of type {cell_type} expects {num_nodes_per_cell} nodes, "
                f"but got {len(node_ids)}: {node_ids}"
            )

        if point_ids:
            # concatenate the list to an full array
            point_ids_total = np.concatenate(point_ids)
            point_ids_set = set(point_ids_total.tolist())
            # check if node_ids are not defined in points_id
            if not set(node_ids).issubset(point_ids_set):
                undefined_nodes = set(node_ids) - point_ids_set
                raise ValueError(
                    f"Element {elem_id} references undefined node IDs: {', '.join(map(str, undefined_nodes))}"
                )

        cell_ids.append(elem_id)
        cell_nodes.append(node_ids)

    cellnode_array = np.asarray(cell_nodes, dtype=np.int32).reshape(
        (-1, num_nodes_per_cell)
    )

    elem_sets = {}
    if "ELSET" in options_map:
        elset_name = options_map["ELSET"]
        elem_sets[elset_name] = cell_ids

    return cellnode_array, cell_ids, elem_sets, line


def _read_set(f, options_map: dict):
    """
    Reads set information from a file object.

    This function parses lines containing IDs for node sets or element sets.
    It handles both explicit ID lists and generated ID ranges.

    Parameters
    ----------
    f : file object
        The file object to read from.
    options_map : dict
        A dictionary of options parsed from the keyword line,
        e.g., {'NSET': 'NODESET_NAME'} or {'ELSET': 'ELEMENTSET_NAME'}.

    Returns
    -------
    tuple
        - set_ids (np.ndarray): A NumPy array of IDs belonging to the set.
        - set_names (list): A list of strings if the set contains names instead of IDs.
        - last_line (str): The last line read from the file that caused the loop to break
                           (either an empty line, a line starting with '*', or EOF).
    """
    set_ids = []
    set_names = []

    while True:
        line = f.readline()
        if not line:  # Check for EOF
            break
        if not line.strip():  # Check for empty line
            continue
        if line.strip().startswith("**"):  # Check for comment line
            continue
        if line.strip().startswith("*"):  # Check for keyword beginning
            break

        parts = line.strip().strip(",").split(",")
        try:
            # Attempt to convert all parts to integers
            numeric_parts = [int(k.strip()) for k in parts if k.strip()]
            set_ids.extend(numeric_parts)
        except ValueError:
            # If any part is not numeric, treat the whole line as names
            set_names.extend([k.strip() for k in parts if k.strip()])
        except IndexError as e:
            raise ValueError(f"Malformed set line: '{line.strip()}'. Error: {e}")

    if "GENERATE" in options_map:
        if len(set_ids) != 3:
            raise ValueError(
                f"GENERATE option requires 3 values (start, end, increment), but got {len(set_ids)}: {set_ids}"
            )
        set_ids = np.arange(
            set_ids[0], set_ids[1] + 1, set_ids[2], dtype=np.int32
        ).tolist()

    return set_ids, set_names, line
