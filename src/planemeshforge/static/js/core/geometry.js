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

export function snapToGrid(value, spacing) {
    if (!spacing) return value;
    return Math.round(value / spacing) * spacing;
}
