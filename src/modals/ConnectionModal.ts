import { App, Modal } from "obsidian";

// Offered as suggestions; any other text works too
const RELATION_SUGGESTIONS = [
	"partner",
	"spouse",
	"parent",
	"child",
	"sibling",
	"grandparent",
	"grandchild",
	"friend",
	"colleague",
	"neighbor",
];

/**
 * Ask how two contacts are related, e.g. "Max is Anna's brother" and,
 * optionally, the reverse "Anna is Max's sister".
 */
export class ConnectionModal extends Modal {
	constructor(
		app: App,
		private contactName: string,
		private otherName: string,
		private onSubmit: (relation: string, reverseRelation: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: `Connect ${this.contactName} and ${this.otherName}`,
		});

		const form = contentEl.createEl("form");
		const datalist = form.createEl("datalist", {
			attr: { id: "friend-tracker-relations" },
		});
		RELATION_SUGGESTIONS.forEach((relation) =>
			datalist.createEl("option", { value: relation })
		);

		const relationInput = this.createRelationField(
			form,
			`${this.otherName} is ${this.contactName}'s …`,
			"e.g. brother"
		);
		relationInput.required = true;

		const reverseInput = this.createRelationField(
			form,
			`${this.contactName} is ${this.otherName}'s … (optional)`,
			"e.g. sister"
		);
		form.createDiv({
			cls: "setting-item-description",
			text: `If filled in, the connection is also added to ${this.otherName}.`,
		});

		const buttons = form.createDiv({ cls: "friend-tracker-modal-buttons" });
		const cancel = buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());
		buttons.createEl("button", {
			text: "Connect",
			cls: "mod-cta",
			attr: { type: "submit" },
		});

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const relation = relationInput.value.trim().toLowerCase();
			if (!relation) return;
			this.onSubmit(relation, reverseInput.value.trim().toLowerCase());
			this.close();
		});

		relationInput.focus();
	}

	private createRelationField(
		form: HTMLElement,
		label: string,
		placeholder: string
	): HTMLInputElement {
		const field = form.createDiv({ cls: "friend-tracker-modal-field" });
		field.createEl("label", { text: label });
		return field.createEl("input", {
			cls: "friend-tracker-modal-input",
			attr: {
				type: "text",
				placeholder,
				list: "friend-tracker-relations",
			},
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
