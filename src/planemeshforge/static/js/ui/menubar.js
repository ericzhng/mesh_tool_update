// Builds the File/Edit/Select/View dropdown menus from the command
// registry, so a command's enabled/checked state is computed in one place
// and reflected consistently everywhere it appears.
import { bus } from "../core/events.js";
import { get, isEnabled, run } from "../commands/registry.js";
import { icon } from "./icons.js";

const MENUS = [
    { label: "File", items: ["file.new", "file.open", "file.save", "file.saveAs", "-", "file.import", "file.export", "-", "file.clear"] },
    { label: "Edit", items: ["edit.undo", "edit.redo", "-", "edit.selectAll", "edit.deleteSelected"] },
    { label: "View", items: ["view.fit", "view.zoomIn", "view.zoomOut", "-", "view.toggleNodeLabels", "view.toggleElementLabels", "-", "view.toggleSnap", "view.rotateCW", "view.rotateCCW", "-", "view.toggleTheme"] },
];

function renderMenuItem(itemId) {
    if (itemId === "-") {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        return sep;
    }
    const cmd = get(itemId);
    if (!cmd) return document.createComment(itemId);

    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.disabled = !isEnabled(itemId);
    const checked = cmd.isChecked ? cmd.isChecked() : null;
    btn.innerHTML = `${cmd.icon ? icon(cmd.icon) : checked !== null ? `<span style="width:16px">${checked ? "&#10003;" : ""}</span>` : ""}<span>${cmd.label}</span><span class="spacer"></span>${cmd.shortcut ? `<span class="shortcut">${cmd.shortcut}</span>` : ""}`;
    btn.addEventListener("click", async () => {
        closeAll();
        await run(itemId);
    });
    return btn;
}

let menuEls = [];

function closeAll() {
    menuEls.forEach(el => el.classList.remove("open"));
}

export function buildMenubar(container) {
    menuEls = MENUS.map(menu => {
        const wrapper = document.createElement("div");
        wrapper.className = "menu";

        const button = document.createElement("button");
        button.className = "menu-button";
        button.textContent = menu.label;
        button.addEventListener("click", e => {
            e.stopPropagation();
            const wasOpen = wrapper.classList.contains("open");
            closeAll();
            if (!wasOpen) {
                renderDropdown(wrapper, menu);
                wrapper.classList.add("open");
            }
        });

        const dropdown = document.createElement("div");
        dropdown.className = "menu-dropdown";

        wrapper.appendChild(button);
        wrapper.appendChild(dropdown);
        container.appendChild(wrapper);
        return wrapper;
    });

    document.addEventListener("click", closeAll);
    bus.on("mesh:changed", refreshOpenMenu);
    bus.on("selection:changed", refreshOpenMenu);
}

function renderDropdown(wrapper, menu) {
    const dropdown = wrapper.querySelector(".menu-dropdown");
    dropdown.innerHTML = "";
    menu.items.forEach(itemId => dropdown.appendChild(renderMenuItem(itemId)));
}

function refreshOpenMenu() {
    menuEls.forEach((wrapper, i) => {
        if (wrapper.classList.contains("open")) renderDropdown(wrapper, MENUS[i]);
    });
}
