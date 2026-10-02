// App bootstrap: wires every module together. Nothing else should need to
// import more than a handful of these - if a feature needs to reach three
// unrelated modules, it probably belongs in its own module instead.
import { bus } from "./core/events.js";
import { store } from "./core/store.js";
import { selection } from "./core/selection.js";
import { viewport } from "./render/viewport.js";
import { scheduleDraw } from "./render/renderer.js";
import { toolManager } from "./tools/tool-manager.js";
import { selectTool } from "./tools/select.js";
import { selectSurfaceTool } from "./tools/select-surface.js";
import { addNodeTool } from "./tools/add-node.js";
import { createLineTool, createTriangleTool, createQuadTool } from "./tools/create-element.js";
import { deleteTool } from "./tools/delete.js";
import { registerCommands } from "./commands/commands.js";
import { run } from "./commands/registry.js";
import { buildMenubar } from "./ui/menubar.js";
import { buildToolRail, buildViewportControls } from "./ui/toolbar.js";
import { buildDock } from "./ui/dock.js";
import { buildStatusBar } from "./ui/statusbar.js";
import { installQualityTooltip } from "./ui/quality-tooltip.js";
import { installContextMenu } from "./ui/context-menu.js";
import { installShortcuts } from "./ui/shortcuts.js";
import * as client from "./net/client.js";
import { fetchElementTypes } from "./net/api.js";
import * as project from "./project/project.js";
import { toast } from "./ui/toast.js";

function applySavedTheme() {
    const saved = localStorage.getItem("pmf-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
}

function wireFileInputs() {
    const meshInput = document.getElementById("mesh-file-input");
    meshInput.addEventListener("change", async () => {
        const file = meshInput.files[0];
        meshInput.value = "";
        if (file) await project.importMeshFile(file);
    });

    const projectInput = document.getElementById("project-file-input");
    projectInput.addEventListener("change", async () => {
        const file = projectInput.files[0];
        projectInput.value = "";
        if (file) await project.openProjectFromInputFile(file);
    });
}

function wireProjectIndicator() {
    const el = document.getElementById("project-indicator");
    bus.on("project:changed", ({ name, dirty }) => {
        el.querySelector(".name").textContent = name;
        el.classList.toggle("dirty", dirty);
    });
}

function warnBeforeUnload() {
    window.addEventListener("beforeunload", e => {
        if (project.isDirty()) {
            e.preventDefault();
            e.returnValue = "";
        }
    });
}

async function main() {
    applySavedTheme();

    const canvas = document.getElementById("mesh-canvas");
    viewport.attach(canvas);
    toolManager.attach(canvas);

    toolManager.register(selectTool);
    toolManager.register(selectSurfaceTool);
    toolManager.register(addNodeTool);
    toolManager.register(createLineTool);
    toolManager.register(createTriangleTool);
    toolManager.register(createQuadTool);
    toolManager.register(deleteTool);
    toolManager.activate("select");

    registerCommands();
    buildMenubar(document.getElementById("menubar-menus"));
    buildToolRail(document.getElementById("tool-rail"));
    buildViewportControls(document.getElementById("viewport-controls"));
    buildDock(document.getElementById("dock"));
    buildStatusBar(document.getElementById("status-bar"), canvas, document.getElementById("tool-hint"));
    installQualityTooltip(canvas, document.getElementById("quality-tooltip"));
    installContextMenu(canvas);
    installShortcuts();
    wireFileInputs();
    wireProjectIndicator();
    warnBeforeUnload();

    bus.on("mesh:changed", scheduleDraw);
    bus.on("selection:changed", scheduleDraw);
    bus.on("visibility:changed", scheduleDraw);
    bus.on("quality:changed", scheduleDraw);

    bus.on("connection:changed", ({ connected }) => {
        if (!connected) toast.error("Disconnected from server. Reconnecting…");
    });

    let firstLoad = true;
    bus.on("mesh:changed", () => {
        if (firstLoad && store.mesh.nodes.length) {
            firstLoad = false;
            viewport.fitToPoints(store.mesh.nodes);
        }
    });

    store.setElementTypes(await fetchElementTypes());
    await project.restoreLastFileHandle();
    client.getMesh();
}

main();

// Exposed for manual debugging in the browser console only.
window.__pmf = { store, selection, viewport, run };
