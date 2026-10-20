// Shape-quality overlay state: holds the last-computed per-element metrics
// plus the user's warn/bad limits, and works out which elements are flagged.
// Separate from `selection` because the overlay highlights a whole class of
// elements at once (and should keep showing them while you select/hover
// individual ones for other tools), rather than replacing the selection.
import { bus } from "./events.js";
import * as client from "../net/client.js";

export const QualityLevel = Object.freeze({ OK: "ok", WARN: "warn", BAD: "bad" });

const DEFAULT_LIMITS = {
    skewnessWarn: 0.5,
    skewnessBad: 0.8,
    aspectRatioWarn: 3,
    aspectRatioBad: 5,
};

function levelFor(elem, limits) {
    if (elem.skewness >= limits.skewnessBad || (elem.aspect_ratio != null && elem.aspect_ratio >= limits.aspectRatioBad)) {
        return QualityLevel.BAD;
    }
    if (elem.skewness >= limits.skewnessWarn || (elem.aspect_ratio != null && elem.aspect_ratio >= limits.aspectRatioWarn)) {
        return QualityLevel.WARN;
    }
    return QualityLevel.OK;
}

class QualityOverlay {
    constructor() {
        this.enabled = false;
        this.limits = { ...DEFAULT_LIMITS };
        this.elements = []; // last-computed per-element metrics
        this.summary = {};
        this.levels = new Map(); // elementId -> QualityLevel
        this.byId = new Map(); // elementId -> metrics
    }

    async compute() {
        const result = await client.qualityMetrics();
        if (!result.ok) return result;
        this.elements = result.elements;
        this.summary = result.summary;
        this.byId = new Map(this.elements.map(e => [e.id, e]));
        this._recomputeLevels();
        this._changed();
        return result;
    }

    // Metrics for a single element, or null if not computed (yet).
    metricsFor(elementId) {
        return this.byId.get(elementId) || null;
    }

    setLimits(limits) {
        this.limits = { ...this.limits, ...limits };
        this._recomputeLevels();
        this._changed();
    }

    // Just a display toggle - it doesn't itself trigger a computation.
    // Checking it before metrics exist simply means nothing is highlighted
    // yet, until "Compute Metrics" is run (or re-run on a mesh edit).
    setEnabled(enabled) {
        this.enabled = enabled;
        this._changed();
    }

    // Drops any computed metrics without touching `enabled`/`limits` (user
    // preferences, not mesh-derived data) - used when a whole new mesh
    // replaces the current one (new/open/import), so stale per-element
    // results from the *previous* mesh can't linger in the UI. If the
    // overlay is still enabled, the `mesh:changed` handler below recomputes
    // fresh metrics for the new mesh right after this fires.
    reset() {
        this.elements = [];
        this.summary = {};
        this.levels = new Map();
        this.byId = new Map();
        this._changed();
    }

    levelOf(elementId) {
        if (!this.enabled) return QualityLevel.OK;
        return this.levels.get(elementId) || QualityLevel.OK;
    }

    // With no `level`, returns every non-"ok" (warn + bad) element id.
    flaggedIds(level = null) {
        const ids = [];
        for (const [id, lvl] of this.levels) {
            if (level ? lvl === level : lvl !== QualityLevel.OK) ids.push(id);
        }
        return ids;
    }

    _recomputeLevels() {
        this.levels = new Map(this.elements.map(e => [e.id, levelFor(e, this.limits)]));
    }

    _changed() {
        bus.emit("quality:changed", this);
    }
}

export const qualityOverlay = new QualityOverlay();

// Keep the overlay in sync with live edits: re-run the metrics whenever the
// mesh changes while the overlay is visible, same idea as `selection`'s
// mesh:changed handler. If the overlay is off, just drop the now-possibly-stale
// cached metrics so turning it back on recomputes fresh ones.
bus.on("mesh:changed", () => {
    if (qualityOverlay.enabled) {
        qualityOverlay.compute();
    } else if (qualityOverlay.elements.length) {
        qualityOverlay.reset();
    }
});

// A whole new mesh (new/open/import) makes any already-computed metrics
// meaningless, even if the overlay is enabled - there's nothing to recompute
// from here (that happens via `mesh:changed` once the new mesh actually
// arrives); this just makes sure stale numbers from the old mesh don't
// linger in the meantime.
bus.on("project:reset", () => qualityOverlay.reset());
