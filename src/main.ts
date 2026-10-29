import { Plugin, Notice, TFile, normalizePath } from "obsidian";
import {
	FriendTrackerSettings,
	DEFAULT_SETTINGS,
	ContactWithCountdown,
} from "./types";
import {
	FriendTrackerView,
	VIEW_TYPE_FRIEND_TRACKER,
} from "./views/FriendTrackerView";
import {
	ContactPageView,
	VIEW_TYPE_CONTACT_PAGE,
} from "@/views/ContactPageView";
import { FriendTrackerSettingTab } from "./views/FriendTrackerView/settings";
import { ContactOperations } from "@/services/ContactOperations";
import { formatCountdown } from "@/utils/display";
import { AddContactModal } from "@/modals/AddContactModal";
import { ContactSuggestModal } from "@/modals/ContactSuggestModal";
import { InteractionModal } from "@/modals/InteractionModal";
import { buildVCards, parseVCards, VCardContact } from "@/services/vcard";

// Target of the vCard export, relative to the vault root
const VCARD_EXPORT_FILE = "Friend Tracker contacts.vcf";

export default class FriendTracker extends Plugin {
	settings: FriendTrackerSettings;
	public contactOperations: ContactOperations;

	async onload() {
		await this.loadSettings();
		this.contactOperations = new ContactOperations(this);

		// On mobile, we should wait for layout-ready
		this.app.workspace.onLayoutReady(() => {
			this.initialize();
		});
	}

	private async initialize() {
		try {
			// Register views
			this.registerView(
				VIEW_TYPE_FRIEND_TRACKER,
				(leaf) => new FriendTrackerView(leaf, this)
			);

			this.registerView(
				VIEW_TYPE_CONTACT_PAGE,
				(leaf) => new ContactPageView(leaf, this)
			);

			// Add ribbon icon
			this.addRibbonIcon("user", "Open friend tracker", () =>
				this.activateView()
			);

			this.registerCommands();

			// Add settings tab
			this.addSettingTab(new FriendTrackerSettingTab(this.app, this));

			// Check for birthdays after everything is initialized
			await this.checkBirthdays();
		} catch (error) {
			console.error("Friend Tracker failed to load:", error);
			new Notice("Friend Tracker failed to load: " + error.message);
		}
	}

	/** Commands for the command palette (and custom hotkeys) */
	private registerCommands() {
		this.addCommand({
			id: "open-overview",
			name: "Open overview",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "add-contact",
			name: "Add contact",
			callback: () => new AddContactModal(this.app, this).open(),
		});

		this.addCommand({
			id: "open-contact",
			name: "Open contact…",
			callback: () =>
				this.chooseContact("Open contact", (contact) =>
					this.openContact(contact.file)
				),
		});

		this.addCommand({
			id: "export-vcard",
			name: "Export contacts as vCard",
			callback: () => this.exportVCards(),
		});

		this.addCommand({
			id: "import-vcard",
			name: "Import contacts from vCard…",
			callback: () => this.importVCards(),
		});

		this.addCommand({
			id: "log-interaction",
			name: "Log interaction…",
			callback: () =>
				this.chooseContact("Log interaction with…", (contact) =>
					this.logInteraction(contact)
				),
		});
	}

	/** Write all contacts to a .vcf file in the vault root */
	private async exportVCards() {
		const entries = await this.contactOperations.getContactData();
		if (entries.length === 0) {
			new Notice("No contacts to export");
			return;
		}

		const contacts: VCardContact[] = entries.map(({ file, data }) => {
			const text = (value: unknown) =>
				typeof value === "string" || typeof value === "number"
					? String(value).trim()
					: "";
			// General notes plus note sections, each under its title
			const notes = [text(data.notes)];
			const sections = Array.isArray(data.note_sections)
				? data.note_sections
				: [];
			for (const section of sections) {
				if (section?.title && text(section.text)) {
					notes.push(`${section.title}: ${text(section.text)}`);
				}
			}
			return {
				name: text(data.name) || file.basename,
				birthday: text(data.birthday),
				phone: text(data.phone),
				email: text(data.email),
				address: text(data.address),
				relationship: text(data.relationship),
				notes: notes.filter(Boolean).join("\n\n"),
			};
		});

		const path = normalizePath(VCARD_EXPORT_FILE);
		const content = buildVCards(contacts);
		const existing = this.app.vault.getFileByPath(path);
		if (existing) await this.app.vault.modify(existing, content);
		else await this.app.vault.create(path, content);
		new Notice(`Exported ${contacts.length} contacts to "${path}"`);
	}

