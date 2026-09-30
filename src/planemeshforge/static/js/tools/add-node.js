// Click on the canvas to add a node there (snapped to the grid if enabled).
import { viewport } from "../render/viewport.js";
import * as client from "../net/client.js";
import { toast } from "../ui/toast.js";

export const addNodeTool = {
    id: "add-node",
    label: "Add node",
    cursor: "crosshair",
    hint: "Click to place a node",

    async onPointerDown(e, world) {
        const p = viewport.snapPoint(world);
        const result = await client.op("add_nodes", { nodes: [{ x: p.x, y: p.y }] });
        if (!result.ok) toast.error(result.error);
    },

    drawOverlay() {},
};
