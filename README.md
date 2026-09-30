# PlaneMeshForge

## Project Overview

PlaneMeshForge is a web-based tool for interactive manipulation and visualization of 2D structural meshes. It provides a user-friendly interface to load, view, edit, and export mesh data, with real-time feedback on mesh information as changes are made, supporting operations like moving, adding, or removing nodes, and managing connections (lines) between nodes.

## Features

*   **Interactive Mesh Visualization:** Pan, zoom, and rotate the mesh view on an HTML5 Canvas.
*   **Real-time Mesh Summary:** Displays the current number of nodes, lines (connections), and elements.
*   **Node Manipulation:**
    *   Add new nodes at the center of the view.
    *   Delete selected nodes.
    *   Move individual or multiple selected nodes by dragging.
    *   Multi-select nodes using rectangular selection with modifier keys (Ctrl/Cmd for toggle, Shift for add, no modifier for new selection).
*   **Connection Management:** Add and remove connections between nodes, including automatic triangulation.
*   **Element Visualization:** Displays 2D elements and their associated connections.
*   **File Operations:**
    *   Import mesh data from `.inp` and `.deck` (Abaqus-style) formats.
    *   Export the current mesh as a `.deck` file.
    *   New Project, Open Project, Save Project, Save Project As (using the File System Access API where supported, with a download-based fallback).
*   **Undo/Redo Functionality:** History management for mesh modifications.
*   **Customizable View:** Toggle visibility of node and element labels.
*   **Responsive UI:** Adapts to different screen sizes.

## Technology Stack

*   **Frontend:**
    *   **HTML5 Canvas:** For mesh rendering.
    *   **JavaScript (ES6+):** Core logic and interactions.
    *   **Socket.IO:** Real-time bidirectional communication with the backend.
    *   **Tailwind CSS:** For utility-first styling.
    *   **Google Fonts (Roboto):** For typography.
*   **Backend:**
    *   **Flask (Python):** Web framework for serving the frontend and handling API requests.
    *   **Flask-SocketIO:** Integrates Socket.IO with Flask.
    *   **NumPy:** Mesh data arrays (points, connectivity).
    *   **Python:** For mesh parsing and data handling.

## Project Structure

```
.
├── pyproject.toml          # Packaging/build config (hatchling)
├── LICENSE                 # MIT
├── README.md               # This file
├── data/                   # Sample mesh files for manual testing
│   ├── simple_mesh.inp
│   └── simple_mesh_include.inp
├── tests/                  # Unit tests (pytest/unittest)
├── src/planemeshforge/     # Installable package
│   ├── __init__.py         # Package version
│   ├── __main__.py         # `python -m planemeshforge` entry point
│   ├── cli.py               # `planemeshforge` console script (argparse)
│   ├── app.py               # Flask + Flask-SocketIO application
│   ├── abaqus_io/           # Mesh I/O subpackage
│   │   ├── mesh_io.py        # Mesh data structure
│   │   ├── element_block.py  # ElementBlock data structure + supported element types
│   │   ├── deck_read.py      # Abaqus .inp/.deck reader
│   │   ├── deck_write.py     # Abaqus .inp/.deck writer
│   │   ├── deck_utility.py   # Low-level deck parsing helpers
│   │   ├── _common.py        # Shared helpers, logging, config.yaml loader
│   │   └── config.yaml       # Supported element types and their dimensionality
│   ├── static/               # Frontend static assets
│   │   ├── style.css
│   │   └── js/                # JavaScript modules (canvas, state, UI, API, etc.)
│   └── templates/
│       └── index.html        # Main HTML template
```

## Detailed Functionalities

### `app.py` (Flask Backend)

The `app.py` module is the core of the backend, managing web requests and real-time mesh data.

*   **Initialization:** Sets up a Flask app and integrates Flask-SocketIO for WebSocket communication.
*   **Mesh Data Structure:** Maintains a module-level `mesh` object (an `abaqus_io.Mesh`) and a `connections` list in memory.
*   **Storage (`init_storage`):** Called once at startup by the CLI. Creates the data directory (uploaded meshes, `mesh_info.json` for session persistence) and reloads the last mesh if one was previously loaded.
*   **File Upload (`/load` POST):**
    *   Accepts mesh files (`.inp`, `.deck`).
    *   Saves the uploaded file into the data directory.
    *   Uses `abaqus_io.read_deck` to parse the file and update the in-memory `mesh`.
