# 2D Mesh Editor

## Project Overview

This project is a web-based tool designed for interactive manipulation and visualization of 2D structural meshes. It provides a user-friendly interface to load, view, edit, and export mesh data. The application aims to offer real-time feedback on mesh information as changes are made, supporting operations like moving, adding, or removing nodes, and managing connections (lines) between nodes.

## Features

*   **Interactive Mesh Visualization:** Pan, zoom, and rotate the mesh view on an HTML5 Canvas.
*   **Real-time Mesh Summary:** Displays the current number of nodes, lines (connections), and elements.
*   **Node Manipulation:**
    *   Add new nodes at the center of the view.
    *   Delete selected nodes.
    *   Move individual or multiple selected nodes by dragging.
    *   Multi-select nodes using rectangular selection with modifier keys (Ctrl/Cmd for toggle, Shift for add, no modifier for new selection).
*   **Connection Management:**
    *   (Planned) Add connections between nodes.
    *   (Planned) Remove connections between nodes.
*   **Element Visualization:** Displays 2D elements and their associated connections.
*   **File Operations:**
    *   Import mesh data from `.inp` (Abaqus), `.deck`, `.csv`, and `.json` formats.
    *   Export the connectivity matrix.
    *   New Project, Open Project, Save Project, Save Project As (using File System Access API where supported, with fallback).
*   **Undo/Redo Functionality:** History management for mesh modifications.
*   **Customizable View:** Toggle visibility of node and element labels.
*   **Responsive UI:** Adapts to different screen sizes.

## Technology Stack

*   **Frontend:**
    *   **React:** (Implicitly, through functional components and hooks-like patterns, though not a full React framework setup like Create React App)
    *   **HTML5 Canvas:** For mesh rendering.
    *   **JavaScript (ES6+):** Core logic and interactions.
    *   **Socket.IO:** Real-time bidirectional communication with the backend.
    *   **Tailwind CSS:** For utility-first styling.
    *   **Google Fonts (Roboto):** For typography.
*   **Backend:**
    *   **Flask (Python):** Web framework for serving the frontend and handling API requests.
    *   **Flask-SocketIO:** Integrates Socket.IO with Flask.
    *   **Python:** For mesh parsing and data handling.

## Project Structure

```
.
├── app.py                  # Flask backend application
├── GEMINI.md               # Project context and instructions
├── README.md               # This file
├── requirements.txt        # Python dependencies
├── data/                   # Sample mesh files
│   ├── geometry.deck
│   └── simple_mesh.inp
├── meshio/                 # Python module for mesh I/O operations
│   └── abaqusIO.py         # Handles reading .inp, .deck, .csv, .json mesh files
├── static/                 # Frontend static assets
│   ├── style.css           # Custom CSS styles
│   └── js/                 # JavaScript modules
│       ├── api.js          # Frontend API calls to Flask backend
│       ├── app.js          # Main frontend application logic, Socket.IO handling
│       ├── canvas.js       # Canvas rendering and interaction logic (pan, zoom, select, drag)
│       ├── spatial-hash-grid.js # Spatial data structure for efficient node querying
│       ├── state.js        # Global state management, HistoryManager for undo/redo
│       ├── ui.js           # UI interactions, message display, menu handling, file operations
│       └── utils.js        # Utility functions (throttle, debounce)
└── templates/
    └── index.html          # Main HTML template
```

## Detailed Functionalities

### `app.py` (Flask Backend)

The `app.py` file serves as the core of the backend, managing web requests and real-time mesh data.

*   **Initialization:** Sets up a Flask app and integrates Flask-SocketIO for WebSocket communication.
*   **Mesh Data Structure:** Maintains a global `mesh` dictionary in memory to store nodes, connections, and elements.
    *   `nodes`: `[{'id': int, 'x': float, 'y': float}]`
    *   `connections`: `[{'source': int, 'target': int}]`
    *   `elements`: `[{'id': int, 'node_ids': list}]`
*   **File Upload (`/load` POST):**
    *   Accepts mesh files (`.csv`, `.json`, `.inp`, `.deck`).
    *   Saves the uploaded file to the `data/` directory.
    *   Uses `meshio.abaqusIO.read_mesh` to parse the file and update the in-memory `mesh` data.
*   **Last Mesh Retrieval (`/last_mesh` GET):**
    *   Returns the current in-memory `mesh` data as JSON.
    *   If the mesh is empty but a previously uploaded file path exists, it attempts to reload the mesh from that file.
*   **Mesh Summary (`get_mesh_summary`):**
    *   Calculates and returns the number of nodes, lines, and elements in the current mesh.
*   **Export Connectivity (`/export` GET):**
    *   Returns the `connections` part of the current mesh as JSON.
