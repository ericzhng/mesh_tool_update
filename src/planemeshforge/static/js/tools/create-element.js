// Click N existing nodes in order to create a line (SFMGAX1, N=2), triangle
// (CGAX3, N=3), or quad (CGAX4, N=4) element, with a live rubber-band
// preview of the in-progress element.
import { store } from "../core/store.js";
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { toast } from "../ui/toast.js";
import { hitNode } from "../core/hit-test.js";

function makeCreateElementTool(id, label, elementType, nodeCount) {
    return {
        id,
        label,
        elementType,
        nodeCount,
        cursor: "crosshair",
        hint: `Click ${nodeCount} nodes to create a ${label.toLowerCase()} · Esc to cancel`,
        _picked: [],
        _hoverWorld: null,

        onActivate() {
            this._picked = [];
        },
        onDeactivate() {
            this._picked = [];
        },

        async onPointerDown(e, world) {
            const node = hitNode(world);
            if (!node) {
                toast.info("Click on an existing node.");
                return;
            }
            if (this._picked.includes(node.id)) return;
            this._picked.push(node.id);
            if (this._picked.length === this.nodeCount) {
                const connectivity = [this._picked];
                this._picked = [];
                const result = await client.op("add_elements", { element_type: this.elementType, connectivity });
                if (!result.ok) toast.error(result.error);
            }
        },

        onPointerMove(e, world) {
            this._hoverWorld = world;
        },

        onKeyDown(e) {
            if (e.key === "Escape") this._picked = [];
        },

        drawOverlay(ctx) {
            if (!this._picked.length) return;
            const pts = this._picked.map(id => store.node(id)).filter(Boolean).map(n => viewport.toScreen(n));
            if (this._hoverWorld) pts.push(viewport.toScreen(this._hoverWorld));
            if (pts.length < 2) return;
            ctx.save();
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
            ctx.restore();
        },
    };
}

export const createLineTool = makeCreateElementTool("create-line", "Line", "SFMGAX1", 2);
export const createTriangleTool = makeCreateElementTool("create-triangle", "Triangle", "CGAX3", 3);
export const createQuadTool = makeCreateElementTool("create-quad", "Quad", "CGAX4", 4);
