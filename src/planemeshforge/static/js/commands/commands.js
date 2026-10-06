// Registers every command the app exposes. Imported once by main.js.
import { define } from "./registry.js";
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { viewport } from "../render/viewport.js";
import { scheduleDraw } from "../render/renderer.js";
import { toolManager } from "../tools/tool-manager.js";
import * as client from "../net/client.js";
import * as project from "../project/project.js";
import { toast } from "../ui/toast.js";
import { createElementFromNodes } from "../core/element-builder.js";

function toolCommand(id, toolId, label, icon, shortcut) {
    define({ id, label, icon, shortcut, run: () => toolManager.activate(toolId) });
}

export function registerCommands() {
    // ---- File ----
    define({ id: "file.new", label: "New Project", icon: "new", run: () => project.newProject() });
    define({ id: "file.open", label: "Open Project…", icon: "open", shortcut: "Ctrl+O", run: () => project.openProject() });
    define({ id: "file.save", label: "Save Project", icon: "save", shortcut: "Ctrl+S", run: () => project.saveProject() });
    define({ id: "file.saveAs", label: "Save Project As…", icon: "save", shortcut: "Ctrl+Shift+S", run: () => project.saveProjectAs() });
    define({ id: "file.import", label: "Import Mesh (.inp/.deck)…", icon: "import", run: () => document.getElementById("mesh-file-input").click() });
    define({ id: "file.export", label: "Export Deck…", icon: "export", run: () => project.exportDeck() });
    define({
        id: "file.clear",
        label: "Clear Mesh",
        icon: "trash",
        run: async () => {
            if (!confirm("Clear the entire mesh? This cannot be undone from an empty project.")) return;
            await client.op("clear_mesh", {});
        },
    });

    // ---- Edit ----
    define({
        id: "edit.undo",
        label: "Undo",
        icon: "undo",
        shortcut: "Ctrl+Z",
        isEnabled: () => store.canUndo,
        run: () => client.undo(),
    });
    define({
        id: "edit.redo",
        label: "Redo",
        icon: "redo",
        shortcut: "Ctrl+Y",
        isEnabled: () => store.canRedo,
        run: () => client.redo(),
    });
    define({ id: "edit.selectAll", label: "Select All Nodes", shortcut: "Ctrl+A", run: () => selection.selectAll() });
    define({
        id: "edit.createElementFromSelection",
        label: "Create Element from Selection",
        icon: "quad",
        shortcut: "Shift+E",
        isEnabled: () => !selection.elementIds.size && (selection.nodeIds.size === 3 || selection.nodeIds.size === 4),
        run: async () => {
            const result = await createElementFromNodes([...selection.nodeIds]);
            if (result.ok) selection.clear();
        },
    });
    define({
        id: "edit.deleteSelected",
        label: "Delete Selected",
        icon: "trash",
        shortcut: "Del",
        isEnabled: () => !selection.isEmpty(),
        run: async () => {
            if (selection.nodeIds.size) {
                const result = await client.op("delete_nodes", { ids: [...selection.nodeIds] });
                if (!result.ok) toast.error(result.error);
            }
            if (selection.elementIds.size) {
                const result = await client.op("delete_elements", { ids: [...selection.elementIds] });
                if (!result.ok) toast.error(result.error);
            }
            selection.clear();
        },
    });

    // ---- Tools ----
    toolCommand("tool.select", "select", "Select", "select", "V");
    toolCommand("tool.addNode", "add-node", "Add Node", "add-node", "N");
    toolCommand("tool.createLine", "create-line", "Create Line", "line", "L");
    toolCommand("tool.createElement", "create-element", "Create Element", "quad", "E");
    toolCommand("tool.delete", "delete", "Delete Tool", "delete-tool", "D");

    // ---- View ----
    define({ id: "view.zoomIn", label: "Zoom In", icon: "zoom-in", shortcut: "+", run: () => { viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1.2); scheduleDraw(); } });
    define({ id: "view.zoomOut", label: "Zoom Out", icon: "zoom-out", shortcut: "-", run: () => { viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1 / 1.2); scheduleDraw(); } });
    define({ id: "view.fit", label: "Fit to View", icon: "fit", shortcut: "F", run: () => { viewport.fitToPoints(store.mesh.nodes); scheduleDraw(); } });
    // `viewport.rotation` feeds toScreen()'s rotation matrix before the
    // canvas y-flip, so a positive angle there reads as counter-clockwise
    // on screen - negate it here so "CW"/"CCW" match what the user sees.
    define({ id: "view.rotateCW", label: "Rotate 90° CW", icon: "rotate-cw", shortcut: "R", run: () => { viewport.rotateBy(-Math.PI / 2); scheduleDraw(); } });
    define({ id: "view.rotateCCW", label: "Rotate 90° CCW", icon: "rotate-ccw", shortcut: "Shift+R", run: () => { viewport.rotateBy(Math.PI / 2); scheduleDraw(); } });
    define({
        id: "view.toggleNodeLabels",
        label: "Show Node Labels",
        run: () => { viewport.showNodeLabels = !viewport.showNodeLabels; scheduleDraw(); },
        isChecked: () => viewport.showNodeLabels,
    });
    define({
        id: "view.toggleElementLabels",
        label: "Show Element Labels",
        run: () => { viewport.showElementLabels = !viewport.showElementLabels; scheduleDraw(); },
        isChecked: () => viewport.showElementLabels,
    });
    define({
        id: "view.toggleSnap",
        label: "Snap to Grid",
        shortcut: "G",
        run: () => { viewport.snapToGrid = !viewport.snapToGrid; scheduleDraw(); },
        isChecked: () => viewport.snapToGrid,
    });
    define({
        id: "view.toggleTheme",
        label: "Toggle Dark Mode",
        run: () => {
            const root = document.documentElement;
            const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
            root.setAttribute("data-theme", next);
            localStorage.setItem("pmf-theme", next);
        },
    });
}