*   **Socket.IO Event Handlers:**
    *   `get_mesh`: Emits the current mesh data to connected clients.
    *   `add_node`: Adds a new node to the mesh and broadcasts the updated mesh and summary.
    *   `delete_node`: Removes a node and its associated connections, then broadcasts updates.
    *   `update_node`: Updates the coordinates of an existing node and broadcasts updates.
    *   `add_connection`: Adds a new connection and broadcasts updates.
    *   `delete_connection`: Removes a connection (handles both directions for undirected graphs) and broadcasts updates.
    *   `clear_mesh`: Clears all mesh data and broadcasts updates.
*   **Running the Server:** The application runs on `http://127.0.0.1:5050` in debug mode.

### `meshio/abaqusIO.py` (Mesh I/O)

This module provides functions for reading mesh data from various file formats.

*   **`read_abaqus_inp(filepath)`:**
    *   Parses Abaqus `.inp` files.
    *   Extracts node IDs and coordinates from `*NODE` sections.
    *   Extracts element IDs and their connected node IDs from `*ELEMENT` sections.
    *   Generates connections (edges) from element node lists for visualization purposes.
*   **`read_csv(filepath)`:**
    *   Reads mesh data from CSV files.
    *   Expects sections for `nodes` (id, x, y) and `connections` (source, target).
*   **`read_json(filepath)`:**
    *   Reads mesh data from JSON files.
    *   Expects a JSON object with `nodes` and `connections` arrays.
*   **`read_deck(filepath)`:**
    *   Treats `.deck` files as Abaqus `.inp` files and uses `read_abaqus_inp` for parsing.
*   **`read_mesh(filepath)`:**
    *   A dispatcher function that determines the file type based on its extension (`.inp`, `.deck`, `.csv`, `.json`) and calls the appropriate reading function.
    *   Raises a `ValueError` for unsupported file formats.

### `static/js/` (Frontend JavaScript)

The JavaScript files collectively manage the frontend's interactive behavior, data visualization, and communication with the backend.

*   **`api.js`:**
    *   Provides functions (`uploadMesh`, `showMesh`, `clearMesh`, `exportMatrix`) to interact with the Flask backend's REST API endpoints using `fetch`.
    *   Manages `appState.meshLoaded` and `appState.meshDisplayed` flags.
*   **`app.js`:**
    *   Establishes the Socket.IO connection (`const socket = io();`).
    *   **`socket.on('mesh_data', ...)`:** The primary handler for mesh updates from the server. It updates the global `mesh` object, rebuilds `nodesMap` and `spatialGrid`, and triggers a redraw of the canvas. It intelligently handles updates during node dragging to prevent visual glitches.
    *   **`socket.on('mesh_summary', ...)`:** Updates the UI summary panel.
    *   **Initialization:** On `DOMContentLoaded`, it resizes the canvas, initializes the `HistoryManager`, and attempts to load a saved state from local storage or the last mesh from the server.
    *   **Mesh Operations:** Contains functions like `addNode`, `deleteSelected`, `addConnection` (placeholder), `removeConnection` (placeholder), and `updateSummary` that interact with the Socket.IO server.
*   **`canvas.js`:**
    *   Manages the HTML5 `<canvas>` element for drawing the mesh.
    *   **`resizeCanvas()`:** Adjusts canvas dimensions to match its display size and device pixel ratio.
    *   **`scheduleDrawMesh()`:** Debounces and throttles drawing requests to optimize performance.
    *   **`toScreen(x, y)` / `toWorld(x, y)`:** Coordinate transformation functions between world and screen space, considering pan, zoom, and rotation.
    *   **`drawMesh()`:** The main drawing function. It clears the canvas, draws elements (with edges and labels), connections, and nodes (with labels). It uses `spatialGrid` to draw only visible nodes.
    *   **`centerAndDrawMesh(data)`:** Calculates appropriate scale and offset to center the entire mesh within the canvas view.
    *   **Event Listeners:** Handles `mousedown`, `mousemove`, `mouseup`, and `wheel` events for:
        *   Panning (middle mouse button).
        *   Rotating (middle mouse button + Shift/Ctrl).
        *   Node dragging (left click on node).
        *   Rectangular selection (left click and drag).
        *   Zooming (mouse wheel).
        *   Context menu display (right click).
*   **`spatial-hash-grid.js`:**
    *   Implements a `SpatialHashGrid` class.
    *   **`constructor(bounds, dimensions)`:** Initializes the grid with overall bounds and cell dimensions.
    *   **`getCellIndex(position)`:** Calculates the grid cell index for a given position.
    *   **`insert(node)`:** Adds a node to the appropriate grid cell.
    *   **`query(bounds)`:** Efficiently retrieves all nodes within a given rectangular bounding box.
    *   **`queryPoint(position, radius)`:** Retrieves nodes within a circular radius around a point.
    *   **`remove(node)`:** Removes a node from its grid cell.
