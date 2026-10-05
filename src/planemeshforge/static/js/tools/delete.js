// Click a node or element to delete it immediately.
import * as client from "../net/client.js";
import { hitNode, hitElement } from "../core/hit-test.js";
import { hover } from "../core/hover.js";
import { toast } from "../ui/toast.js";

// The native "not-allowed" cursor (a circle with a line through it) reads
// as "you can't do that here" - the opposite of what this tool means. A
// small trash-can cursor (reusing the same icon as the Delete button/
// toolbar) says "click to delete" instead. Colors are baked in rather than
// read from CSS vars since a cursor image is rendered outside the page's
// style context.
const DELETE_CURSOR = (() => {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="11" fill="white" stroke="#0003"/>' +
        '<g transform="translate(4,4)" stroke="#e8201b" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 4h10"/><path d="M6 4V2h4v2"/><path d="M4 4l1 10h6l1-10"/>' +
        "</g></svg>";
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, pointer`;
})();

export const deleteTool = {
    id: "delete",
    label: "Delete",
    cursor: DELETE_CURSOR,
    hint: "Click a node or element to delete it",

    onDeactivate() {
        hover.clear();
    },

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

    onPointerMove(e, world) {
        const node = hitNode(world);
        if (node) {
            hover.setNode(node.id);
            return;
        }
        const element = hitElement(world);
        if (element) hover.setElement(element.id);
        else hover.clear();
    },

    drawOverlay() {},
};
