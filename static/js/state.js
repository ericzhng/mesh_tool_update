let mesh = { nodes: [], connections: [] };
let nodesMap = new Map();
let spatialGrid = null;
let appState = {
    meshLoaded: false,
    meshDisplayed: false,
};

let view = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
let drawPending = false;
const rulerSize = 30;
const lod = {
    nodeThreshold: 0.8, // view.scale threshold to draw nodes as simple points
    labelThreshold: 12, // view.scale threshold to draw labels
};

let selectedNode = null;
let draggingNode = null;
let dragOffset = { x: 0, y: 0 };
let isPanning = false;
let isZooming = false;
let panStart = { x: 0, y: 0 };
let zoomStart = { y: 0, scale: 1, mouseX: 0, mouseY: 0 };
let isSelecting = false;
let selectStart = null;
let selectRect = null;
