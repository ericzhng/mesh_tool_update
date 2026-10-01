"""`MeshEditor`: the single place that owns the current mesh, applies
operations, and manages undo/redo history."""

from __future__ import annotations

from collections import deque

from ..abaqus_io import Mesh
from . import quality
from . import topology as topo
from .ops import OPS
from .serialize import mesh_summary, mesh_to_dict

MAX_HISTORY = 100


class MeshEditor:
    """Owns the current `Mesh` (or `None`) and its undo/redo stacks."""

    def __init__(self, mesh: Mesh | None = None):
        self.mesh: Mesh | None = mesh
        self._undo: deque[Mesh | None] = deque(maxlen=MAX_HISTORY)
        self._redo: deque[Mesh | None] = deque(maxlen=MAX_HISTORY)

    def set_mesh(self, mesh: Mesh | None, record_history: bool = False) -> None:
        """Replaces the current mesh (e.g. on file load, import, or sync).

        By default this does not go on the undo stack, since it represents a
        new starting point rather than an edit.
        """
        if mesh is not None:
            topo.orient_ccw(mesh)
        if record_history:
            self._snapshot()
        else:
            self._undo.clear()
            self._redo.clear()
        self.mesh = mesh

    def _snapshot(self) -> None:
        self._undo.append(self.mesh.copy() if self.mesh is not None else None)
        self._redo.clear()

    def apply(self, op_name: str, args: dict) -> dict:
        """Applies a named operation from the `ops` registry.

        Snapshots the current mesh first so the change can be undone. If the
        operation raises, the snapshot is discarded and the exception's
        message is returned as `{ok: False, error: ...}` without having
        mutated the visible state (the mesh may be partially mutated
        in-place, so on failure it is restored from the snapshot).
        """
        if op_name != "clear_mesh" and op_name not in OPS:
            return {"ok": False, "error": f"Unknown operation: {op_name}"}

        before = self.mesh.copy() if self.mesh is not None else None
        self._snapshot()
        try:
            if op_name == "clear_mesh":
                self.mesh = None
                result = {}
            else:
                result = OPS[op_name](self.mesh, **args)
                if "mesh" in result:
                    self.mesh = result.pop("mesh")
            if self.mesh is not None:
                topo.orient_ccw(self.mesh)
                self.mesh._validate_data()
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as an error
            self._undo.pop()
            self.mesh = before
            return {"ok": False, "error": str(exc)}

        return {"ok": True, **result}

    def can_undo(self) -> bool:
        return len(self._undo) > 0

    def can_redo(self) -> bool:
        return len(self._redo) > 0

    def undo(self) -> bool:
        if not self._undo:
            return False
        self._redo.append(self.mesh.copy() if self.mesh is not None else None)
        self.mesh = self._undo.pop()
        return True

    def redo(self) -> bool:
        if not self._redo:
            return False
        self._undo.append(self.mesh.copy() if self.mesh is not None else None)
        self.mesh = self._redo.pop()
        return True

    def quality_check(self) -> list[dict]:
        return quality.check(self.mesh)

    def state(self) -> dict:
        """The full payload broadcast to clients after every change."""
        return {
            "mesh": mesh_to_dict(self.mesh),
            "summary": mesh_summary(self.mesh),
            "can_undo": self.can_undo(),
            "can_redo": self.can_redo(),
        }
