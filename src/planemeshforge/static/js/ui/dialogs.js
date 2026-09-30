// Generic modal form, used by the Utilities panel for anything that needs
// more than a click (transform amounts, merge tolerance, set names, ...).
export function openDialog({ title, fields, submitLabel = "OK" }) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        backdrop.className = "dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = "dialog";
        dialog.innerHTML = `<h2>${title}</h2>`;

        const inputs = {};
        for (const field of fields) {
            const row = document.createElement("div");
            row.className = "field-row";
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
            if (e.key === "Enter") submitBtn.click();
            if (e.key === "Escape") close(null);
        });

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        inputs[fields[0]?.name]?.focus();
    });
}
