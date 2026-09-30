// A single source of truth for actions: {id, label, icon, shortcut, run,
// isEnabled}. The menubar, toolbar, context menu, and keyboard shortcuts all
// read from here instead of each hand-wiring its own handler, so there is
// exactly one place that defines what "Undo" does and when it's allowed.
import { bus } from "../core/events.js";

const commands = new Map();

export function define(command) {
    commands.set(command.id, command);
}

export function get(id) {
    return commands.get(id);
}

export function isEnabled(id) {
    const cmd = commands.get(id);
    if (!cmd) return false;
    return cmd.isEnabled ? !!cmd.isEnabled() : true;
}

export async function run(id) {
    const cmd = commands.get(id);
    if (!cmd || !isEnabled(id)) return;
    await cmd.run();
    bus.emit("command:ran", id);
}

export function shortcutLabel(id) {
    return commands.get(id)?.shortcut || "";
}
