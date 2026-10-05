# PlaneMeshForge

## Project Overview

PlaneMeshForge is a web-based tool for interactively building and editing 2D structural meshes. It renders the mesh on an HTML5 Canvas, edits nodes, elements (lines/triangles/quads), and sets directly, and keeps every open browser tab in sync in real time via Socket.IO. The server is the single source of truth: it owns the mesh, applies every edit, validates it, and tracks undo/redo history.

## Features

*   **Interactive Mesh Visualization:** Pan, zoom, and rotate on an HTML5 Canvas, with a light/dark theme and optional node/element labels.
*   **Real elements, not just lines:** Creating a "connection" makes a real `SFMGAX1` line element; triangles (`CGAX3`) and quads (`CGAX4`) are first-class too, so everything you draw exports to `.deck`.
*   **Selection:** Click, box-select, or lasso-select (Alt+drag) nodes; click to pick a single element. Shift adds, Ctrl toggles. The Select tool has an edge filter (`S`) for picking element edges ("surfaces") instead of nodes/elements - same click/box/lasso mechanics, just a different entity type, Abaqus/HyperMesh-style.
*   **Editing tools:** Select, Add Node, Create Line, Create Element (triangle or quad, picked automatically from how many nodes you click), Delete — each with a keyboard shortcut (see below) and a live overlay preview. You can also select 3-4 nodes in any order with the Select tool and run "Create Element from Selection".
*   **Inspector panel:** Edit a selected node's exact X/Y, see which elements use it; inspect a selected element's type/connectivity/area; see a bounding box and quick actions for larger selections.
*   **Transforms:** Translate, rotate (about the centroid or a point), scale, and mirror the selected nodes.
*   **Mesh utilities:** Merge coincident nodes (with tolerance), renumber node/element ids, split quads into triangles, and Delaunay-triangulate a selected point cloud into real triangle elements.
*   **Mesh quality check:** Flags inverted/degenerate elements, duplicate elements, and orphan nodes; clicking an issue selects it.
*   **Sets:** Create/rename/delete node and element sets from the current selection; per-set show/hide and isolate. Surface sets (read from imported decks) are viewable and highlightable.
*   **Snapping:** Snap to a grid spacing, or snap to the nearest existing node while dragging a single node.
*   **Undo/redo:** Server-side history (not just a client-side snapshot), shared by every connected client.
*   **File operations:** Import `.inp`/`.deck`, export `.deck`; New/Open/Save/Save As project files (File System Access API where supported, download-based fallback elsewhere). Old project files that used the earlier "connections" format still open (they're converted to line elements).

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `V` / `S` / `N` / `L` / `E` / `D` | Select / Select Surface (edge filter) / Add Node / Create Line / Create Element / Delete tool |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` | Save / Save As / Open project |
| `Ctrl+A` | Select all nodes |
| `Shift+E` | Create element from 3-4 selected nodes |
| `Delete` / `Backspace` | Delete selection |
| `F` | Fit view to mesh |
| `G` | Toggle snap-to-grid |
| `R` / `Shift+R` | Rotate view 90° CW / CCW |
| `+` / `-` | Zoom in / out |
| `Esc` | Cancel current tool action / clear selection |

## Technology Stack

*   **Frontend:**
    *   **HTML5 Canvas** for rendering; a small hand-written CSS design system (no framework, works offline).
    *   **Vanilla JavaScript (ES modules)** — no build step; Flask serves the modules as static files.
    *   **Socket.IO client** (vendored) for real-time sync with the backend.
    *   **Delaunator** (vendored) for client-side Delaunay triangulation.
*   **Backend:**
    *   **Flask + Flask-SocketIO** for HTTP routes and the real-time protocol.
    *   **NumPy** for mesh data arrays (points, connectivity).
    *   **Python** for mesh parsing, editing, and validation.

## Architecture

The backend is split into three layers:

*   **`core/`** — pure Python + NumPy, no Flask dependency, fully unit-tested. `editor.py`'s `MeshEditor` owns the current `Mesh` and its undo/redo stacks; `ops.py` is the registry of every mutation (add/delete/move nodes, add/delete elements, transform, merge, renumber, split quads, set editing); `transform.py`, `topology.py`, and `quality.py` hold the underlying geometry/topology/validation logic; `serialize.py` converts between `Mesh` and the JSON the client uses.
*   **`server/`** — adapts `core/` to the web: `routes.py` (HTTP: page, `/load`, `/export`, `/last_mesh`, `/element-types`), `sockets.py` (a single `op` event for every mutation, plus `undo`/`redo`/`get_mesh`/`load_mesh`/`quality_check`), and `session.py` (remembers and reloads the last-opened mesh file across restarts).
*   **`app.py`** just creates the Flask/SocketIO app and wires the two together.

The frontend is a tree of ES modules grouped by responsibility, with no shared mutable globals — modules only talk to each other through `core/store.js` (mesh data), `core/selection.js`, and a small pub/sub event bus (`core/events.js`):

*   **`core/`** — `store.js` (the mesh, rebuilt from server broadcasts), `selection.js`, `geometry.js`/`hit-test.js` (picking), `spatial-hash-grid.js`.
*   **`net/`** — `client.js` (the Socket.IO `op`/`undo`/`redo` protocol) and `api.js` (plain HTTP calls).
*   **`render/`** — `viewport.js` (camera/coordinate transforms) and `renderer.js` (draws grid/elements/nodes/labels/tool overlay).
*   **`tools/`** — `tool-manager.js` plus one file per tool (`select`, `add-node`, `create-element`, `delete`).
*   **`commands/`** — a single registry of actions (id, label, shortcut, enabled state) that the menubar, tool rail, context menu, and keyboard shortcuts all read from.
*   **`ui/`** — `menubar.js`, `toolbar.js`, `context-menu.js`, `statusbar.js`, `shortcuts.js`, `dialogs.js`, `toast.js`, and `panels/` (Inspector, Sets, Utilities).
*   **`project/`** — New/Open/Save/Save As and the IndexedDB file-handle cache.

## Project Structure

```
.
├── pyproject.toml          # Packaging/build config (hatchling)
├── LICENSE                 # MIT
├── README.md               # This file
├── data/                   # Sample mesh files for manual testing
├── tests/                  # Unit + Socket.IO integration tests (pytest/unittest)
├── src/planemeshforge/     # Installable package
│   ├── __init__.py         # Package version
│   ├── __main__.py         # `python -m planemeshforge` entry point
│   ├── cli.py               # `planemeshforge` console script (argparse)
│   ├── app.py               # Flask + Flask-SocketIO app wiring
│   ├── core/                 # Pure-Python mesh editor (editor, ops, transform, topology, quality, serialize)
│   ├── server/                # Flask routes + Socket.IO handlers + session persistence
│   ├── abaqus_io/           # Mesh I/O subpackage (Mesh/ElementBlock, .inp/.deck read+write)
│   │   └── config.yaml       # Supported element types and their dimensionality
│   ├── static/
│   │   ├── css/               # tokens.css, layout.css, components.css
│   │   ├── vendor/            # socket.io.min.js, delaunator.min.js (self-hosted, no CDN)
│   │   └── js/                # ES modules: core/, net/, render/, tools/, commands/, ui/, project/, main.js
│   └── templates/
│       └── index.html        # Main HTML shell
```

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

*   **Python (Backend):** Adheres to PEP 8. Functions and classes include docstrings. Mesh-editing logic lives in `core/` and stays free of any Flask/Socket.IO import so it can be unit-tested directly.
*   **JavaScript (Frontend):**
    *   Native ES modules (`import`/`export`), no bundler. camelCase for variables/functions, 4-space indentation.
    *   Modules don't reach into each other's internals — they share state only via `core/store.js`, `core/selection.js`, and `core/events.js`.
    *   HTML, CSS, and JS stay in their own files; the command registry (`commands/`) is the one place that defines what an action does and when it's enabled.
