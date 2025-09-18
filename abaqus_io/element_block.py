from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike

from ._common import read_config

# Load configuration once at the module level
_config = read_config()


class ElementBlock:
    """A block of elements of the same type.

    Attributes
    ----------
    element_type : str
        The type of the elements in the block (e.g., "C3D8").
    ids : np.ndarray
        The IDs of the elements in the block.
    connectivity : np.ndarray
        The connectivity of the elements in the block. Each row defines an
        element, and the columns are the node IDs that make up the element.
    dim : int
        The dimensionality of the elements (e.g., 2 for 2D, 3 for 3D).
    num_nodes : int
        The number of nodes per element in the block.

    Parameters
    ----------
    element_type : str
        The type of the elements in the block (e.g., "C3D8"). If an empty
        string, `dim` and `num_nodes` will be initialized to 0.
    ids : list | np.ndarray
        The IDs of the elements in the block.
    connectivity : list | np.ndarray
        The connectivity of the elements in the block. Each row defines an
        element, and the columns are the node IDs that make up the element.

    Raises
    ------
    ValueError
        If `element_type` is not supported (i.e., not found in `config.yaml`)
        or if the number of element IDs does not match the number of elements
        in `connectivity`.
    """

    def __init__(
        self,
        element_type: str,
        ids: ArrayLike,
        connectivity: ArrayLike,
    ):
        self.element_type = element_type

        self.dim = 0
        self.num_nodes = 0
        if element_type:
            if element_type not in _config.keys():
                raise ValueError(
                    "Unsupported element type, please add relevant element info in config.yaml file."
                )
            cell_type_config = _config[element_type]
            if "dim" in cell_type_config:
                self.dim = cell_type_config["dim"]
            if "nodes" in cell_type_config:
                self.num_nodes = cell_type_config["nodes"]

        self.ids = np.asarray(ids, dtype=np.int32)
        self.connectivity = np.asarray(connectivity, dtype=np.int32)

        if self.connectivity.shape[0] != len(self.ids):
            raise ValueError(
                "The number of element IDs must match the number of elements."
            )

        if self.connectivity.size > 0 and len(self.connectivity[0]) != self.num_nodes:
            raise ValueError(
                "The number of nodes in connectivity must match with specified value."
            )

    def __repr__(self) -> str:
        return (
            f"<ElementBlock: {self.element_type}, dim={self.dim}, #nodes_per_cell={self.num_nodes}, "
            f"#elements={len(self.connectivity)}>"
        )

    def __len__(self) -> int:
        return len(self.connectivity)

    @classmethod
    def empty(cls) -> ElementBlock:
        """Creates an empty ElementBlock."""
        return cls(
            element_type="",
            ids=np.array([], dtype=int),
            connectivity=np.array([], dtype=int),
        )

    @classmethod
    def cat(cls, blocks: list[ElementBlock]) -> ElementBlock:
        """Concatenates a list of ElementBlock objects."""
        if not blocks:
            return cls.empty()

        element_type = blocks[0].element_type
        dim = blocks[0].dim
        if any(b.element_type != element_type for b in blocks):
            raise ValueError("All blocks must have the same element type.")
        if any(b.dim != dim for b in blocks):
            raise ValueError("All blocks must have the same dimension.")

        ids = np.concatenate([b.ids for b in blocks])
        connectivity = np.concatenate([b.connectivity for b in blocks])
        return cls(element_type, ids, connectivity)
