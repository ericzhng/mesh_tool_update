// A CAD-style scale bar pinned to the canvas, showing the real-world size
// of one grid square. Reuses viewport.gridStep() - the exact step the grid
// lines themselves are drawn at (render/renderer.js's drawGrid) - rather
// than running its own "nice number" rounding, so the bar can never
// disagree with what's actually on screen.
import { bus } from "../core/events.js";
import { viewport } from "../render/viewport.js";

function formatWorld(n) {
    // Grid steps are always gridSpacing times a power of two, so this is
    // rarely more than a couple of decimal digits - just enough to avoid
    // noisy binary-fraction tails like 0.0624999999.
    const rounded = Math.round(n * 1e6) / 1e6;
    return String(rounded);
}

export function buildScaleBar(container) {
    container.innerHTML = `
        <div class="scale-bar-row">
            <div class="scale-bar-track"></div>
            <span class="scale-bar-value"></span>
        </div>
        <span class="scale-bar-caption">grid spacing</span>
    `;
    const track = container.querySelector(".scale-bar-track");
    const valueEl = container.querySelector(".scale-bar-value");

    function refresh() {
        const { world, pixels } = viewport.gridStep();
        track.style.width = `${Math.round(pixels)}px`;
        valueEl.textContent = formatWorld(world);
    }

    bus.on("viewport:changed", refresh);
    refresh();
}
