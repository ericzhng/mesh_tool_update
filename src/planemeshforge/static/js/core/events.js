// Tiny synchronous pub/sub bus used to decouple modules: nothing imports
// nothing just to react to a change. Modules only import `bus` plus the
// store/selection they need to read.
class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    on(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        this._listeners.get(event)?.delete(handler);
    }

    emit(event, payload) {
        for (const handler of this._listeners.get(event) || []) {
            handler(payload);
        }
    }
}

export const bus = new EventBus();
