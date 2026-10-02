// Hover tooltip: shows skewness/aspect ratio for whatever element the
// cursor is currently over (Utilities > Mesh Metrics computes these for the
// whole mesh; hovering lazily triggers that computation if it hasn't run
// yet, so the tooltip works without an extra click).
import { bus } from "../core/events.js";
import { hover } from "../core/hover.js";
import { qualityOverlay } from "../core/quality-overlay.js";

function fmt(n) {
    return n == null ? "–" : n.toFixed(3);
}

export function installQualityTooltip(canvas, tooltipEl) {
    let computing = false;

    function ensureMetrics() {
        if (computing || qualityOverlay.elements.length) return;
        computing = true;
        qualityOverlay.compute().finally(() => (computing = false));
    }

    function render() {
        const elementId = hover.elementId;
        if (elementId == null) {
            tooltipEl.style.display = "none";
            return;
        }

        const metrics = qualityOverlay.metricsFor(elementId);
        if (!metrics) {
            ensureMetrics();
            tooltipEl.style.display = "none";
            return;
        }

        const limits = qualityOverlay.limits;
        const skewClass = metrics.skewness >= limits.skewnessBad ? "flagged bad" : metrics.skewness >= limits.skewnessWarn ? "flagged" : "";
        const aspectOver = metrics.aspect_ratio != null && metrics.aspect_ratio >= limits.aspectRatioWarn;
        const aspectBad = metrics.aspect_ratio != null && metrics.aspect_ratio >= limits.aspectRatioBad;
        const aspectClass = aspectBad ? "flagged bad" : aspectOver ? "flagged" : "";

        tooltipEl.innerHTML = `
            <div class="quality-tooltip-row"><span>#${elementId} ${metrics.type}</span></div>
            <div class="quality-tooltip-row"><span>Skew</span><strong class="${skewClass}">${fmt(metrics.skewness)}</strong></div>
            <div class="quality-tooltip-row"><span>Aspect</span><strong class="${aspectClass}">${fmt(metrics.aspect_ratio)}</strong></div>
        `;
        tooltipEl.style.display = "block";
    }

    canvas.addEventListener("pointermove", e => {
        const rect = canvas.getBoundingClientRect();
        tooltipEl.style.left = `${e.clientX - rect.left + 16}px`;
        tooltipEl.style.top = `${e.clientY - rect.top + 16}px`;
        render();
    });
    canvas.addEventListener("pointerleave", () => {
        tooltipEl.style.display = "none";
    });

    // Metrics may finish computing (or the limits may change) while the
    // cursor is still sitting over the same element - refresh in place.
    bus.on("quality:changed", render);

    // Switching tools clears hover without necessarily moving the pointer
    // (e.g. picking a new tool from the rail), which would otherwise leave
    // a stale tooltip showing.
    bus.on("tool:changed", () => (tooltipEl.style.display = "none"));
}
