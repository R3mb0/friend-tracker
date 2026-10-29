import { App, Modal } from "obsidian";
import type FriendTracker from "@/main";
import { createRelationshipInput } from "@/components/ContactFields";

/** Ask for a relationship type to assign to several contacts */
export class SetRelationshipModal extends Modal {
	constructor(
		app: App,
		private plugin: FriendTracker,
		private count: number,
		private onSubmit: (relationship: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: `Set type for ${this.count} contacts`,
		});

		const form = contentEl.createEl("form");
		const field = form.createDiv({ cls: "friend-tracker-modal-field" });
		field.createEl("label", { text: "Relationship" });
		const input = createRelationshipInput(field, this.plugin);
		field.createDiv({
			cls: "setting-item-description",
			text: "Leave empty to remove the type.",
		});

		const buttons = form.createDiv({ cls: "friend-tracker-modal-buttons" });
		const cancel = buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		});
		cancel.addEventListener("click", () => this.close());
		buttons.createEl("button", {
			text: "Apply",
			cls: "mod-cta",
			attr: { type: "submit" },
		});

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			this.onSubmit(input.value.trim().toLowerCase());
			this.close();
		});
		input.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Generic yes/no confirmation for destructive actions */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmText: string,
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		const buttons = contentEl.createDiv({
			cls: "friend-tracker-modal-buttons",
		});
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const confirm = buttons.createEl("button", {
			text: this.confirmText,
			cls: "mod-warning",
		});
		confirm.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
