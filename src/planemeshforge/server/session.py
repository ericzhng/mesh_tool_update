"""Disk persistence for the current session: remembers which mesh file was
loaded, and re-saves it after edits so a restart resumes where it left off."""

from __future__ import annotations

import json
import os

from ..abaqus_io import Mesh, read_deck, write_buffer


class SessionStorage:
    """Holds the data-dir paths. Created once at app-init time and pointed at
    a real directory later via `configure`, so route/socket handlers can hold
    a single long-lived reference registered before the data dir is known."""

    def __init__(self):
        self.mesh_info_path: str | None = None
        self.temp_mesh_dir: str | None = None

    def configure(self, data_dir: str) -> None:
        self.mesh_info_path = os.path.join(data_dir, "mesh_info.json")
        self.temp_mesh_dir = os.path.join(data_dir, "mesh_files")
        os.makedirs(self.temp_mesh_dir, exist_ok=True)

    def load_last_mesh(self) -> Mesh | None:
        """Re-reads the mesh file remembered from the previous session, if any."""
        if not self.mesh_info_path or not os.path.exists(self.mesh_info_path):
            return None
        try:
            with open(self.mesh_info_path, "r") as f:
                filepath = json.load(f).get("filepath")
            if filepath and os.path.exists(filepath):
                return read_deck(filepath)
        except (json.JSONDecodeError, IOError) as exc:
            print(f"[ERROR] Failed to load initial mesh info: {exc}")
        return None

    def remember_filepath(self, filepath: str) -> None:
        with open(self.mesh_info_path, "w") as f:
            json.dump({"filepath": filepath}, f)

    def save_mesh(self, mesh: Mesh | None) -> None:
        """Writes `mesh` back to the remembered source file, if there is one."""
        if mesh is None or not self.mesh_info_path or not os.path.exists(self.mesh_info_path):
            return
        try:
            with open(self.mesh_info_path, "r") as f:
                filepath = json.load(f).get("filepath")
            if filepath:
                with open(filepath, "w") as f:
                    write_buffer(f, mesh)
        except (json.JSONDecodeError, IOError) as exc:
            print(f"[ERROR] Failed to save mesh to disk: {exc}")
