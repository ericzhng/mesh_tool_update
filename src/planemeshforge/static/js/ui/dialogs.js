// Generic modal form, used by the Utilities panel for anything that needs
// more than a click (transform amounts, merge tolerance, set names, ...).
// Pass `wide: true` for forms that need more room (e.g. a textarea field
// for editing a long id list) - the default size stays compact so it
// doesn't look oversized for a single short text field.
export function openDialog({ title, fields, submitLabel = "OK", wide = false }) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        backdrop.className = "dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = wide ? "dialog dialog-wide" : "dialog";
        dialog.innerHTML = `<h2>${title}</h2>`;

        const inputs = {};
        for (const field of fields) {
            const row = document.createElement("div");
            row.className = field.type === "textarea" ? "field-row field-row-textarea" : "field-row";
            const label = document.createElement("label");
            label.textContent = field.label;
            row.appendChild(label);

            let input;
            if (field.type === "select") {
                input = document.createElement("select");
                for (const opt of field.options) {
                    const optionEl = document.createElement("option");
                    optionEl.value = opt.value;
                    optionEl.textContent = opt.label;
                    input.appendChild(optionEl);
                }
            } else if (field.type === "textarea") {
                input = document.createElement("textarea");
                input.rows = field.rows || 8;
            } else {
                input = document.createElement("input");
                input.type = field.type || "text";
                if (field.step !== undefined) input.step = field.step;
            }
            input.value = field.default ?? "";
            row.appendChild(input);
            dialog.appendChild(row);
            inputs[field.name] = input;
        }

        const btnRow = document.createElement("div");
        btnRow.className = "btn-row";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn";
        cancelBtn.textContent = "Cancel";
        const submitBtn = document.createElement("button");
        submitBtn.className = "btn btn-primary";
        submitBtn.textContent = submitLabel;
        btnRow.append(cancelBtn, submitBtn);
        dialog.appendChild(btnRow);

        function close(result) {
            backdrop.remove();
            resolve(result);
        }

        cancelBtn.addEventListener("click", () => close(null));
        backdrop.addEventListener("click", e => {
            if (e.target === backdrop) close(null);
        });
        submitBtn.addEventListener("click", () => {
            const values = {};
            for (const field of fields) {
                const raw = inputs[field.name].value;
                values[field.name] = field.type === "number" ? parseFloat(raw) : raw;
            }
            close(values);
        });
        dialog.addEventListener("keydown", e => {
            // In a textarea, Enter has to stay a newline (that's the whole
            // point of giving a field multiple rows) - submit on Ctrl/Cmd+
            // Enter there instead, same convention as chat/comment boxes.
            const inTextarea = e.target.tagName === "TEXTAREA";
            if (e.key === "Enter" && (!inTextarea || e.ctrlKey || e.metaKey)) submitBtn.click();
            if (e.key === "Escape") close(null);
        });

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        inputs[fields[0]?.name]?.focus();
    });
}
