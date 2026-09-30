// The right-hand dock: tab bar plus the three panel containers. Each panel
// builds itself once and reacts to bus events from then on.
import { buildInspectorPanel } from "./panels/inspector.js";
import { buildSetsPanel } from "./panels/sets.js";
import { buildUtilitiesPanel } from "./panels/utilities.js";

const TABS = [
    { id: "inspector", label: "Inspector", build: buildInspectorPanel },
    { id: "sets", label: "Sets", build: buildSetsPanel },
    { id: "utilities", label: "Utilities", build: buildUtilitiesPanel },
];

export function buildDock(root) {
    const tabsEl = document.createElement("div");
    tabsEl.className = "dock-tabs";
    root.appendChild(tabsEl);

    const panelEls = {};
    TABS.forEach((tab, i) => {
        const tabBtn = document.createElement("button");
        tabBtn.className = `dock-tab${i === 0 ? " active" : ""}`;
        tabBtn.textContent = tab.label;
        tabBtn.addEventListener("click", () => activate(tab.id));
        tabsEl.appendChild(tabBtn);
        tab._button = tabBtn;

        const panel = document.createElement("div");
        panel.className = `dock-panel${i === 0 ? " active" : ""}`;
        root.appendChild(panel);
        panelEls[tab.id] = panel;
        tab.build(panel);
    });

    function activate(id) {
        TABS.forEach(tab => {
            tab._button.classList.toggle("active", tab.id === id);
            panelEls[tab.id].classList.toggle("active", tab.id === id);
        });
    }
}
