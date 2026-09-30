// Socket.IO wrapper: every mesh mutation goes through `op(name, args)`,
// which resolves/rejects based on the server's ack. The server is the only
// place that mutates mesh data; this module never touches `store` directly
// except to apply the broadcasted state.
import { bus } from "../core/events.js";
import { store } from "../core/store.js";

const socket = io();

socket.on("mesh_state", state => {
    store.applyState(state);
});

socket.on("connect", () => bus.emit("connection:changed", { connected: true }));
socket.on("disconnect", () => bus.emit("connection:changed", { connected: false }));

function ack(eventName, payload = {}) {
    return new Promise(resolve => {
        socket.emit(eventName, payload, response => resolve(response || { ok: false, error: "No response from server." }));
    });
}

export function op(name, args = {}) {
    return ack("op", { op: name, args });
}

export function undo() {
    return ack("undo");
}

export function redo() {
    return ack("redo");
}

export function getMesh() {
    socket.emit("get_mesh");
}

export function loadMesh(meshDict) {
    return ack("load_mesh", { mesh: meshDict });
}

export function qualityCheck() {
    return ack("quality_check");
}
