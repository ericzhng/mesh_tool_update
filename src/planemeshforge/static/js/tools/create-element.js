// Click N existing nodes in order to create a line (SFMGAX1, N=2) element,
// or use createElementTool to build a triangle/quad: click 3-4 nodes, with
// the 4th click committing a quad immediately and a triangle committed by
// Enter, right-click, or re-clicking the first node. Both tools show a
// live rubber-band preview of the in-progress element.
import { store } from "../core/store.js";
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { toast } from "../ui/toast.js";
import { hitNode } from "../core/hit-test.js";
import { hover } from "../core/hover.js";
import { createElementFromNodes } from "../core/element-builder.js";

function makeCreateElementTool(id, label, elementType, nodeCount) {
    return {
        id,
        label,
        elementType,
        nodeCount,
        cursor: "crosshair",
        hint: `Click ${nodeCount} nodes to create a ${label.toLowerCase()} · Esc to cancel`,
        // Every node is a potential pick target, so nodes stay visible for
        // the whole lifetime of this tool rather than only on hover.
        showsAllNodes: true,
        _picked: [],
        _hoverWorld: null,

        onActivate() {
            this._picked = [];
        },
        onDeactivate() {
            this._picked = [];
            hover.clear();
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
            const node = hitNode(world);
            if (node) hover.setNode(node.id);
            else hover.clear();
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

export const createElementTool = {
    id: "create-element",
    label: "Create Element",
    cursor: "crosshair",
    hint: "Click 3-4 nodes · 4th click makes a quad · Enter/right-click/first node finishes a triangle · Backspace undo · Esc cancel",
    showsAllNodes: true,
    _picked: [],
    _hoverWorld: null,

    onActivate() {
        this._picked = [];
    },
    onDeactivate() {
        this._picked = [];
        hover.clear();
    },

    async _commit() {
        const nodeIds = this._picked;
        this._picked = [];
        if (nodeIds.length < 3) return;
        await createElementFromNodes(nodeIds, { ordered: true });
    },

    async onPointerDown(e, world) {
        // Right click (button 2) closes a 3-node triangle without adding a
        // 4th node; left click (button 0) is the normal pick/close gesture.
        if (e.button === 2) {
            await this._commit();
            return;
        }
        if (e.button !== 0) return;

        const node = hitNode(world);
        if (!node) {
            toast.info("Click on an existing node.");
            return;
        }
        if (this._picked.length >= 3 && node.id === this._picked[0]) {
            await this._commit();
            return;
        }
        if (this._picked.includes(node.id)) return;
        this._picked.push(node.id);
        if (this._picked.length === 4) await this._commit();
    },

    onPointerMove(e, world) {
        this._hoverWorld = world;
        const node = hitNode(world);
        if (node) hover.setNode(node.id);
        else hover.clear();
    },

    async onKeyDown(e) {
        if (e.key === "Escape") {
            this._picked = [];
        } else if (e.key === "Backspace") {
            // Backspace is also the global "delete selected" shortcut; stop
            // it from also deleting a leftover node/element selection while
            // this tool is just popping the last pick.
            if (this._picked.length) e.preventDefault();
            this._picked.pop();
        } else if (e.key === "Enter") {
            await this._commit();
        }
    },

    drawOverlay(ctx) {
        if (!this._picked.length) return;
        const screenPts = this._picked.map(id => store.node(id)).filter(Boolean).map(n => viewport.toScreen(n));
        const pts = [...screenPts];
        if (this._hoverWorld) pts.push(viewport.toScreen(this._hoverWorld));
        ctx.save();
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
        // Once a triangle is possible, highlight the first-picked node so
        // the "click it again to close the loop" gesture is discoverable.
        if (screenPts.length >= 3) {
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(screenPts[0].x, screenPts[0].y, 6, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    },
};
