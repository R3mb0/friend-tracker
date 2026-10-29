import { App, Modal, Notice, stringifyYaml } from "obsidian";
import type FriendTracker from "@/main";
import { createRelationshipInput } from "@/components/ContactFields";
import { getContactFilePath, sanitizeFileName } from "@/utils/file";

export class AddContactModal extends Modal {
	constructor(app: App, private plugin: FriendTracker) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Add new contact" });

		const form = contentEl.createEl("form", {
			cls: "friend-tracker-add-contact-form",
		});

		// Name field (required)
		const nameField = form.createDiv({ cls: "friend-tracker-modal-field" });
		nameField.createEl("label", { text: "Name *" });
		const nameInput = nameField.createEl("input", {
			attr: {
				type: "text",
				name: "name",
				required: true,
				placeholder: "Contact name",
			},
			cls: "friend-tracker-modal-input",
		});
		nameInput.focus();

		// Birthday field
		const birthdayField = form.createDiv({
			cls: "friend-tracker-modal-field",
		});
		birthdayField.createEl("label", { text: "Birthday" });
		const birthdayInput = birthdayField.createEl("input", {
			attr: {
				type: "date",
				name: "birthday",
				placeholder: "YYYY-MM-DD",
				pattern: "\\d{4}-\\d{2}-\\d{2}",
			},
			cls: "friend-tracker-modal-input",
		});

		// Email field
		const emailField = form.createDiv({
			cls: "friend-tracker-modal-field",
		});
		emailField.createEl("label", { text: "Email" });
		const emailInput = emailField.createEl("input", {
			attr: {
				type: "email",
				name: "email",
				placeholder: "email@example.com",
			},
			cls: "friend-tracker-modal-input",
		});

		// Phone field
		const phoneField = form.createDiv({
			cls: "friend-tracker-modal-field",
		});
		phoneField.createEl("label", { text: "Phone" });
		const phoneInput = phoneField.createEl("input", {
			attr: {
				type: "tel",
				name: "phone",
				placeholder: "000-000-0000",
			},
			cls: "friend-tracker-modal-input",
		});

		// Relationship field
		const relationshipField = form.createDiv({
			cls: "friend-tracker-modal-field",
		});
		relationshipField.createEl("label", { text: "Relationship" });
		const relationshipInput = createRelationshipInput(
			relationshipField,
			this.plugin
		);

		// Submit button
		form.createEl("button", {
			text: "Create contact",
			attr: { type: "submit" },
			cls: "friend-tracker-button button-primary",
		});

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const data: Record<string, string> = {
				name: nameInput.value.trim(),
			};

			if (birthdayInput.value) data.birthday = birthdayInput.value;
			if (emailInput.value) data.email = emailInput.value;
			if (phoneInput.value) data.phone = phoneInput.value;
			if (relationshipInput.value) {
				const relationship = relationshipInput.value.toLowerCase();
				data.relationship = relationshipInput.value.toLowerCase();
				// Add new relationship type to settings if it doesn't exist
				if (
					!this.plugin.settings.relationshipTypes.includes(
						relationship
					)
				) {
					// Remove any duplicates (case-insensitive) before adding
					this.plugin.settings.relationshipTypes = [
						...new Set(
							this.plugin.settings.relationshipTypes.filter(
								(type) => type.toLowerCase() !== relationship
							)
						),
						relationship,
					];
					this.plugin.saveSettings();
				}
			}

			if (data.name && (await this.onSubmit(data))) {
				this.close();
			}
		});
	}

	/** Creates the contact file. Returns false if the modal should stay open. */
	private async onSubmit(data: Record<string, string>): Promise<boolean> {
		if (!sanitizeFileName(data.name)) {
			new Notice("Please enter a name with valid characters");
			return false;
		}

		const folder = this.plugin.settings.contactsFolder;
		const filePath = getContactFilePath(folder, data.name);

		if (this.app.vault.getAbstractFileByPath(filePath)) {
			new Notice(`A contact named "${data.name}" already exists`);
			return false;
		}

		// Create YAML frontmatter
		const yaml = stringifyYaml(data);
		const fileContent = `---\n${yaml.trimEnd()}\n---\n`;

		try {
			// Ensure folder exists before creating contact
			if (!this.app.vault.getFolderByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}

			// The Friend Tracker view refreshes itself on file creation
			await this.app.vault.create(filePath, fileContent);
			new Notice(`Created contact: ${data.name}`);
			return true;
		} catch (error) {
			console.error("Error creating contact:", error);
			new Notice(`Error creating contact: ${error.message ?? error}`);
			return false;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
