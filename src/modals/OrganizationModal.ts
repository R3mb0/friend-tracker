import { App, Modal } from "obsidian";

/**
 * Ask for an organization (existing or new) and the contact's role there.
 * New names create a new organization note.
 */
export class OrganizationModal extends Modal {
	constructor(
		app: App,
		private contactName: string,
		private existing: string[],
		private onSubmit: (organization: string, role: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: `Add ${this.contactName} to an organization`,
		});

		const form = contentEl.createEl("form");

		const orgField = form.createDiv({ cls: "friend-tracker-modal-field" });
		orgField.createEl("label", { text: "Company, club, school, …" });
		const orgInput = orgField.createEl("input", {
			cls: "friend-tracker-modal-input",
			attr: {
				type: "text",
				placeholder: "e.g. ACME Inc. or Tennis Club",
				list: "friend-tracker-organizations",
				required: "true",
			},
		});
		const datalist = orgField.createEl("datalist", {
			attr: { id: "friend-tracker-organizations" },
		});
		this.existing.forEach((name) =>
			datalist.createEl("option", { value: name })
		);
		orgField.createDiv({
			cls: "setting-item-description",
			text: "Pick an existing one or type a new name to create it.",
		});

		const roleField = form.createDiv({ cls: "friend-tracker-modal-field" });
		roleField.createEl("label", { text: "Role (optional)" });
		const roleInput = roleField.createEl("input", {
			cls: "friend-tracker-modal-input",
			attr: {
				type: "text",
				placeholder: "e.g. Engineer, Member, Coach",
			},
		});

		const buttons = form.createDiv({ cls: "friend-tracker-modal-buttons" });
		const cancel = buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());
		buttons.createEl("button", {
			text: "Add",
			cls: "mod-cta",
			attr: { type: "submit" },
		});

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const organization = orgInput.value.trim();
			if (!organization) return;
			this.onSubmit(organization, roleInput.value.trim());
			this.close();
		});

		orgInput.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Ask for someone's role in an organization (may be left empty) */
export class RoleModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private currentRole: string,
		private onSubmit: (role: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });

		const form = contentEl.createEl("form");
		const field = form.createDiv({ cls: "friend-tracker-modal-field" });
		field.createEl("label", { text: "Role (optional)" });
		const input = field.createEl("input", {
			cls: "friend-tracker-modal-input",
			attr: {
				type: "text",
				placeholder: "e.g. Engineer, Member, Coach",
				value: this.currentRole,
			},
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
			this.onSubmit(input.value.trim());
			this.close();
		});
		input.focus();
		input.select();
	}

	onClose() {
		this.contentEl.empty();
	}
}
