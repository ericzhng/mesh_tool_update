// One shared icon set (inline SVG paths, stroke-based) so every menu,
// toolbar button, and context-menu item draws from the same source instead
// of hand-rolled inline SVG scattered through the HTML.
const PATHS = {
    "new": '<path d="M6 2h6l3 3v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M12 2v3h3"/>',
    "open": '<path d="M2 5a1 1 0 0 1 1-1h3l1.5 2H14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z"/>',
    "save": '<path d="M3 2h9l2 2v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5 2v4h6V2"/><path d="M5 10h6v4H5z"/>',
    "import": '<path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M3 13h10"/>',
    "export": '<path d="M8 10V2"/><path d="M5 5l3-3 3 3"/><path d="M3 13h10"/>',
    "trash": '<path d="M3 4h10"/><path d="M6 4V2h4v2"/><path d="M4 4l1 10h6l1-10"/>',
    "undo": '<path d="M3 8a5 5 0 1 1 1.6 3.7"/><path d="M3 8V4"/><path d="M3 8h4"/>',
    "redo": '<path d="M13 8a5 5 0 1 0-1.6 3.7"/><path d="M13 8V4"/><path d="M13 8H9"/>',
    "select": '<path d="M3 3l4.5 10 1.5-4 4-1.5z"/>',
    "add-node": '<circle cx="8" cy="8" r="2.5"/><path d="M8 1v3"/><path d="M8 12v3"/><path d="M1 8h3"/><path d="M12 8h3"/>',
    "line": '<path d="M3 13L13 3"/><circle cx="3" cy="13" r="1.4"/><circle cx="13" cy="3" r="1.4"/>',
    "triangle": '<path d="M8 3l5 10H3z"/>',
    "quad": '<rect x="3" y="3" width="10" height="10"/>',
    "delete-tool": '<path d="M3 3l10 10"/><path d="M13 3L3 13"/>',
    "zoom-in": '<circle cx="7" cy="7" r="4.5"/><path d="M14 14l-3-3"/><path d="M7 5v4"/><path d="M5 7h4"/>',
    "zoom-out": '<circle cx="7" cy="7" r="4.5"/><path d="M14 14l-3-3"/><path d="M5 7h4"/>',
    "fit": '<path d="M2 6V2h4"/><path d="M10 2h4v4"/><path d="M14 10v4h-4"/><path d="M6 14H2v-4"/>',
    "rotate-cw": '<polyline points="15.33 2.67 15.33 6.67 11.33 6.67"/><path d="M13.66 10a6 6 0 1 1-1.41-6.24L15.33 6.67"/>',
    "rotate-ccw": '<polyline points="0.67 2.67 0.67 6.67 4.67 6.67"/><path d="M2.34 10a6 6 0 1 0 1.42-6.24L0.67 6.67"/>',
    "grid": '<path d="M2 5.5h12"/><path d="M2 10.5h12"/><path d="M5.5 2v12"/><path d="M10.5 2v12"/>',
    "eye": '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>',
    "eye-off": '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><path d="M2 2l12 12"/>',
    "isolate": '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.6"/>',
    "plus": '<path d="M8 3v10"/><path d="M3 8h10"/>',
    "rename": '<path d="M3 12.5l1-3L11 2.5l2 2L6 12l-3 1z"/>',
    "check-list": '<path d="M3 4h1l1 1 2-2"/><path d="M8 4h5"/><path d="M3 9h1l1 1 2-2"/><path d="M8 9h5"/>',
    "chevron-down": '<path d="M4 6l4 4 4-4"/>',
    "transform": '<path d="M3 3h6v6H3z"/><path d="M7 9l6 4"/><circle cx="13" cy="13" r="1.5"/>',
    "merge": '<circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M6 4h4a2 2 0 0 1 2 2v4"/>',
    "sun": '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5 13 13M13 3l-1.5 1.5M4.5 11.5 3 13"/>',
    "moon": '<path d="M13 8.5A5.5 5.5 0 1 1 7.5 3 4.5 4.5 0 0 0 13 8.5z"/>',
    "close": '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/>',
};

export function icon(name, extraClass = "") {
    const inner = PATHS[name] || "";
    return `<svg class="icon ${extraClass}" viewBox="0 0 16 16">${inner}</svg>`;
}
