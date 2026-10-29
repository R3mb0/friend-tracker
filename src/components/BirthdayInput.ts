import { formatYearlessBirthday, parseBirthday } from "@/utils/date";

export interface BirthdayInput {
	/** "YYYY-MM-DD", "--MM-DD" (year unknown) or "" */
	getValue(): string;
}

/**
 * Birthday input with a "Year unknown" option. With the option checked,
 * month and day are picked from dropdowns and stored as "--MM-DD".
 */
export function createBirthdayInput(
	container: HTMLElement,
	value: string,
	options: {
		inputCls: string;
		onChange?: (value: string) => void;
	}
): BirthdayInput {
	const parts = parseBirthday(value);
	const wrapper = container.createDiv({
		cls: "friend-tracker-birthday-input",
	});

	// Full date
	const dateInput = wrapper.createEl("input", {
		cls: options.inputCls,
		attr: {
			type: "date",
			value: parts && parts.year !== null ? value : "",
			"aria-label": "Birthday",
		},
	});

	// Day and month only
	const yearless = wrapper.createDiv({
		cls: "friend-tracker-birthday-yearless",
	});
	const daySelect = yearless.createEl("select", {
		cls: "dropdown",
		attr: { "aria-label": "Day" },
	});
	daySelect.createEl("option", { text: "Day", value: "" });
	for (let day = 1; day <= 31; day++) {
		daySelect.createEl("option", { text: String(day), value: String(day) });
	}
	const monthSelect = yearless.createEl("select", {
		cls: "dropdown",
		attr: { "aria-label": "Month" },
	});
	monthSelect.createEl("option", { text: "Month", value: "" });
	for (let month = 1; month <= 12; month++) {
		monthSelect.createEl("option", {
			text: new Date(2000, month - 1, 1).toLocaleDateString(undefined, {
				month: "long",
			}),
			value: String(month),
		});
	}
	if (parts) {
		daySelect.value = String(parts.day);
		monthSelect.value = String(parts.month);
	}

	const toggleLabel = wrapper.createEl("label", {
		cls: "friend-tracker-birthday-toggle",
	});
	const yearUnknown = toggleLabel.createEl("input", {
		attr: { type: "checkbox" },
	});
	yearUnknown.checked = !!parts && parts.year === null;
	toggleLabel.appendText(" Year unknown");

	const getValue = (): string => {
		if (!yearUnknown.checked) return dateInput.value;
		const month = Number(monthSelect.value);
		const day = Number(daySelect.value);
		if (!month || !day) return "";
		const yearlessValue = formatYearlessBirthday(month, day);
		// e.g. April 31 doesn't exist
		return parseBirthday(yearlessValue) ? yearlessValue : "";
	};

	const updateVisibility = () => {
		dateInput.toggle(!yearUnknown.checked);
		yearless.toggle(yearUnknown.checked);
	};
	updateVisibility();

	const emit = () => {
		const newValue = getValue();
		// Don't overwrite a stored birthday while day/month are incomplete
		const incomplete = !newValue && (daySelect.value || monthSelect.value);
		if (yearUnknown.checked && incomplete) return;
		options.onChange?.(newValue);
	};

	dateInput.addEventListener("change", emit);
	daySelect.addEventListener("change", emit);
	monthSelect.addEventListener("change", emit);

	yearUnknown.addEventListener("change", () => {
		if (yearUnknown.checked) {
			// Keep day and month of an entered date
			const full = parseBirthday(dateInput.value);
			if (full) {
				daySelect.value = String(full.day);
				monthSelect.value = String(full.month);
			}
			updateVisibility();
			emit();
		} else {
			// The year has to be entered before anything is saved
			updateVisibility();
			if (dateInput.value) emit();
			else dateInput.focus();
		}
	});

	return { getValue };
}