*   **Last Mesh Retrieval (`/last_mesh` GET):** Returns the current in-memory mesh as JSON.
*   **Mesh Summary (`get_mesh_summary`):** Calculates and returns the number of nodes, elements, and named sets in the current mesh.
*   **Export (`/export` GET):** Returns the current mesh as a downloadable `.deck` file.
*   **Socket.IO Event Handlers:**
    *   `get_mesh`: Emits the current mesh data to connected clients.
    *   `add_node` / `delete_node` / `update_node` / `update_nodes_bulk` / `delete_nodes_bulk`: Mutate nodes and broadcast the updated mesh and summary.
    *   `add_connection` / `delete_connection` / `add_triangulation_connections`: Manage connections between nodes.
    *   `clear_mesh`: Clears all mesh data.
    *   `sync_mesh`: Accepts a full mesh snapshot from a client (used by project load/undo) and rebroadcasts it to other clients.

### `abaqus_io/` (Mesh I/O)

This subpackage provides the `Mesh` and `ElementBlock` data structures and functions for reading/writing mesh data.

*   **`read_deck(filepath)` / `write_deck(filepath, mesh)`:** Parse and serialize Abaqus-style `.inp`/`.deck` files (`*NODE`, `*ELEMENT`, `*NSET`, `*ELSET`, `*SURFACE` sections).
*   **`Mesh`:** Holds points, point IDs, cell blocks (elements), and named node/element/surface sets.
*   **`ElementBlock`:** Holds one element type's IDs and connectivity; supported element types and their dimensionality are declared in `config.yaml`.

### `static/js/` (Frontend JavaScript)

*   **`api.js`:** REST calls to the Flask backend (`uploadMesh`, `showMesh`, `clearMesh`, `exportMatrix`).
*   **`app.js`:** Socket.IO connection and handlers (`mesh_data`, `mesh_summary`), startup sequencing, node/connection operations.
*   **`canvas.js`:** Canvas rendering, coordinate transforms, pan/zoom/rotate, node dragging, rectangular selection, context menu.
*   **`spatial-hash-grid.js`:** `SpatialHashGrid` for efficient node lookups by position/region.
*   **`state.js`:** Global state (`mesh`, `nodesMap`, `spatialGrid`, `appState`, `view`, `lod`) and the `HistoryManager` (undo/redo, local storage persistence).
*   **`db.js`:** IndexedDB-backed storage for saved projects.
*   **`ui.js`:** Menus, status messages, context menu, undo/redo buttons, project New/Open/Save/Save As.
*   **`utils.js`:** `throttle` / `debounce` helpers.

## Installation

Requires Python 3.10+.

```bash
pip install .
```

For development (editable install with test dependencies):

```bash
pip install -e ".[dev]"
```

## Running

Once installed, start the server with the console script:

```bash
planemeshforge
```

Then open the printed address (default `http://127.0.0.1:5050`) in your browser.

Useful options:

```bash
planemeshforge --port 5051 --host 0.0.0.0 --debug
planemeshforge --data-dir /path/to/storage   # where uploaded meshes/session state are kept (default: ~/.planemeshforge)
python -m planemeshforge                     # equivalent to the console script
```

## Building a wheel

```bash
pip install build
python -m build
```

This produces `dist/planemeshforge-<version>-py3-none-any.whl` and a matching sdist, both including the frontend assets, templates, and `abaqus_io/config.yaml`.

## Running the tests

```bash
pip install -e ".[dev]"
pytest
```

## Coding Conventions

*   **Python (Backend):** Adheres to PEP 8. Functions and classes include docstrings.
*   **JavaScript (Frontend):**
    *   Uses camelCase for variable and function names.
    *   Uses 4 spaces for indentation.
    *   HTML, CSS, and JS are separated into their respective files.
