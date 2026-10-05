// The vertical tool rail (left) and the floating zoom controls (bottom-left
// of the canvas). Both are thin views over the command registry.
import { bus } from "../core/events.js";
import { get, run } from "../commands/registry.js";
import { icon } from "./icons.js";

const TOOL_COMMANDS = ["tool.select", "tool.selectSurface", "tool.addNode", "tool.createLine", "tool.createElement", "tool.delete"];

export function buildToolRail(container) {
    const buttons = new Map();
    TOOL_COMMANDS.forEach(id => {
        const cmd = get(id);
        const btn = document.createElement("button");
        btn.className = "tool-btn";
        btn.title = `${cmd.label}${cmd.shortcut ? ` (${cmd.shortcut})` : ""}`;
        btn.innerHTML = icon(cmd.icon);
        btn.addEventListener("click", () => run(id));
        container.appendChild(btn);
        buttons.set(id, btn);
    });

    bus.on("tool:changed", activeTool => {
        for (const [id, btn] of buttons) {
            btn.classList.toggle("active", isActiveFor(id, activeTool));
        }
    });
}

// "Select" and "Select Surface" both activate the same underlying tool
// (tools/select.js) and just set its entity-type filter, so telling them
// apart in the rail needs the filter, not just the active tool's id.
function isActiveFor(commandId, activeTool) {
    if (!activeTool) return false;
    if (commandId === "tool.select") return activeTool.id === "select" && activeTool.filter === "point";
    if (commandId === "tool.selectSurface") return activeTool.id === "select" && activeTool.filter === "edge";
    return activeTool.id === toolMapping(commandId);
}

function toolMapping(commandId) {
    return {
        "tool.addNode": "add-node",
        "tool.createLine": "create-line",
        "tool.createElement": "create-element",
        "tool.delete": "delete",
    }[commandId];
}

export function buildViewportControls(container) {
    const zoomOut = document.createElement("button");
    zoomOut.className = "btn btn-icon";
    zoomOut.title = "Zoom out";
    zoomOut.innerHTML = icon("zoom-out");
    zoomOut.addEventListener("click", () => run("view.zoomOut"));

    const fit = document.createElement("button");
    fit.className = "btn btn-icon";
    fit.title = "Fit to view (F)";
    fit.innerHTML = icon("fit");
    fit.addEventListener("click", () => run("view.fit"));

    const zoomIn = document.createElement("button");
    zoomIn.className = "btn btn-icon";
    zoomIn.title = "Zoom in";
    zoomIn.innerHTML = icon("zoom-in");
    zoomIn.addEventListener("click", () => run("view.zoomIn"));

    container.append(zoomOut, fit, zoomIn);
}
