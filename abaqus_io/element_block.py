from __future__ import annotations
import numpy as np


class ElementBlock:
    """A block of elements of the same type.

    Parameters
    ----------
    element_type : str
        The type of the elements in the block (e.g. "C3D8").
    ids : list | np.ndarray
        The IDs of the elements in the block.
    connectivity : list | np.ndarray
        The connectivity of the elements in the block. Each row defines an
        element, and the columns are the node IDs that make up the element.

    """

    def __init__(
        self,
        element_type: str,
        ids: list | np.ndarray,
        connectivity: list | np.ndarray,
    ):
        self.element_type = element_type
        self.ids = np.asarray(ids)
        self.connectivity = np.asarray(connectivity)

        if len(self.connectivity) != len(self.ids):
            raise ValueError(
                "The number of element IDs must match the number of elements."
            )

    def __repr__(self) -> str:
        return (
            f"<ElementBlock: {self.element_type}, "
            f"num_elements={len(self.connectivity)}>"
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
        if any(b.element_type != element_type for b in blocks):
            raise ValueError("All blocks must have the same element type.")

        ids = np.concatenate([b.ids for b in blocks])
        connectivity = np.concatenate([b.connectivity for b in blocks])
        return cls(element_type, ids, connectivity)
