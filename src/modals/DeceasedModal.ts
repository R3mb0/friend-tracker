import { App, Modal } from "obsidian";

/** Ask for the date of death; leaving it empty means "date unknown" */
export class DeceasedModal extends Modal {
	constructor(
		app: App,
		private contactName: string,
		private currentDate: string,
		private onSubmit: (date: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: `Mark ${this.contactName} as deceased`,
		});

		const form = contentEl.createEl("form", {
			cls: "friend-tracker-deceased-form",
		});

		const field = form.createDiv({ cls: "friend-tracker-modal-field" });
		field.createEl("label", { text: "Date of death" });
		const dateInput = field.createEl("input", {
			cls: "friend-tracker-modal-input",
			attr: { type: "date", value: this.currentDate },
		});
		field.createDiv({
			cls: "setting-item-description",
			text: "Leave empty if the date is unknown.",
		});

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
			this.onSubmit(dateInput.value);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
