import { App, Modal } from "obsidian";
import type { Interaction, InteractionType } from "@/types";
import { INTERACTION_TYPES } from "@/constants";
import { toLocalISODate } from "@/utils/date";

// Preselected type for new interactions
const DEFAULT_TYPE: InteractionType = "meeting";

export class InteractionModal extends Modal {
	private interaction: Interaction | null;
	private onSubmit: (interaction: Interaction) => void;

	constructor(
		app: App,
		interaction: Interaction | null,
		onSubmit: (interaction: Interaction) => void,
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

		// Date and type side by side
		const metaRow = form.createDiv({ cls: "contact-interaction-meta" });
		const dateInput = metaRow.createEl("input", {
			attr: {
				type: "date",
				value: this.interaction?.date || toLocalISODate(new Date()),
				required: "true",
			},
			cls: "contact-interaction-date-input",
		});

		const typeSelect = metaRow.createEl("select", {
			cls: "dropdown contact-interaction-type-select",
			attr: { "aria-label": "Type of interaction" },
		});
		for (const type of INTERACTION_TYPES) {
			typeSelect.createEl("option", { text: type.label, value: type.id });
		}
		// Older entries have no type; keep it that way unless changed
		if (this.interaction && !this.interaction.type) {
			typeSelect.createEl("option", { text: "No type", value: "" });
			typeSelect.value = "";
		} else {
			typeSelect.value = this.interaction?.type ?? DEFAULT_TYPE;
		}

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

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			if (!dateInput.value || !textInput.value.trim()) return;

			const interaction: Interaction = {
				date: dateInput.value,
				text: textInput.value,
			};
			if (typeSelect.value) {
				interaction.type = typeSelect.value as InteractionType;
			}
			this.onSubmit(interaction);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