*   **`state.js`:**
    *   Declares global variables that hold the application's state:
        *   `mesh`: The current mesh data.
        *   `nodesMap`: A `Map` for quick access to nodes by their ID.
        *   `spatialGrid`: The instance of `SpatialHashGrid`.
        *   `appState`: Object to track `meshLoaded` and `meshDisplayed` status.
        *   `view`: Object containing `offsetX`, `offsetY`, `scale`, `rotation`, and `drawPending` for canvas view state.
        *   `lod`: Level of Detail thresholds for drawing (e.g., when to show node labels).
    *   **`updateNodePosition(nodeId, newX, newY)`:** Updates a node's coordinates and its position within the `spatialGrid`.
    *   **`HistoryManager` class:**
        *   Manages an undo/redo stack (`this.history`, `this.pointer`).
        *   `pushState()`: Saves the current application state (mesh, view, appState) to the history stack.
        *   `undo()` / `redo()`: Navigates the history stack and applies previous/next states.
        *   `applyState()`: Restores the application state from a history entry, triggering callbacks for UI updates.
        *   `saveToLocalStorage()` / `loadFromLocalStorage()`: Persists the current state to and from the browser's local storage.
    *   `pushStateToHistory()`: Global function to trigger state saving.
*   **`ui.js`:**
    *   Handles general UI interactions and visual feedback.
    *   **Dropdown Menus:** Manages the visibility of header dropdown menus.
    *   **`showMessage(msg, type, duration)`:** Displays temporary messages (info, success, error) in the status bar with a fade-out effect.
    *   **`updateSummary(summary)`:** Updates the mesh summary display in the bottom status bar.
    *   **File Input Trigger:** `triggerFileInput()` programmatically clicks the hidden file input for mesh import.
    *   **Context Menu:** `showContextMenu()` and `hideContextMenu()` manage the custom right-click menu on the canvas.
    *   **Undo/Redo Buttons:** `updateUndoRedoButtons()` enables/disables the Undo/Redo buttons based on the `HistoryManager`'s state.
    *   **Project Management:**
        *   `newProject()`: Resets the application state to an empty mesh.
        *   `openProject()`: Loads a project state from a JSON file (using `window.showOpenFilePicker` or a fallback input).
        *   `save()` / `saveAs()`: Saves the current project state to a JSON file (using `window.showSaveFilePicker` or a fallback download).
    *   **Menu Item Handlers:** `handleHeaderMenuItemClick` and `handleContextMenuItemClick` provide generic click handlers for menu items, preventing event propagation and displaying messages.
*   **`utils.js`:**
    *   Provides common utility functions for performance optimization.
    *   **`throttle(func, limit)`:** Ensures a function is called at most once within a specified time limit. Used for `mousemove` and `scheduleDrawMesh`.
    *   **`debounce(func, delay)`:** Delays the execution of a function until after a certain period of inactivity. Used for `pushStateToHistory`.

### `templates/index.html` (Frontend Structure)

The `index.html` file defines the overall layout and includes all necessary resources.

*   **HTML Structure:** Uses a flexbox layout to arrange the header, main content (canvas), and bottom status bar.
*   **Styling:** Links to Tailwind CSS CDN and `static/style.css` for custom styles.
*   **JavaScript Includes:** Loads Socket.IO library and all custom JavaScript modules in the correct order of dependency.
*   **Dynamic Date:** Displays the current date in the header.
*   **Hidden File Input:** Contains a hidden `<input type="file">` element used for mesh file uploads.
*   **Context Menu:** Defines the structure for the custom right-click context menu, including checkboxes for label visibility and buttons for view manipulation.

## How to Run

1.  **Prerequisites:**
    *   Python 3.x
    *   `pip` (Python package installer)
2.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
3.  **Run the Flask Application:**
    ```bash
    python app.py
    ```
    The application will typically run on `http://127.0.0.1:5050`.
4.  **Open in Browser:** Navigate to the address provided in your terminal (e.g., `http://127.0.0.1:5050`) to access the 2D Mesh Editor.

## Coding Conventions

*   **Python (Backend):** Adheres to PEP 8 style guide. Functions and classes include standard docstrings and comments.
*   **JavaScript (Frontend):**
    *   Uses camelCase for variable and function names.
    *   Interface names (though not explicitly defined as `I` prefixed in the provided code, the `GEMINI.md` suggests it) are generally implicit through object structures.
    *   Prefers functional components and React Hooks-like patterns.
    *   Uses 4 spaces for indentation.
    *   HTML, CSS, and JS are separated into their respective files.