	/** Pick a .vcf file and create a contact for every card in it */
	private importVCards() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".vcf,text/vcard,text/x-vcard";
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file) return;

			const cards = parseVCards(await file.text());
			let created = 0;
			let skipped = 0;
			for (const card of cards) {
				const data: Record<string, unknown> = { name: card.name };
				for (const key of [
					"birthday",
					"phone",
					"email",
					"address",
					"relationship",
					"notes",
				] as const) {
					if (card[key]) data[key] = card[key];
				}
				try {
					const result = await this.contactOperations.createContact(data);
					if (result === "created") created++;
					else skipped++;
				} catch (error) {
					console.error(`Error importing ${card.name}:`, error);
					skipped++;
				}

				// Offer imported relationship types as suggestions
				const type = card.relationship;
				if (type && !this.settings.relationshipTypes.includes(type)) {
					this.settings.relationshipTypes.push(type);
				}
			}
			await this.saveSettings();

			new Notice(
				skipped > 0
					? `Imported ${created} contacts, skipped ${skipped} (already existing or invalid)`
					: `Imported ${created} contacts`
			);
		});
		input.click();
	}

	/** Let the user pick a contact via fuzzy search */
	async chooseContact(
		placeholder: string,
		onChoose: (contact: ContactWithCountdown) => void
	) {
		const contacts = await this.contactOperations.getContacts();
		if (contacts.length === 0) {
			new Notice("No contacts yet");
			return;
		}
		contacts.sort((a, b) => a.name.localeCompare(b.name));
		new ContactSuggestModal(this.app, contacts, onChoose, placeholder).open();
	}

	/** Open a contact page, reusing an open one */
	async openContact(file: TFile) {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_CONTACT_PAGE
		);
		const leaf =
			leaves.length > 0 ? leaves[0] : this.app.workspace.getLeaf("tab");

		await leaf.setViewState({
			type: VIEW_TYPE_CONTACT_PAGE,
			state: { filePath: file.path },
		});
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		this.app.workspace.revealLeaf(leaf);
	}

	/** Ask for an interaction and add it to the contact's file */
	logInteraction(contact: ContactWithCountdown) {
		new InteractionModal(
			this.app,
			null,
			async (interaction) => {
				try {
					await this.contactOperations.addInteraction(
						contact.file,
						interaction
					);
					// Open views refresh themselves on the file change
					new Notice(`Interaction with ${contact.name} added`);
				} catch (error) {
					console.error("Error adding interaction:", error);
					new Notice(`Could not add interaction: ${error}`);
				}
			},
			contact.name
		).open();
	}

	/** Reveal the Friend Tracker overview, opening it in the right sidebar */
	async activateView() {
		const workspace = this.app.workspace;

		// Reuse an existing view (it may still be deferred, i.e. not loaded)
		const existing = workspace.getLeavesOfType(VIEW_TYPE_FRIEND_TRACKER);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_FRIEND_TRACKER,
				active: true,
			});
			workspace.revealLeaf(leaf);
		} else {
			new Notice("Could not create Friend Tracker view");
		}
	}

	/** Notices for birthdays today and within the configured days */
	private async checkBirthdays() {
		const contacts = await this.contactOperations.getContacts();
		const maxDays = this.settings.birthdayReminderDays;
		const upcoming = contacts
			.filter(
				(c) =>
					c.daysUntilBirthday !== null &&
					c.daysUntilBirthday <= maxDays
			)
			.sort(
				(a, b) => (a.daysUntilBirthday ?? 0) - (b.daysUntilBirthday ?? 0)
			);

		const today = upcoming.filter((c) => c.daysUntilBirthday === 0);
		if (today.length > 0) {
			const names = joinNames(today.map((c) => c.name));
			new Notice(`🎂 It's ${names}'s birthday today!`, 8000);
		}

		const later = upcoming.filter((c) => c.daysUntilBirthday !== 0);
		if (later.length > 0) {
			const lines = later.map(
				(c) => `${c.name} ${formatCountdown(c.daysUntilBirthday ?? 0)}`
			);
			new Notice(`🎈 Upcoming birthdays:\n${lines.join("\n")}`, 8000);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onunload() {
		// Remove the datalist from document.body if it exists
		const datalist = document.getElementById("relationship-types");
		if (datalist) {
			datalist.remove();
		}
	}
}

/** ["Anna", "Ben", "Cleo"] -> "Anna, Ben and Cleo" */
function joinNames(names: string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
