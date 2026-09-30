"""Plain HTTP routes: the page itself, file upload, export, and the initial
mesh fetch on page load."""

from __future__ import annotations

import io

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.utils import secure_filename

from ..abaqus_io import read_deck, write_buffer
from ..core import MeshEditor, element_type_registry, mesh_to_dict
from .session import SessionStorage

ALLOWED_EXTENSIONS = {"inp", "deck"}


def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def register_routes(app: Flask, editor: MeshEditor, storage: SessionStorage) -> None:
    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/element-types")
    def element_types():
        return jsonify(element_type_registry())

    @app.route("/load", methods=["POST"])
    def load_mesh():
        if "file" not in request.files:
            return "No file part", 400
        file = request.files["file"]
        if not file.filename:
            return "No selected file", 400
        if not _allowed_file(file.filename):
            return "Invalid file", 400

        filename = secure_filename(file.filename)
        filepath = f"{storage.temp_mesh_dir}/{filename}"
        file.save(filepath)
        try:
            mesh = read_deck(filepath)
        except Exception as exc:
            return f"Failed to parse mesh: {exc}", 400

        editor.set_mesh(mesh, record_history=False)
        storage.remember_filepath(filepath)
        return "Mesh loaded", 200

    @app.route("/export")
    def export_mesh():
        if editor.mesh is None:
            return "No mesh to export", 400
        try:
            buffer = io.StringIO()
            write_buffer(buffer, editor.mesh)
            return Response(
                buffer.getvalue(),
                mimetype="text/plain",
                headers={"Content-Disposition": "attachment;filename=mesh.deck"},
            )
        except Exception as exc:
            return f"Failed to export mesh: {exc}", 500

    @app.route("/last_mesh")
    def last_mesh():
        return jsonify(mesh_to_dict(editor.mesh))
