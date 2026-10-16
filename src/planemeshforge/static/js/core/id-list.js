// Parsing/formatting for the set editor's id-list textarea. Two id "shapes"
// are supported:
//   - plain ids, for node/element sets: "1, 2 3\n4", "10-14", "10-20:2"
//     (Abaqus *NSET/*ELSET generate-style range with a step).
//   - element:face pairs, for surface sets: "12:S1, 40:S3" (1-based Abaqus
//     face label) or the legacy bare "12:3" (0-based face index).
// Both directions (parse text -> ids, format ids -> text) live here so the
// editor and the renderer-facing highlight code share one notion of what a
// token means instead of drifting apart.

const RANGE_RE = /^(-?\d+)-(-?\d+)(?::(\d+))?$/;
const FACE_RE = /^(-?\d+):[Ss]?(\d+)$/;

function tokenize(text) {
    return (text || "")
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

// "1, 2 3\n4-6" -> [1, 2, 3, 4, 5, 6]. Unparsable tokens are reported back
// in `invalid` rather than silently dropped, so the editor can warn.
export function parseIdList(text) {
    const ids = new Set();
    const invalid = [];
    for (const token of tokenize(text)) {
        const range = token.match(RANGE_RE);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            const step = range[3] ? Number(range[3]) : 1;
            if (step > 0 && Number.isInteger(start) && Number.isInteger(end)) {
                for (let v = start; v <= end; v += step) ids.add(v);
                continue;
            }
        }
        const n = Number(token);
        if (Number.isInteger(n)) {
            ids.add(n);
            continue;
        }
        invalid.push(token);
    }
    return { ids: [...ids], invalid };
}

// "12:S1, 40:3" -> [[12, 0], [40, 3]] (0-based face index), accepting both
// the 1-based "Sn" label (what's shown/round-tripped) and a bare number
// (legacy 0-based index, still read for compatibility with pasted text).
export function parseFaceList(text) {
    const faces = [];
    const invalid = [];
    for (const token of tokenize(text)) {
        const match = token.match(FACE_RE);
        if (!match) {
            invalid.push(token);
            continue;
        }
        const elementId = Number(match[1]);
        const label = Number(match[2]);
        const faceIndex = token.includes("S") || token.includes("s") ? label - 1 : label;
        if (!Number.isInteger(elementId) || !Number.isInteger(faceIndex) || faceIndex < 0) {
            invalid.push(token);
            continue;
        }
        faces.push([elementId, faceIndex]);
    }
    return { faces, invalid };
}

// [1, 2, 3, 5, 7, 8, 9] -> "1-3, 5, 7-9" - compresses consecutive runs so a
// large contiguous set doesn't fill the textarea with one id per line.
export function formatIdList(ids) {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const parts = [];
    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
        parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
        i = j + 1;
    }
    return parts.join(", ");
}

// [[12, 0], [40, 2]] -> "12:S1, 40:S3" (0-based index back to the 1-based
// Abaqus label).
export function formatFaceList(faces) {
    return [...faces]
        .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
        .map(([elementId, faceIndex]) => `${elementId}:S${faceIndex + 1}`)
        .join(", ");
}
