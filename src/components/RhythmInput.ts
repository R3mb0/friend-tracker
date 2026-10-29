import { App, Modal } from "obsidian";
import { pluralize } from "@/utils/date";

// Common rhythms; any other number of days can be entered as "Custom"
export const RHYTHM_PRESETS: Array<{ days: number; label: string }> = [
	{ days: 7, label: "Every week" },
	{ days: 14, label: "Every 2 weeks" },
	{ days: 30, label: "Every month" },
	{ days: 90, label: "Every 3 months" },
	{ days: 182, label: "Every 6 months" },
	{ days: 365, label: "Every year" },
];

/** "Every month", or "Every 45 days" for custom values */
export function formatRhythm(days: number): string {
	return (
		RHYTHM_PRESETS.find((preset) => preset.days === days)?.label ??
		`Every ${pluralize(days, "day")}`
	);
}

export interface RhythmInput {
	/** Days, or null for "no goal"; undefined while a custom value is invalid */
	getValue(): number | null | undefined;
}

/**
 * Dropdown with "No goal", the presets and "Custom", plus a number field
 * for custom values
 */
export function createRhythmInput(
	container: HTMLElement,
	value: number | null,
	onChange?: (days: number | null) => void
): RhythmInput {
	const wrapper = container.createDiv({ cls: "friend-tracker-rhythm-input" });

	const select = wrapper.createEl("select", {
		cls: "dropdown",
		attr: { "aria-label": "Contact rhythm" },
	});
	select.createEl("option", { text: "No goal", value: "" });
	for (const preset of RHYTHM_PRESETS) {
		select.createEl("option", {
			text: preset.label,
			value: String(preset.days),
		});
	}
	select.createEl("option", { text: "Custom…", value: "custom" });

	const customWrapper = wrapper.createDiv({
		cls: "friend-tracker-rhythm-custom",
	});
	customWrapper.appendText("Every ");
	const customInput = customWrapper.createEl("input", {
		attr: { type: "number", min: "1", "aria-label": "Days" },
	});
	customWrapper.appendText(" days");

	const isPreset =
		value !== null && RHYTHM_PRESETS.some((preset) => preset.days === value);
	select.value = value === null ? "" : isPreset ? String(value) : "custom";
	if (value !== null) customInput.value = String(value);

	const getValue = (): number | null | undefined => {
		if (select.value === "") return null;
		if (select.value !== "custom") return Number(select.value);
		const days = Math.round(Number(customInput.value));
		return Number.isFinite(days) && days > 0 ? days : undefined;
	};

	const update = () => customWrapper.toggle(select.value === "custom");
	update();

	const emit = () => {
		const days = getValue();
		if (days !== undefined) onChange?.(days);
	};
	select.addEventListener("change", () => {
		update();
		if (select.value === "custom") customInput.focus();
		emit();
	});
	customInput.addEventListener("change", emit);

	return { getValue };
}

/** Dialog to set the "keep in touch" rhythm, e.g. from the profile header */
export class RhythmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private value: number | null,
		private onSubmit: (days: number | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "How often do you want to be in touch? The last interaction turns yellow shortly before and red after this time.",
		});

		const form = contentEl.createEl("form");
		const input = createRhythmInput(form, this.value);

		const buttons = form.createDiv({ cls: "friend-tracker-modal-buttons" });
		const cancel = buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());
		buttons.createEl("button", {
			text: "Save",
			cls: "mod-cta",
			attr: { type: "submit" },
		});

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const days = input.getValue();
			if (days === undefined) return;
			this.onSubmit(days);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
