// Small transient notifications, stacked bottom-right (kept away from the
// status bar so the two never overlap).
const stack = document.getElementById("toast-stack");

function show(message, kind = "info", timeout = 3500) {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), timeout);
}

export const toast = {
    info: message => show(message, "info"),
    success: message => show(message, "success"),
    error: message => show(message, "error", 6000),
};
