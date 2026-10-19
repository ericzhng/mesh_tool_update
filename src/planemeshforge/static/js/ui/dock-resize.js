// Drag-to-resize for the right dock panel - a vertical handle along its
// left edge trades width with the canvas, clamped to a sane range and
// persisted across reloads (same idea as the dark-mode toggle's
// localStorage flag in main.js).
const STORAGE_KEY = "pmf-dock-width";
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

function clamp(width) {
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

// `onResize` is called after every width change (initial restore, each
// drag step, and on release) so the caller can re-run `viewport.resize()` -
// the canvas only tracks its own parent's size on a window "resize" event,
// which dragging this handle never fires.
export function installDockResize(dockEl, handleEl, onResize) {
    const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
    const initial = clamp(Number.isFinite(saved) ? saved : dockEl.getBoundingClientRect().width);
    dockEl.style.width = `${initial}px`;
    onResize?.();

    let startX = 0;
    let startWidth = 0;

    function onPointerMove(e) {
        // The handle sits on the dock's left edge, so dragging left
        // (negative dx) grows the dock - width tracks the inverse of the
        // pointer's horizontal movement.
        dockEl.style.width = `${clamp(startWidth - (e.clientX - startX))}px`;
        onResize?.();
    }

    function onPointerUp() {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        handleEl.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem(STORAGE_KEY, parseFloat(dockEl.style.width));
    }

    handleEl.addEventListener("pointerdown", e => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = dockEl.getBoundingClientRect().width;
        handleEl.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    });
}
