from __future__ import annotations
import copy

import numpy as np

from .element_block import ElementBlock


class Mesh:
    """
    A class to hold mesh data, such as nodes, elements, and sets.

    This class provides a structured way to store and manipulate mesh data read
    from file formats like the Abaqus input deck. It organizes data into
    points (nodes), cells (elements), and various sets and data arrays
    associated with them.

    Attributes
    ----------
    points : np.ndarray
        A 2D array of node coordinates, with shape (num_points, 3).
    cells : list[ElementBlock]
        A list of ElementBlock objects, each representing a block of elements
        of the same type.
    node_sets : dict[str, np.ndarray]
        A dictionary mapping set names to 1D arrays of 0-based node indices.
    elem_sets : dict[str, list[np.ndarray]]
        A dictionary mapping set names to lists of 1D arrays of 0-based
        element indices. The list structure mirrors the `cells` attribute.
    surface_sets : dict[str, list[np.ndarray]]
        Similar to `elem_sets`, but for surfaces defined by element faces.
    point_ids : dict[str, np.ndarray]
        A dictionary mapping data array names to 1D arrays of data associated
        with each point.
    cell_ids : dict[str, np.ndarray]
        A dictionary mapping data array names to lists of arrays of data
        associated with each cell, mirroring the `cells` structure.
    """

    def __init__(
        self,
        points: np.ndarray,
        point_ids: list[int],
        cells: list[ElementBlock],
        node_sets: dict[str, list] | None = None,
        elem_sets: dict[str, list] | None = None,
        surface_sets: dict[str, list] | None = None,
        validate_flag: bool = True,
    ):
        # assign points directly (already a NumPy array)
        self.points = points
        self.point_ids = point_ids

        # list of unique element blocks, those with the same element_type already concatenated
        self.cells = cells

        self.node_sets = node_sets or {}
        self.elem_sets = elem_sets or {}
        self.surface_sets = surface_sets or {}

        if validate_flag:
            self._validate_data()

    def _validate_data(self):
        """
        Validates the consistency of nodes, elements, and their associated data.

        Raises
        ------
        ValueError
            If any inconsistency is found in the data.
        TypeError
            If any data has an incorrect type.
        """
        # Validate points
        if not isinstance(self.points, np.ndarray) or self.points.ndim != 2:
            raise TypeError("Points (coordinates) must be a 2D NumPy array.")

        # Validate point_ids
        if not isinstance(self.point_ids, list):
            raise TypeError("Point data must be a list.")
        if len(self.point_ids) != len(self.points):
            raise ValueError(
                f"Point ids has length {len(self.point_ids)}, but there are {len(self.points)} points."
            )

        # Validate if all nodes in element connectivity exist in points
        all_node_ids_in_elements = set()
        for block in self.cells:
            for node_id in block.connectivity.flatten():
                all_node_ids_in_elements.add(node_id)
        if not set(self.point_ids).issuperset(all_node_ids_in_elements):
            remain_nodes = all_node_ids_in_elements.difference(set(self.point_ids))
            raise ValueError(
                "Node IDs in element connectivity do not exist in point IDs: "
                + f"{sorted(remain_nodes)}"
            )

        # Validate cells
        if not isinstance(self.cells, list):
            raise TypeError("Cells (elements) must be a list of ElementBlock objects.")
        for i, block in enumerate(self.cells):
            if not isinstance(block, ElementBlock):
                raise TypeError(f"Element at index {i} is not an ElementBlock object.")

        # Validate node_sets
        if not isinstance(self.node_sets, dict):
            raise TypeError("Node sets must be a dictionary.")
        for name, nodes_in_set in self.node_sets.items():
            nodes_in_set = np.asarray(nodes_in_set)
            if not set(self.point_ids).issuperset(set(nodes_in_set)):
                remain_nodes = set(nodes_in_set).difference(set(self.point_ids))
                raise ValueError(
                    f"Node IDs in set '{name}' has nodes not in point IDs: "
                    + f"{sorted(remain_nodes)}"
                )

        # formulate a single cell id list
        whole_element_ids = []
        for block in self.cells:
            whole_element_ids.extend(block.ids)

        # Validate elem_sets
        if not isinstance(self.elem_sets, dict):
            raise TypeError("Element sets must be a dictionary.")
        for name, blocks_in_set in self.elem_sets.items():
            if not isinstance(blocks_in_set, list):
                raise TypeError(f"Element set '{name}' must be a list.")
            if not set(whole_element_ids).issuperset(set(blocks_in_set)):
                remain_elements = set(blocks_in_set).difference(set(whole_element_ids))
                raise ValueError(
                    f"Element IDs in set '{name}' has elements not in cell IDs: "
                    + f"{sorted(remain_elements)}"
                )

        # Validate surface_sets (similar to element_sets)
        if not isinstance(self.surface_sets, dict):
            raise TypeError("Surface sets must be a dictionary.")

    def __repr__(self) -> str:
        """Returns a summary of the Mesh data."""
        total_size = len(self.point_ids)

        lines = [
            f"<Mesh with {len(self.points)} points and {len(self.cells)} cell blocks>",
            "  Cell blocks:",
            *[
                f"    - # {block.element_type} elements: {len(block)} "
                for block in self.cells
            ],
            f"  # Points: {total_size}",
            f"  # Node Sets: {len(self.node_sets)}",
            f"  # Element Sets: {len(self.elem_sets)}",
            f"  # Surface Sets: {len(self.surface_sets)}",
        ]
        return "\n".join(lines)

    def copy(self) -> Mesh:
        """Returns a deep copy of the object."""
        return copy.deepcopy(self)
