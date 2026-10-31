import {
	App,
	FuzzySuggestModal,
	SuggestModal,
	TFile,
	prepareFuzzySearch,
} from "obsidian";
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

type PersonChoice =
	| { kind: "contact"; contact: ContactWithCountdown }
	| { kind: "create"; name: string };

/**
 * Pick an existing contact or, by typing a new name, create one.
 * Used to add relatives.
 */
export class PersonPickerModal extends SuggestModal<PersonChoice> {
	constructor(
		app: App,
		private contacts: ContactWithCountdown[],
		private onChoose: (choice: PersonChoice) => void,
		placeholder: string
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): PersonChoice[] {
		const search = prepareFuzzySearch(query.trim());
		const matches = this.contacts
			.map((contact) => ({ contact, match: search(contact.name) }))
			.filter((entry) => !query.trim() || entry.match)
			.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
			.slice(0, 50)
			.map(
				(entry): PersonChoice => ({
					kind: "contact",
					contact: entry.contact,
				})
			);

		// Offer to create the typed name unless it exists exactly
		const name = query.trim();
		const exists = this.contacts.some(
			(contact) => contact.name.toLowerCase() === name.toLowerCase()
		);
		if (name && !exists) matches.push({ kind: "create", name });
		return matches;
	}

	renderSuggestion(choice: PersonChoice, el: HTMLElement) {
		if (choice.kind === "create") {
			el.createDiv({ text: `Create new contact "${choice.name}"` });
			return;
		}
		el.createDiv({ text: choice.contact.name });
		if (choice.contact.relationship) {
			el.createDiv({
				cls: "suggestion-note",
				text: choice.contact.relationship,
			});
		}
	}

	onChooseSuggestion(choice: PersonChoice) {
		this.onChoose(choice);
	}
}
