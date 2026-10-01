// Keyboard shortcuts -> command ids. Ignored while typing into a form field
// (except Escape) so dialogs and the inspector stay usable.
import { run } from "../commands/registry.js";

const BINDINGS = [
    { keys: "ctrl+z", command: "edit.undo" },
    { keys: "ctrl+y", command: "edit.redo" },
    { keys: "ctrl+shift+z", command: "edit.redo" },
    { keys: "ctrl+s", command: "file.save" },
    { keys: "ctrl+shift+s", command: "file.saveAs" },
    { keys: "ctrl+o", command: "file.open" },
    { keys: "ctrl+a", command: "edit.selectAll" },
    { keys: "delete", command: "edit.deleteSelected" },
    { keys: "backspace", command: "edit.deleteSelected" },
    { keys: "v", command: "tool.select" },
    { keys: "s", command: "tool.selectSurface" },
    { keys: "n", command: "tool.addNode" },
    { keys: "l", command: "tool.createLine" },
    { keys: "t", command: "tool.createTriangle" },
    { keys: "q", command: "tool.createQuad" },
    { keys: "d", command: "tool.delete" },
    { keys: "f", command: "view.fit" },
    { keys: "g", command: "view.toggleSnap" },
    { keys: "r", command: "view.rotateCW" },
    { keys: "shift+r", command: "view.rotateCCW" },
    { keys: "+", command: "view.zoomIn" },
    { keys: "=", command: "view.zoomIn" },
    { keys: "-", command: "view.zoomOut" },
];

function comboFor(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push("ctrl");
    if (e.shiftKey) parts.push("shift");
    parts.push(e.key.toLowerCase());
    return parts.join("+");
}

function isTypingTarget(el) {
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function installShortcuts() {
    window.addEventListener("keydown", e => {
        if (isTypingTarget(e.target) && e.key !== "Escape") return;
        const combo = comboFor(e);
        const binding = BINDINGS.find(b => b.keys === combo);
        if (binding) {
            e.preventDefault();
            run(binding.command);
        }
    });
}
