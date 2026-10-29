import { App, Modal } from "obsidian";
import type { Interaction } from "@/types";
import { toLocalISODate } from "@/utils/date";

export class InteractionModal extends Modal {
	private interaction: Interaction | null;
	private onSubmit: (date: string, text: string) => void;

	constructor(
		app: App,
		interaction: Interaction | null,
		onSubmit: (date: string, text: string) => void,
		/** Shown in the title when opened outside the contact page */
		private contactName?: string
	) {
		super(app);
		this.interaction = interaction;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const title = this.interaction ? "Edit interaction" : "Add interaction";
		contentEl.createEl("h2", {
			text: this.contactName ? `${title} with ${this.contactName}` : title,
		});

		const form = contentEl.createEl("form");
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const dateInput = form.querySelector(
				"[type=date]"
			) as HTMLInputElement;
			const textInput = form.querySelector(
				"textarea"
			) as HTMLTextAreaElement;

			if (dateInput?.value && textInput?.value.trim()) {
				this.onSubmit(dateInput.value, textInput.value);
				this.close();
			}
		});

		// Date input
		form.createEl("input", {
			attr: {
				type: "date",
				value:
					this.interaction?.date ||
					toLocalISODate(new Date()),
				required: "true",
			},
			cls: "contact-interaction-date-input",
		});

		// Text input
		const textInput = form.createEl("textarea", {
			attr: {
				placeholder: "What happened?",
				required: "true",
			},
			cls: "contact-interaction-text-input",
		});
		textInput.value = this.interaction?.text || "";

		// Submit button
		form.createEl("button", {
			text: this.interaction ? "Save changes" : "Add interaction",
			attr: { type: "submit" },
			cls: "friend-tracker-button button-primary",
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
