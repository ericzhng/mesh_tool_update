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

    async setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled && this.elements.length === 0) await this.compute();
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
        qualityOverlay.elements = [];
        qualityOverlay.summary = {};
        qualityOverlay.levels = new Map();
        qualityOverlay.byId = new Map();
    }
});
