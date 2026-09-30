// Right-click menu: shows only the actions relevant to whatever is under
// the cursor (a node, an element, or empty canvas) instead of duplicating
// the whole Edit menu.
import { selection } from "../core/selection.js";
import { viewport } from "../render/viewport.js";
import { hitNode, hitElement } from "../core/hit-test.js";
import { run } from "../commands/registry.js";
import * as client from "../net/client.js";
import { toast } from "./toast.js";
import { icon } from "./icons.js";

const menuEl = document.getElementById("context-menu");

function item(label, onClick, { disabled = false, icon: iconName = null } = {}) {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.innerHTML = `${iconName ? icon(iconName) : ""}<span>${label}</span>`;
    btn.disabled = disabled;
    btn.addEventListener("click", () => {
        hide();
        onClick();
    });
    return btn;
}

function separator() {
    const el = document.createElement("div");
    el.className = "context-menu-separator";
    return el;
}

function hide() {
    menuEl.style.display = "none";
}

function buildForNode(node) {
    if (!selection.nodeIds.has(node.id)) selection.setNodes([node.id]);
    return [
        item("Delete Node", async () => {
            const result = await client.op("delete_nodes", { ids: [...selection.nodeIds] });
            if (!result.ok) toast.error(result.error);
        }),
        separator(),
        item("Deselect", () => selection.clear()),
    ];
}

function buildForElement(element) {
    if (!selection.elementIds.has(element.id)) selection.setElements([element.id]);
    return [
        item("Delete Element", async () => {
            const result = await client.op("delete_elements", { ids: [...selection.elementIds] });
            if (!result.ok) toast.error(result.error);
        }),
        separator(),
        item("Deselect", () => selection.clear()),
    ];
}

function buildForEmptyCanvas() {
    return [
        item("Add Node Here", () => run("tool.addNode")),
        separator(),
        item("Fit to View", () => run("view.fit"), { icon: "fit" }),
        item("Rotate CW", () => run("view.rotateCW"), { icon: "rotate-cw" }),
        item("Rotate CCW", () => run("view.rotateCCW"), { icon: "rotate-ccw" }),
        separator(),
        item("Select All", () => run("edit.selectAll")),
    ];
}

export function installContextMenu(canvas) {
    canvas.addEventListener("contextmenu", e => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const world = viewport.toWorld(screen);

        const node = hitNode(world);
        const element = node ? null : hitElement(world);
        const items = node ? buildForNode(node) : element ? buildForElement(element) : buildForEmptyCanvas();

        menuEl.innerHTML = "";
        items.forEach(el => menuEl.appendChild(el));
        menuEl.style.left = `${e.clientX}px`;
        menuEl.style.top = `${e.clientY}px`;
        menuEl.style.display = "block";
    });

    document.addEventListener("click", hide);
    window.addEventListener("blur", hide);
}
