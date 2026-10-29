import { App, FuzzySuggestModal, TFile } from "obsidian";
import type { ContactWithCountdown } from "@/types";

/** Fuzzy search over all contacts, e.g. for commands */
export class ContactSuggestModal extends FuzzySuggestModal<ContactWithCountdown> {
	constructor(
		app: App,
		private contacts: ContactWithCountdown[],
		private onChoose: (contact: ContactWithCountdown) => void,
		placeholder = "Choose a contact"
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): ContactWithCountdown[] {
		return this.contacts;
	}

	getItemText(contact: ContactWithCountdown): string {
		// Relationship is searchable too, e.g. "family"
		return contact.relationship
			? `${contact.name} (${contact.relationship})`
			: contact.name;
	}

	onChooseItem(contact: ContactWithCountdown): void {
		this.onChoose(contact);
	}
}

/** Fuzzy search over a list of files, e.g. organizations */
export class FileSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private files: TFile[],
		private onChoose: (file: TFile) => void,
		placeholder = "Choose a note"
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}
