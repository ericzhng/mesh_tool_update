// Click a node or element to delete it immediately.
import * as client from "../net/client.js";
import { hitNode, hitElement } from "../core/hit-test.js";
import { toast } from "../ui/toast.js";

export const deleteTool = {
    id: "delete",
    label: "Delete",
    cursor: "not-allowed",
    hint: "Click a node or element to delete it",

    async onPointerDown(e, world) {
        const node = hitNode(world);
        if (node) {
            const result = await client.op("delete_nodes", { ids: [node.id] });
            if (!result.ok) toast.error(result.error);
            return;
        }
        const element = hitElement(world);
        if (element) {
            const result = await client.op("delete_elements", { ids: [element.id] });
            if (!result.ok) toast.error(result.error);
        }
    },

    drawOverlay() {},
};
