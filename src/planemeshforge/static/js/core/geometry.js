// Pure geometry helpers shared by rendering, hit-testing, and tools. No DOM,
// no state - everything here is a function of its arguments.

export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return distance(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersects =
            yi > point.y !== yj > point.y &&
            point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

export function signedArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
}

export function centroid(points) {
    const n = points.length;
    return {
        x: points.reduce((s, p) => s + p.x, 0) / n,
        y: points.reduce((s, p) => s + p.y, 0) / n,
    };
}

export function boundingBox(points) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// Orders points by angle around their centroid, which turns an unordered
// set of convex-polygon vertices into a simple (non-self-intersecting)
// loop. Doesn't help with concave point sets - callers should check
// isConvex() first if that matters.
export function sortByAngle(points) {
    const c = centroid(points);
    return [...points].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
}

function segmentsIntersect(a, b, c, d) {
    const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// True if the polygon's edges don't cross each other - i.e. it isn't a
// "bowtie". Only non-adjacent edges can cross without sharing an endpoint,
// so adjacent pairs are skipped.
export function isSimplePolygon(points) {
    const n = points.length;
    if (n < 4) return true;
    for (let i = 0; i < n; i++) {
        const a = points[i], b = points[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
            const c = points[j], d = points[(j + 1) % n];
            if (segmentsIntersect(a, b, c, d)) return false;
        }
    }
    return true;
}

// True if every interior angle turns the same way, i.e. the polygon has no
// reflex vertex. Assumes a simple (non-self-intersecting) polygon.
export function isConvex(points) {
    const n = points.length;
    if (n < 4) return true;
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i], b = points[(i + 1) % n], c = points[(i + 2) % n];
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cross === 0) continue;
        const s = Math.sign(cross);
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
    }
    return true;
}

export function snapToGrid(value, spacing) {
    if (!spacing) return value;
    return Math.round(value / spacing) * spacing;
}
