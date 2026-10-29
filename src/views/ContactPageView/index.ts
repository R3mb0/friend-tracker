import {
	ItemView,
	WorkspaceLeaf,
	Notice,
	TFile,
	setIcon,
	MarkdownRenderer,
	ViewStateResult,
	Menu,
	debounce,
	Debouncer,
} from "obsidian";
import type FriendTracker from "@/main";
import { createRelationshipInput } from "@/components/ContactFields";
import { createBirthdayInput } from "@/components/BirthdayInput";
import {
	createRhythmInput,
	formatRhythm,
	RhythmModal,
} from "@/components/RhythmInput";
import { InteractionView } from "@/components/InteractionView";
import type {
	ContactData,
	Interaction,
	InteractionType,
	NoteSection,
} from "@/types";
import { AddFieldModal } from "@/modals/AddFieldModal";
import { InteractionModal } from "@/modals/InteractionModal";
import { DeleteContactModal } from "@/modals/DeleteContactModal";
import { DeceasedModal } from "@/modals/DeceasedModal";
import { ConnectionModal } from "@/modals/ConnectionModal";
import { OrganizationModal } from "@/modals/OrganizationModal";
import {
	getLinkTarget,
	parseConnections,
	parseDeceased,
	parseMemberships,
} from "@/services/ContactOperations";
import {
	INTERACTION_TYPES,
	SPECIAL_INPUT_FIELDS,
	STANDARD_FIELDS,
} from "@/constants";
import { splitFrontmatter } from "@/utils/frontmatter";
import {
	parseBirthday,
	parseLocalDate,
	pluralize,
	toLocalISODate,
} from "@/utils/date";
import { getContactFilePath, sanitizeFileName } from "@/utils/file";
import {
	createRelationshipTag,
	formatCountdown,
	getChineseZodiac,
	getContactStatus,
} from "@/utils/display";

export const VIEW_TYPE_CONTACT_PAGE = "contact-page-view";

type TabId = "notes" | "interactions" | "markdown";

interface DetailField {
	key: string;
	label: string;
	icon: string;
}

// Standard contact details, in display order
const DETAIL_FIELDS: DetailField[] = [
	{ key: STANDARD_FIELDS.BIRTHDAY, label: "Birthday", icon: "cake" },
	{ key: STANDARD_FIELDS.PHONE, label: "Phone", icon: "phone" },
	{ key: STANDARD_FIELDS.EMAIL, label: "Email", icon: "mail" },
	{ key: STANDARD_FIELDS.ADDRESS, label: "Address", icon: "map-pin" },
];

const RELATIONSHIP_FIELD: DetailField = {
	key: STANDARD_FIELDS.RELATIONSHIP,
	label: "Relationship",
	icon: "tag",
};

// Frontmatter keys that are never listed as custom fields
const NON_CUSTOM_FIELDS: string[] = [
	STANDARD_FIELDS.NAME,
	STANDARD_FIELDS.NOTES,
	STANDARD_FIELDS.NOTE_SECTIONS,
	STANDARD_FIELDS.INTERACTIONS,
	STANDARD_FIELDS.CREATED,
	STANDARD_FIELDS.UPDATED,
	STANDARD_FIELDS.EXTRAS,
	STANDARD_FIELDS.DECEASED,
	STANDARD_FIELDS.CONTACT_INTERVAL,
	STANDARD_FIELDS.CONNECTIONS,
	STANDARD_FIELDS.ORGANIZATIONS,
	RELATIONSHIP_FIELD.key,
	...DETAIL_FIELDS.map((field) => field.key),
];

// Notes linking to the contact listed in the interactions tab
const MAX_MENTIONS = 10;

// Notes are saved this long after the last keystroke
const NOTES_SAVE_DELAY = 1000;

// Offered when adding a notes block; any other title works too
const NOTE_SECTION_SUGGESTIONS = [
	"Diet",
	"Sports",
	"Hobbies",
	"Gift ideas",
	"Family",
	"Work",
	"Health",
	"Favorites",
];

export class ContactPageView extends ItemView {
	private _file: TFile | null = null;
	private contactData: ContactData = {};
	private lastContent = "";
	private pendingSaves = 0;
	private interactionView: InteractionView;
	public plugin: FriendTracker;
	private activeTab: TabId;
	// UI state that must survive re-renders (e.g. switching tabs)
	private infoEditing = false;
	private focusField: string | null = null;
	private focusQuickAdd = false;
	private focusNoteSection: number | null = null;
	private quickAddType: InteractionType = "meeting";
	private saveNotesDebounced: Debouncer<[], void>;

	public getRelationshipTypes(): string[] {
		return this.plugin.settings.relationshipTypes;
	}

	public async addRelationshipType(
		type: string,
		existingTypes?: string[]
	): Promise<void> {
		this.plugin.settings.relationshipTypes = [
			...(existingTypes || this.plugin.settings.relationshipTypes),
			type,
		];
		await this.plugin.saveSettings();
	}

	constructor(leaf: WorkspaceLeaf, private _plugin: FriendTracker) {
		super(leaf);
		this.plugin = _plugin;
		this.interactionView = new InteractionView(this);
		this.activeTab = this.plugin.settings.defaultActiveTab;
		this.saveNotesDebounced = debounce(
			() => {
				this.saveContactData();
			},
			NOTES_SAVE_DELAY,
			true
		);
	}

	getViewType(): string {
		return VIEW_TYPE_CONTACT_PAGE;
	}

	getDisplayText(): string {
		return this._file?.basename || "Contact";
	}

	getIcon(): string {
		return "user";
	}

	get file() {
		return this._file;
	}

	/** Name from the frontmatter, falling back to the file name */
	private get displayName(): string {
		const name = this.contactData.name;
		return (
			(typeof name === "string" && name.trim()) ||
			this._file?.basename ||
			"Unnamed contact"
		);
	}

	async setState(state: unknown, result: ViewStateResult) {
		const filePath = (state as { filePath?: unknown } | null)?.filePath;
		const file =
			typeof filePath === "string"
				? this.app.vault.getFileByPath(filePath)
				: null;
		if (file) {
			await this.setFile(file);
		}
		await super.setState(state, result);
	}

	async onOpen() {
		// Keep the page in sync with edits made elsewhere (e.g. the editor).
		// Our own saves also trigger "modify"; those are skipped so open
		// inputs and edit mode are not reset.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file === this._file && this.pendingSaves === 0) {
					this.reloadIfChanged();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file === this._file) this.leaf.detach();
			})
		);
	}

	async onClose() {
		// Don't lose notes typed right before closing
		this.saveNotesDebounced.run();
	}

	private async reloadIfChanged() {
		const file = this._file;
		if (!file) return;
		try {
			const content = await this.app.vault.read(file);
			if (this._file !== file || content === this.lastContent) return;
			this.lastContent = content;
			this.contactData = (splitFrontmatter(content).frontmatter ??
				{}) as ContactData;
			this.render();
		} catch (error) {
			console.error(`Error reloading contact file ${file.path}:`, error);
		}
	}

	getState() {
		return {
			type: VIEW_TYPE_CONTACT_PAGE,
			filePath: this._file?.path,
		};
	}

	async setFile(file: TFile) {
		if (this._file && this._file !== file) {
			// Save pending notes of the previous contact first
			this.saveNotesDebounced.run();
			this.infoEditing = false;
		}
		this._file = file;
		const currentFilePath = file.path;
		try {
			const content = await this.app.vault.read(file);
			// Only update if this._file is still the same file
			if (this._file?.path !== currentFilePath) return;
			this.lastContent = content;
			this.contactData = (splitFrontmatter(content).frontmatter ??
				{}) as ContactData;
		} catch (error) {
			console.error(`Error reading contact file ${file.path}:`, error);
			this.contactData = {};
		}
		// Only render if still the same file
		if (this._file?.path === currentFilePath) {
			this.render();
		}
	}

	render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("contact-page");

		if (!this._file) {
			container.createEl("div", {
				text: "No contact selected",
				cls: "contact-empty-state",
			});
			return;
		}

		this.renderHeader(container);

		const infoSection = container.createEl("div", {
			cls: "contact-info-section",
		});
		this.renderInfoSection(infoSection);

		const connections = container.createEl("div", {
			cls: "contact-connections",
		});
		this.renderConnections(connections);

		const organizations = container.createEl("div", {
			cls: "contact-connections contact-organizations",
		});
		this.renderOrganizations(organizations);

		this.renderTabs(container);

		// Content container for tab content
		const contentContainer = container.createEl("div", {
			cls: "contact-content",
		});

		switch (this.activeTab) {
			case "notes":
				this.renderNotesSection(contentContainer);
				break;
			case "interactions":
				this.renderInteractionsSection(contentContainer);
				break;
			case "markdown":
				this.renderExtrasSection(contentContainer);
				break;
		}
	}

	// ---------------------------------------------------------------------
	// Header: name, relationship, key facts, trivia
	// ---------------------------------------------------------------------

	/** "Keep in touch" goal in days, null if none is set */
	private get contactInterval(): number | null {
		return this.plugin.contactOperations.getContactInterval(
			this.contactData.contact_interval
		);
	}

	private get death() {
		return parseDeceased(this.contactData.deceased);
	}

	private renderHeader(container: HTMLElement) {
		const header = container.createEl("div", {
			cls: "contact-page-header",
		});
		if (this.death.deceased) header.addClass("is-deceased");

		this.renderNameSection(header);

		const relationship = this.contactData.relationship;
		if (typeof relationship === "string" && relationship.trim()) {
			const tags = header.createDiv({ cls: "contact-header-tags" });
			createRelationshipTag(tags, relationship.trim().toLowerCase());
		}

		this.renderFacts(header);
	}

	/** The most important facts at a glance, colored like the overview */
	private renderFacts(header: HTMLElement) {
		const ops = this.plugin.contactOperations;
		const facts = header.createDiv({ cls: "contact-facts" });
		const addFact = (icon: string, text: string, cls = "") => {
			const fact = facts.createDiv({ cls: `contact-fact ${cls}` });
			setIcon(fact.createSpan({ cls: "contact-fact-icon" }), icon);
			fact.createSpan({ text });
			return fact;
		};

		const birthday =
			typeof this.contactData.birthday === "string"
				? this.contactData.birthday
				: "";
		// May lack the year ("--MM-DD")
		const birthParts = parseBirthday(birthday);
		const death = this.death;

		if (death.deceased) {
			// Instead of countdown and current age: date of death, age then
			const deathText = death.date
				? ops.formatBirthday(toLocalISODate(death.date), true)
				: "";
			addFact(
				"flower",
				deathText ? `Died ${deathText}` : "Deceased",
				"is-deceased"
			);
			const age = death.date
				? ops.calculateAge(birthday, death.date)
				: null;
			if (age !== null) addFact("hourglass", `Aged ${age}`);
		} else if (birthParts) {
			const days = ops.calculateDaysUntilBirthday(birthday);
			if (days !== null) {
				addFact(
					"cake",
					days === 0
						? "Birthday today 🎂"
						: `Birthday ${formatCountdown(days)}`,
					days <= 7 ? "is-highlighted" : ""
				);
			}
			// Empty when the birth year is unknown
			const age = ops.calculateDetailedAge(birthday);
			if (age) addFact("hourglass", age);
		}

		const daysSince = ops.calculateDaysSinceLastInteraction(
			this.contactData.interactions
		);
		let lastContact: HTMLElement;
		if (daysSince === null) {
			lastContact = addFact(
				"message-circle",
				"No interactions yet",
				"is-muted"
			);
		} else {
			const ago = ops.formatDaysAgo(daysSince).toLowerCase();
			// Colored relative to the "keep in touch" goal; no "overdue"
			// warning for someone who has passed away
			const status = death.deceased
				? null
				: getContactStatus(daysSince, this.contactInterval);
			lastContact = addFact(
				"message-circle",
				`Last contact: ${ago}`,
				status ? `is-status ${status}` : "is-muted"
			);
		}

		// The rhythm itself (click to change), so it's clear what the
		// color refers to; without one, an invitation to set it
		if (!death.deceased) {
			const interval = this.contactInterval;
			const rhythm = interval
				? addFact("repeat", formatRhythm(interval))
				: addFact("repeat", "Set contact rhythm", "is-muted");
			rhythm.addClass("is-clickable");
			rhythm.setAttr("aria-label", "Change how often to keep in touch");
			rhythm.addEventListener("click", () => this.openRhythmModal());
		}
		// Jump to the interactions tab
		lastContact.addClass("is-clickable");
		lastContact.addEventListener("click", () =>
			this.switchTab("interactions")
		);

		if (birthParts) {
			const { year, month, day } = birthParts;
			const trivia = [this.getZodiacSign(month, day)];
			// The Chinese zodiac needs the year
			if (year !== null) {
				const birthDate = new Date(year, month - 1, day);
				trivia.push(`Year of the ${getChineseZodiac(birthDate)}`);
			}
			trivia.push(
				`${this.getSeason(month, day)} baby`,
				`Birthstone: ${this.getBirthstone(month)}`
			);
			header.createDiv({
				cls: "contact-trivia",
				text: trivia.join(" • "),
			});
		}
	}

	private renderNameSection(container: HTMLElement) {
		const editContainer = container.createEl("div", {
			cls: "contact-name-row",
		});

		const nameText = editContainer.createEl("h1", {
			text: this.displayName,
		});

		const nameInput = editContainer.createEl("input", {
			type: "text",
			value: this.displayName,
			placeholder: "Contact name",
			cls: "contact-name-input",
		});

		const editButton = editContainer.createEl("button", {
			cls: "friend-tracker-button button-icon contact-name-edit",
			attr: { "aria-label": "Rename contact" },
		});
		setIcon(editButton, "pencil");

		const menuButton = editContainer.createEl("button", {
			cls: "clickable-icon contact-menu-button",
			attr: { "aria-label": "More options" },
		});
		setIcon(menuButton, "more-vertical");
		menuButton.addEventListener("click", (e) => this.openMenu(e));

		const setEditing = (editing: boolean) => {
			nameText.classList.toggle("editing", editing);
			nameInput.classList.toggle("editing", editing);
			setIcon(editButton, editing ? "checkmark" : "pencil");
		};

		// Keep focus in the input so clicking the button doesn't blur it
		// (which would fire "change" and save twice)
		editButton.addEventListener("mousedown", (e) => e.preventDefault());
		editButton.addEventListener("click", () => {
			if (!nameInput.classList.contains("editing")) {
				setEditing(true);
				nameInput.focus();
			} else {
				saveNameChange();
			}
		});

		let isSaving = false;
		const saveNameChange = async () => {
			if (!this._file || isSaving) return;
			if (!nameInput.classList.contains("editing")) return;
			isSaving = true;

			try {
				const newName = nameInput.value.trim();
				const currentName = this.displayName;

				if (!newName || newName === this.contactData.name) {
					nameInput.value = currentName;
					return;
				}

				if (!sanitizeFileName(newName)) {
					new Notice("Please enter a name with valid characters");
					nameInput.value = currentName;
					return;
				}

				// Rename the file first so name and file name stay in sync
				const folder = this._file.parent?.path ?? "";
				const newPath = getContactFilePath(folder, newName);
				if (newPath !== this._file.path) {
					if (this.app.vault.getAbstractFileByPath(newPath)) {
						new Notice(
							`A contact named "${newName}" already exists`
						);
						nameInput.value = currentName;
						return;
					}
					try {
						await this.app.fileManager.renameFile(
							this._file,
							newPath
						);
					} catch (error) {
						new Notice(`Error updating file name: ${error}`);
						nameInput.value = currentName;
						return;
					}
				}

				this.contactData.name = newName;
				await this.saveContactData();
				new Notice(`Updated contact name`);
			} finally {
				nameText.textContent = this.displayName;
				setEditing(false);
				isSaving = false;
			}
		};

		nameInput.addEventListener("change", saveNameChange);
	}

	private openDeceasedModal() {
		const date = this.death.date;
		new DeceasedModal(
			this.app,
			this.displayName,
			date ? toLocalISODate(date) : "",
			(newDate) => this.setDeceased(newDate)
		).open();
	}

	/**
	 * Store the date of death ("" = date unknown) or, with null, remove
	 * the mark again
	 */
	private async setDeceased(date: string | null) {
		const key = STANDARD_FIELDS.DECEASED;
		if (date === null) {
			delete this.contactData[key];
			await this.saveContactData([key]);
		} else {
			this.contactData[key] = date || true;
			await this.saveContactData();
		}
		this.render();
	}

	private openMenu(event: MouseEvent) {
		const file = this._file;
		if (!file) return;

		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => this.app.workspace.getLeaf("tab").openFile(file))
		);
		menu.addItem((item) =>
			item
				.setTitle("Show all contacts")
				.setIcon("users")
				.onClick(() => this.plugin.activateView())
		);
		menu.addSeparator();

		const death = this.death;
		menu.addItem((item) =>
			item
				.setTitle(
					death.deceased ? "Edit date of death" : "Mark as deceased"
				)
				.setIcon("flower")
				.onClick(() => this.openDeceasedModal())
		);
		if (death.deceased) {
			menu.addItem((item) =>
				item
					.setTitle("Remove deceased mark")
					.setIcon("undo-2")
					.onClick(() => this.setDeceased(null))
			);
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete contact")
				.setIcon("trash")
				.onClick(() => {
					// The view closes itself when the file is deleted
					new DeleteContactModal(this.app, file, async () => {
						await this.app.fileManager.trashFile(file);
					}).open();
				})
		);
		menu.showAtMouseEvent(event);
	}

	private getZodiacSign(month: number, day: number): string {
		if ((month === 3 && day >= 21) || (month === 4 && day <= 19))
			return "Aries";
		if ((month === 4 && day >= 20) || (month === 5 && day <= 20))
			return "Taurus";
		if ((month === 5 && day >= 21) || (month === 6 && day <= 20))
			return "Gemini";
		if ((month === 6 && day >= 21) || (month === 7 && day <= 22))
			return "Cancer";
		if ((month === 7 && day >= 23) || (month === 8 && day <= 22))
			return "Leo";
		if ((month === 8 && day >= 23) || (month === 9 && day <= 22))
			return "Virgo";
		if ((month === 9 && day >= 23) || (month === 10 && day <= 22))
			return "Libra";
		if ((month === 10 && day >= 23) || (month === 11 && day <= 21))
			return "Scorpio";
		if ((month === 11 && day >= 22) || (month === 12 && day <= 21))
			return "Sagittarius";
		if ((month === 12 && day >= 22) || (month === 1 && day <= 19))
			return "Capricorn";
		if ((month === 1 && day >= 20) || (month === 2 && day <= 18))
			return "Aquarius";
		return "Pisces";
	}

	private getSeason(month: number, day: number): string {
		// Northern hemisphere seasons
		if (
			(month === 3 && day >= 20) ||
			month === 4 ||
			month === 5 ||
			(month === 6 && day < 21)
		)
			return "Spring";
		if (
			(month === 6 && day >= 21) ||
			month === 7 ||
			month === 8 ||
			(month === 9 && day < 22)
		)
			return "Summer";
		if (
			(month === 9 && day >= 22) ||
			month === 10 ||
			month === 11 ||
			(month === 12 && day < 21)
		)
			return "Autumn";
		return "Winter";
	}

	private getBirthstone(month: number): string {
		const stones: Record<number, string> = {
			1: "Garnet",
			2: "Amethyst",
			3: "Aquamarine",
			4: "Diamond",
			5: "Emerald",
			6: "Pearl",
			7: "Ruby",
			8: "Peridot",
			9: "Sapphire",
			10: "Opal",
			11: "Topaz",
			12: "Turquoise",
		};
		return stones[month] || "Unknown";
	}

	// ---------------------------------------------------------------------
	// Contact details
	// ---------------------------------------------------------------------

	private renderInfoSection(section: HTMLElement) {
		section.empty();
		const fieldsContainer = section.createEl("div", {
			cls: "contact-fields-container",
		});

		if (this.infoEditing) {
			this.renderInfoEditMode(section, fieldsContainer);
		} else {
			this.renderInfoViewMode(section, fieldsContainer);
		}
	}

	/** Custom frontmatter fields, in file order */
	private getCustomFields(): Array<[string, unknown]> {
		return Object.entries(this.contactData).filter(
			([key]) => !NON_CUSTOM_FIELDS.includes(key.toLowerCase())
		);
	}

	private renderInfoViewMode(
		section: HTMLElement,
		fieldsContainer: HTMLElement
	) {
		fieldsContainer.removeClass("editing");
		const ops = this.plugin.contactOperations;

		for (const { key, label, icon } of DETAIL_FIELDS) {
			const value = formatFieldValue(this.contactData[key]);
			const row = this.createDetailRow(fieldsContainer, key, icon, label);
			const valueEl = row.createDiv({ cls: "contact-field-value" });

			if (!value) {
				// Empty fields invite filling them in
				this.renderPlaceholder(section, valueEl, key, label);
				continue;
			}

			if (key === STANDARD_FIELDS.BIRTHDAY) {
				valueEl.setText(ops.formatBirthday(value, true));
			} else if (key === STANDARD_FIELDS.PHONE) {
				valueEl.createEl("a", {
					text: value,
					href: `tel:${value.replace(/[^\d+]/g, "")}`,
				});
				this.addCopyButton(row, value, label);
			} else if (key === STANDARD_FIELDS.EMAIL) {
				valueEl.createEl("a", { text: value, href: `mailto:${value}` });
				this.addCopyButton(row, value, label);
			} else {
				valueEl.setText(value);
				this.addCopyButton(row, value, label);
			}
		}

		const death = this.death;
		if (death.deceased) {
			const row = this.createDetailRow(
				fieldsContainer,
				STANDARD_FIELDS.DECEASED,
				"flower",
				"Died"
			);
			row.createDiv({
				cls: "contact-field-value",
				text: death.date
					? ops.formatBirthday(toLocalISODate(death.date), true)
					: "Date unknown",
			});
		}

		for (const [key, rawValue] of this.getCustomFields()) {
			const value = formatFieldValue(rawValue);
			// Nested values (objects) can't be shown meaningfully
			if (value === null) continue;

			const row = this.createDetailRow(
				fieldsContainer,
				key,
				"list",
				capitalize(key)
			);
			const valueEl = row.createDiv({ cls: "contact-field-value" });
			if (!value) {
				this.renderPlaceholder(section, valueEl, key, key);
				continue;
			}
			valueEl.setText(value);
			this.addCopyButton(row, value, capitalize(key));
		}

		const editButton = section.createEl("button", {
			cls: "friend-tracker-button contact-edit-details",
		});
		setIcon(editButton.createSpan(), "pencil");
		editButton.createSpan({ text: "Edit details" });
		editButton.addEventListener("click", () => this.startEditing(null));
	}

	private createDetailRow(
		container: HTMLElement,
		key: string,
		icon: string,
		label: string
	): HTMLElement {
		const row = container.createEl("div", {
			cls: "contact-field-view",
			attr: { "data-field": key.toLowerCase() },
		});
		const labelEl = row.createDiv({ cls: "contact-field-label" });
		setIcon(labelEl.createSpan({ cls: "contact-field-icon" }), icon);
		labelEl.createSpan({ text: label });
		return row;
	}

	private renderPlaceholder(
		section: HTMLElement,
		valueEl: HTMLElement,
		key: string,
		label: string
	) {
		const placeholder = valueEl.createEl("button", {
			cls: "contact-field-placeholder",
			text: `Add ${label.toLowerCase()}`,
		});
		placeholder.addEventListener("click", () => this.startEditing(key));
	}

	private addCopyButton(row: HTMLElement, value: string, label: string) {
		const button = row.createEl("button", {
			cls: "clickable-icon contact-copy-button",
			attr: { "aria-label": `Copy ${label.toLowerCase()}` },
		});
		setIcon(button, "copy");
		button.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(value);
				new Notice(`${label} copied`);
			} catch {
				new Notice("Could not copy to clipboard");
			}
		});
	}

	/** Switch details to edit mode, optionally focusing one field */
	private startEditing(focusField: string | null) {
		this.infoEditing = true;
		this.focusField = focusField;
		this.rerenderInfo();
	}

	private rerenderInfo() {
		const section = this.containerEl.querySelector<HTMLElement>(
			".contact-info-section"
		);
		if (section) this.renderInfoSection(section);
	}

	private renderInfoEditMode(
		section: HTMLElement,
		fieldsContainer: HTMLElement
	) {
		fieldsContainer.addClass("editing");

		for (const field of [...DETAIL_FIELDS, RELATIONSHIP_FIELD]) {
			this.createInfoField(
				fieldsContainer,
				field.key,
				field.label,
				this.contactData[field.key]
			);
		}

		this.createContactIntervalField(fieldsContainer);

		// Custom fields with simple values; lists and nested values stay
		// untouched (they can still be edited in the note itself)
		for (const [key, value] of this.getCustomFields()) {
			if (value !== null && typeof value === "object") continue;
			this.createInfoField(
				fieldsContainer,
				key,
				capitalize(key),
				value,
				true
			);
		}

		const buttons = section.createDiv({ cls: "contact-edit-buttons" });

		const addFieldButton = buttons.createEl("button", {
			cls: "friend-tracker-button button-outlined",
			text: "Add custom field",
		});
		addFieldButton.addEventListener("click", () => {
			this.openAddFieldModal();
		});

		const doneButton = buttons.createEl("button", {
			cls: "friend-tracker-button button-primary",
			text: "Done",
		});
		doneButton.addEventListener("click", async () => {
			await this.saveContactData();
			this.infoEditing = false;
			// Re-render everything: the header shows birthday and relationship
			this.render();
		});

		if (this.focusField) {
			const input = fieldsContainer.querySelector<HTMLInputElement>(
				`[data-field="${CSS.escape(this.focusField.toLowerCase())}"] input`
			);
			input?.focus();
			this.focusField = null;
		}
	}

	private createInfoField(
		container: HTMLElement,
		field: string,
		label: string,
		value: unknown,
		removable = false
	) {
		const fieldContainer = container.createEl("div", {
			cls: "contact-field",
			attr: { "data-field": field.toLowerCase() },
		});

		fieldContainer.createEl("label", {
			text: label,
		});

		const stringValue = value == null ? "" : String(value);

		if (field === STANDARD_FIELDS.BIRTHDAY) {
			// Date input with a "Year unknown" option
			createBirthdayInput(fieldContainer, stringValue, {
				inputCls: "contact-field-input",
				onChange: (newValue) => this.updateContactData(field, newValue),
			});
			return;
		}

		if (field === STANDARD_FIELDS.RELATIONSHIP) {
			// Shared input that also provides the suggestion list
			const input = createRelationshipInput(
				fieldContainer,
				this.plugin,
				stringValue,
				async (newValue) => {
					const relationship = newValue.trim().toLowerCase();
					await this.updateContactData(field, relationship);
					if (
						relationship &&
						!this.getRelationshipTypes().includes(relationship)
					) {
						await this.addRelationshipType(relationship);
					}
				}
			);
			input.className = "contact-field-input";
			return;
		}

		const input = fieldContainer.createEl("input", {
			cls: "contact-field-input",
			attr: {
				type:
					SPECIAL_INPUT_FIELDS[
						field as keyof typeof SPECIAL_INPUT_FIELDS
					] ?? "text",
				placeholder: `Enter ${label.toLowerCase()}`,
				value: stringValue,
			},
		});

		input.addEventListener("change", () => {
			this.updateContactData(field, input.value);
		});

		if (removable) {
			const removeButton = fieldContainer.createEl("button", {
				cls: "clickable-icon contact-field-remove",
				attr: { "aria-label": `Remove field "${label}"` },
			});
			setIcon(removeButton, "x");
			removeButton.addEventListener("click", () =>
				this.removeField(field)
			);
		}
	}

	/** "Keep in touch" rhythm: presets or a custom number of days */
	private createContactIntervalField(container: HTMLElement) {
		const key = STANDARD_FIELDS.CONTACT_INTERVAL;
		const fieldContainer = container.createEl("div", {
			cls: "contact-field",
			attr: { "data-field": key },
		});
		fieldContainer.createEl("label", { text: "Keep in touch" });

		createRhythmInput(fieldContainer, this.contactInterval, (days) =>
			this.setContactInterval(days, false)
		);
	}

	/** Set or (with null) remove the rhythm; optionally re-render the page */
	private async setContactInterval(days: number | null, rerender = true) {
		const key = STANDARD_FIELDS.CONTACT_INTERVAL;
		if (days) {
			this.contactData[key] = days;
			await this.saveContactData();
		} else {
			delete this.contactData[key];
			await this.saveContactData([key]);
		}
		if (rerender) this.render();
	}

	private openRhythmModal() {
		new RhythmModal(
			this.app,
			`Keep in touch with ${this.displayName}`,
			this.contactInterval,
			(days) => this.setContactInterval(days)
		).open();
	}

	private async removeField(field: string) {
		delete this.contactData[field];
		await this.saveContactData([field]);
		this.rerenderInfo();
	}

	// ---------------------------------------------------------------------
	// Connections to other contacts
	// ---------------------------------------------------------------------

	private async renderConnections(section: HTMLElement) {
		const file = this._file;
		if (!file) return;

		const header = section.createDiv({ cls: "contact-connections-header" });
		header.createEl("h3", { text: "Connections" });
		const addButton = header.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Add connection" },
		});
		setIcon(addButton, "plus");
		addButton.addEventListener("click", () => this.startAddConnection());

		const list = section.createDiv({ cls: "contact-connections-list" });
		const own = parseConnections(this.contactData.connections);
		const linked = new Set<TFile>();

		own.forEach((connection, index) => {
			const target = this.resolveContactLink(connection.contact);
			if (target) linked.add(target);
			this.renderConnection(list, {
				name: target?.basename ?? getLinkTarget(connection.contact),
				relation: connection.relation,
				target,
				onRemove: () => this.removeConnection(index),
			});
		});

		// Contacts that link here without a link back (read-only)
		const contacts = await this.plugin.contactOperations.getContacts();
		if (this._file !== file) return;
		for (const other of contacts) {
			if (other.file === file || linked.has(other.file)) continue;
			const incoming = other.connections.find(
				(connection) =>
					this.resolveContactLink(connection.contact, other.file) ===
					file
			);
			if (!incoming) continue;
			this.renderConnection(list, {
				name: other.name,
				relation: incoming.relation
					? `sees ${this.displayName} as ${incoming.relation}`
					: "",
				target: other.file,
				incoming: true,
			});
		}

		if (!list.hasChildNodes()) {
			list.createDiv({
				cls: "contact-connections-empty",
				text: "No connections yet",
			});
		}
	}

	private renderConnection(
		list: HTMLElement,
		options: {
			name: string;
			relation: string;
			target: TFile | null;
			incoming?: boolean;
			onRemove?: () => void;
		}
	) {
		const item = list.createDiv({
			cls: `contact-connection${options.incoming ? " is-incoming" : ""}`,
		});
		if (options.relation && !options.incoming) {
			item.createSpan({
				cls: "contact-connection-relation",
				text: capitalize(options.relation),
			});
		}
		const link = item.createEl("a", {
			cls: "contact-connection-name",
			text: options.name,
			href: "#",
		});
		link.addEventListener("click", (e) => {
			e.preventDefault();
			this.openConnection(options.target, options.name);
		});
		if (options.relation && options.incoming) {
			item.createSpan({
				cls: "contact-connection-relation",
				text: options.relation,
			});
		}
		if (options.onRemove) {
			const onRemove = options.onRemove;
			const remove = item.createEl("button", {
				cls: "clickable-icon contact-connection-remove",
				attr: { "aria-label": `Remove connection to ${options.name}` },
			});
			setIcon(remove, "x");
			remove.addEventListener("click", () => onRemove());
		}
	}

	/** Resolve "[[Name]]" to a file, relative to `from` (default: this page) */
	private resolveContactLink(
		link: string,
		from: TFile | null = this._file
	): TFile | null {
		return this.app.metadataCache.getFirstLinkpathDest(
			getLinkTarget(link),
			from?.path ?? ""
		);
	}

	// ---------------------------------------------------------------------
	// Organizations (companies, clubs, ...)
	// ---------------------------------------------------------------------

	private renderOrganizations(section: HTMLElement) {
		const header = section.createDiv({ cls: "contact-connections-header" });
		header.createEl("h3", { text: "Organizations" });
		const addButton = header.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Add organization" },
		});
		setIcon(addButton, "plus");
		addButton.addEventListener("click", () => this.startAddOrganization());

		const list = section.createDiv({ cls: "contact-connections-list" });
		const memberships = parseMemberships(this.contactData.organizations);
		memberships.forEach((membership, index) => {
			const target = this.resolveContactLink(membership.organization);
			const name =
				target?.basename ?? getLinkTarget(membership.organization);
			const item = list.createDiv({ cls: "contact-connection" });
			setIcon(
				item.createSpan({ cls: "contact-organization-icon" }),
				"building-2"
			);
			const link = item.createEl("a", {
				cls: "contact-connection-name",
				text: name,
				href: "#",
			});
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.openConnection(target, name);
			});
			if (membership.role) {
				item.createSpan({
					cls: "contact-organization-role",
					text: membership.role,
				});
			}
			const remove = item.createEl("button", {
				cls: "clickable-icon contact-connection-remove",
				attr: { "aria-label": `Remove from ${name}` },
			});
			setIcon(remove, "x");
			remove.addEventListener("click", () =>
				this.removeOrganization(index)
			);
		});

		if (memberships.length === 0) {
			list.createDiv({
				cls: "contact-connections-empty",
				text: "No organizations yet",
			});
		}
	}

	private startAddOrganization() {
		const ops = this.plugin.contactOperations;
		new OrganizationModal(
			this.app,
			this.displayName,
			ops.getOrganizations().map((file) => file.basename),
			(name, role) => this.addOrganization(name, role)
		).open();
	}

	private async addOrganization(name: string, role: string) {
		let organization: TFile | null;
		try {
			organization =
				await this.plugin.contactOperations.getOrCreateOrganization(
					name
				);
		} catch (error) {
			console.error("Error creating organization:", error);
			new Notice(`Could not create organization: ${error}`);
			return;
		}
		if (!organization) {
			new Notice("Please enter a name with valid characters");
			return;
		}

		const memberships = parseMemberships(this.contactData.organizations);
		const existing = memberships.find(
			(entry) => this.resolveContactLink(entry.organization) === organization
		);
		if (existing) {
			existing.role = role;
		} else {
			memberships.push({
				organization: `[[${organization.basename}]]`,
				role,
			});
		}
		this.contactData.organizations = memberships;
		await this.saveContactData();
		this.render();
	}

	private async removeOrganization(index: number) {
		const memberships = parseMemberships(this.contactData.organizations);
		const [removed] = memberships.splice(index, 1);
		if (!removed) return;
		this.contactData.organizations = memberships;
		if (memberships.length === 0) {
			delete this.contactData.organizations;
			await this.saveContactData([STANDARD_FIELDS.ORGANIZATIONS]);
		} else {
			await this.saveContactData();
		}
		this.render();

		this.showUndoNotice("Removed from organization", () => {
			const current = parseMemberships(this.contactData.organizations);
			current.splice(Math.min(index, current.length), 0, removed);
			this.contactData.organizations = current;
		});
	}

	private openConnection(target: TFile | null, name: string) {
		// Only files directly in the contacts folder are contacts
		// (organizations live in a subfolder and open as notes)
		const folder = this.plugin.settings.contactsFolder;
		if (target && target.parent?.path === folder) {
			this.plugin.openContact(target);
		} else if (
			target &&
			this.plugin.contactOperations.isOrganization(target)
		) {
			this.plugin.openOrganization(target);
		} else if (target) {
			this.app.workspace.getLeaf("tab").openFile(target);
		} else {
			// Unknown link: let Obsidian handle it (it may create the note)
			this.app.workspace.openLinkText(name, this._file?.path ?? "");
		}
	}

	private startAddConnection() {
		const file = this._file;
		if (!file) return;
		this.plugin.chooseContact("Connect with…", (other) => {
			if (other.file === file) {
				new Notice("A contact can't be connected to itself");
				return;
			}
			new ConnectionModal(
				this.app,
				this.displayName,
				other.name,
				(relation, reverseRelation) =>
					this.addConnection(other.file, relation, reverseRelation)
			).open();
		});
	}

	private async addConnection(
		other: TFile,
		relation: string,
		reverseRelation: string
	) {
		const file = this._file;
		if (!file) return;

		const connections = parseConnections(this.contactData.connections);
		const existing = connections.find(
			(connection) => this.resolveContactLink(connection.contact) === other
		);
		if (existing) {
			existing.relation = relation;
		} else {
			connections.push({ contact: `[[${other.basename}]]`, relation });
		}
		this.contactData.connections = connections;
		await this.saveContactData();

		// Optionally store the reverse direction in the other contact
		if (reverseRelation) {
			await this.app.fileManager.processFrontMatter(
				other,
				(frontmatter) => {
					const theirs = parseConnections(frontmatter.connections);
					const back = theirs.find(
						(connection) =>
							this.resolveContactLink(connection.contact, other) ===
							file
					);
					if (back) {
						back.relation = reverseRelation;
					} else {
						theirs.push({
							contact: `[[${file.basename}]]`,
							relation: reverseRelation,
						});
					}
					frontmatter.connections = theirs;
				}
			);
		}
		this.render();
	}

	private async removeConnection(index: number) {
		const connections = parseConnections(this.contactData.connections);
		const [removed] = connections.splice(index, 1);
		if (!removed) return;
		this.contactData.connections = connections;
		if (connections.length === 0) {
			delete this.contactData.connections;
			await this.saveContactData([STANDARD_FIELDS.CONNECTIONS]);
		} else {
			await this.saveContactData();
		}
		this.render();

		this.showUndoNotice("Connection removed", () => {
			const current = parseConnections(this.contactData.connections);
			current.splice(Math.min(index, current.length), 0, removed);
			this.contactData.connections = current;
		});
	}

	// ---------------------------------------------------------------------
	// Tabs
	// ---------------------------------------------------------------------

	private renderTabs(container: HTMLElement) {
		const tabsContainer = container.createEl("div", {
			cls: "contact-tabs",
		});

		const interactionCount = Array.isArray(this.contactData.interactions)
			? this.contactData.interactions.length
			: 0;

		const tabs: Array<{
			id: TabId;
			icon: string;
			label: string;
			count?: number;
		}> = [
			{ id: "notes", icon: "pencil", label: "Notes" },
			{
				id: "interactions",
				icon: "clock",
				label: "Interactions",
				count: interactionCount,
			},
			{ id: "markdown", icon: "document", label: "Markdown" },
		];

		tabs.forEach((tab) => {
			const tabButton = tabsContainer.createEl("button", {
				cls: `contact-tab ${this.activeTab === tab.id ? "active" : ""}`,
			});

			setIcon(tabButton, tab.icon);
			tabButton.createSpan({ text: tab.label });
			if (tab.count) {
				tabButton.createSpan({
					cls: "contact-tab-count",
					text: String(tab.count),
				});
			}

			tabButton.addEventListener("click", () => this.switchTab(tab.id));
		});
	}

	private async switchTab(tab: TabId) {
		// Save notes before the textarea disappears
		this.saveNotesDebounced.run();
		this.activeTab = tab;
		this.render();
		this.plugin.settings.defaultActiveTab = tab;
		await this.plugin.saveSettings();
	}

	// ---------------------------------------------------------------------
	// Notes
	// ---------------------------------------------------------------------

	private renderNotesSection(container: HTMLElement) {
		const notesSection = container.createEl("div", {
			cls: "contact-notes-section",
		});

		// Fixed block for general notes (stored in "notes")
		this.renderNoteBlock(notesSection, {
			title: "General",
			icon: "info",
			value:
				typeof this.contactData.notes === "string"
					? this.contactData.notes
					: "",
			placeholder:
				"Add notes about family members, parents' names, or anything else you want to remember...",
			onChange: (value) => {
				this.contactData.notes = value;
			},
		});

		// User-defined blocks (stored in "note_sections")
		const sections = this.getNoteSections();
		sections.forEach((section, index) => {
			const textarea = this.renderNoteBlock(notesSection, {
				title: section.title,
				icon: "hash",
				value: section.text,
				placeholder: `Notes about ${section.title.toLowerCase()}...`,
				onChange: (value) => {
					section.text = value;
				},
				onMenu: (event) => this.openNoteSectionMenu(event, index),
				onRename: (title) => this.renameNoteSection(index, title),
			});
			if (this.focusNoteSection === index) {
				this.focusNoteSection = null;
				setTimeout(() => textarea.focus(), 0);
			}
		});

		this.renderAddNoteSection(notesSection, sections);
	}

	/** A titled notes block with an auto-saving, auto-growing textarea */
	private renderNoteBlock(
		container: HTMLElement,
		options: {
			title: string;
			icon: string;
			value: string;
			placeholder: string;
			onChange: (value: string) => void;
			onMenu?: (event: MouseEvent) => void;
			onRename?: (title: string) => void;
		}
	): HTMLTextAreaElement {
		const block = container.createDiv({ cls: "contact-note-block" });
		const header = block.createDiv({ cls: "contact-note-header" });

		setIcon(header.createSpan({ cls: "contact-note-icon" }), options.icon);
		const titleEl = header.createEl("h3", {
			cls: "contact-note-title",
			text: options.title,
		});

		if (options.onRename) {
			const onRename = options.onRename;
			// Double-click the heading to rename it
			titleEl.addClass("is-editable");
			titleEl.setAttr("title", "Double-click to rename");
			titleEl.addEventListener("dblclick", () =>
				this.editNoteTitle(titleEl, options.title, onRename)
			);
		}

		if (options.onMenu) {
			const menuButton = header.createEl("button", {
				cls: "clickable-icon contact-note-menu",
				attr: { "aria-label": "Section options" },
			});
			setIcon(menuButton, "more-horizontal");
			menuButton.addEventListener("click", options.onMenu);
		}

		const textarea = block.createEl("textarea", {
			cls: "contact-notes-input",
			attr: { placeholder: options.placeholder },
		});
		textarea.value = options.value;

		// Save shortly after typing stops, not only when leaving the field
		textarea.addEventListener("input", () => {
			this.adjustTextareaHeight(textarea);
			options.onChange(textarea.value);
			this.saveNotesDebounced();
		});
		textarea.addEventListener("blur", () => {
			this.saveNotesDebounced.run();
		});

		setTimeout(() => this.adjustTextareaHeight(textarea), 0);
		return textarea;
	}

	/** Swap a block heading for an input; Enter saves, Escape cancels */
	private editNoteTitle(
		titleEl: HTMLElement,
		currentTitle: string,
		onRename: (title: string) => void
	) {
		const input = createEl("input", {
			cls: "contact-note-title-input",
			attr: { type: "text", value: currentTitle },
		});
		titleEl.replaceWith(input);
		input.focus();
		input.select();

		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			const title = input.value.trim();
			input.replaceWith(titleEl);
			if (save && title && title !== currentTitle) onRename(title);
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("blur", () => finish(true));
	}

	private renderAddNoteSection(
		container: HTMLElement,
		sections: NoteSection[]
	) {
		const form = container.createEl("form", {
			cls: "contact-note-add",
		});
		const input = form.createEl("input", {
			cls: "contact-note-add-input",
			attr: {
				type: "text",
				placeholder: "New section, e.g. Diet or Sports",
				list: "friend-tracker-note-sections",
				"aria-label": "Name of the new notes section",
			},
		});

		// Suggest common topics that this contact doesn't have yet
		const datalist = form.createEl("datalist", {
			attr: { id: "friend-tracker-note-sections" },
		});
		const used = sections.map((section) => section.title.toLowerCase());
		NOTE_SECTION_SUGGESTIONS.filter(
			(title) => !used.includes(title.toLowerCase())
		).forEach((title) => datalist.createEl("option", { value: title }));

		const button = form.createEl("button", {
			cls: "friend-tracker-button",
			attr: { type: "submit" },
		});
		setIcon(button.createSpan(), "plus");
		button.createSpan({ text: "Add section" });

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			this.addNoteSection(input.value);
		});
	}

	/**
	 * Note sections from the frontmatter, cleaned up in place. The same
	 * objects are kept, because open textareas write into them.
	 */
	private getNoteSections(): NoteSection[] {
		if (!Array.isArray(this.contactData.note_sections)) {
			this.contactData.note_sections = [];
		}
		const sections = this.contactData.note_sections;
		for (let i = sections.length - 1; i >= 0; i--) {
			const section = sections[i];
			if (
				!section ||
				typeof section !== "object" ||
				typeof section.title !== "string" ||
				!section.title.trim()
			) {
				sections.splice(i, 1);
				continue;
			}
			section.title = section.title.trim();
			if (typeof section.text !== "string") {
				section.text = section.text == null ? "" : String(section.text);
			}
		}
		return sections;
	}

	private hasNoteSection(title: string, exceptIndex?: number): boolean {
		const key = title.trim().toLowerCase();
		if (key === "general") return true;
		return this.getNoteSections().some(
			(section, index) =>
				index !== exceptIndex && section.title.toLowerCase() === key
		);
	}

	private async addNoteSection(rawTitle: string) {
		const title = rawTitle.trim();
		if (!title) return;
		if (this.hasNoteSection(title)) {
			new Notice(`A section named "${title}" already exists`);
			return;
		}

		this.saveNotesDebounced.run();
		const sections = this.getNoteSections();
		sections.push({ title, text: "" });
		await this.saveContactData();
		this.focusNoteSection = sections.length - 1;
		this.render();
	}

	private async renameNoteSection(index: number, title: string) {
		const sections = this.getNoteSections();
		if (!sections[index]) return;
		if (this.hasNoteSection(title, index)) {
			new Notice(`A section named "${title}" already exists`);
			this.render();
			return;
		}
		this.saveNotesDebounced.run();
		sections[index].title = title;
		await this.saveContactData();
		this.render();
	}

	private async moveNoteSection(index: number, offset: number) {
		const sections = this.getNoteSections();
		const target = index + offset;
		if (!sections[index] || !sections[target]) return;
		this.saveNotesDebounced.run();
		[sections[index], sections[target]] = [sections[target], sections[index]];
		await this.saveContactData();
		this.render();
	}

	private async deleteNoteSection(index: number) {
		const sections = this.getNoteSections();
		if (!sections[index]) return;
		this.saveNotesDebounced.run();
		const [removed] = sections.splice(index, 1);
		await this.saveContactData();
		this.render();

		this.showUndoNotice(`Section "${removed.title}" deleted`, () => {
			const current = this.getNoteSections();
			current.splice(Math.min(index, current.length), 0, removed);
		});
	}

	private openNoteSectionMenu(event: MouseEvent, index: number) {
		const count = this.getNoteSections().length;
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => {
					const titleEl = this.containerEl.querySelectorAll<HTMLElement>(
						".contact-note-title.is-editable"
					)[index];
					const section = this.getNoteSections()[index];
					if (titleEl && section) {
						this.editNoteTitle(titleEl, section.title, (title) =>
							this.renameNoteSection(index, title)
						);
					}
				})
		);
		menu.addItem((item) =>
			item
				.setTitle("Move up")
				.setIcon("arrow-up")
				.setDisabled(index === 0)
				.onClick(() => this.moveNoteSection(index, -1))
		);
		menu.addItem((item) =>
			item
				.setTitle("Move down")
				.setIcon("arrow-down")
				.setDisabled(index >= count - 1)
				.onClick(() => this.moveNoteSection(index, 1))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete section")
				.setIcon("trash")
				.onClick(() => this.deleteNoteSection(index))
		);
		menu.showAtMouseEvent(event);
	}

	/**
	 * Notice with an "Undo" button. `restore` puts the data back; saving
	 * and re-rendering happen here.
	 */
	private showUndoNotice(message: string, restore: () => void) {
		const file = this._file;
		const notice = new Notice(
			createFragment((fragment) => {
				fragment.createSpan({ text: message });
				const undo = fragment.createEl("button", {
					cls: "contact-undo-button",
					text: "Undo",
				});
				undo.addEventListener("click", async () => {
					notice.hide();
					// The page may show another contact by now
					if (this._file !== file) return;
					restore();
					await this.saveContactData();
					this.render();
				});
			}),
			8000
		);
	}

	// ---------------------------------------------------------------------
	// Interactions
	// ---------------------------------------------------------------------

	private renderInteractionsSection(container: HTMLElement) {
		const interactions = container.createEl("div", {
			cls: "contact-interactions",
		});

		// Quick add: type and press Enter to log something for today
		const quickAdd = interactions.createEl("form", {
			cls: "contact-quick-add",
		});

		// Type of interaction, remembered while the page is open
		const typeSelect = quickAdd.createEl("select", {
			cls: "dropdown contact-quick-add-type",
			attr: { "aria-label": "Type of interaction" },
		});
		for (const type of INTERACTION_TYPES) {
			typeSelect.createEl("option", { text: type.label, value: type.id });
		}
		typeSelect.value = this.quickAddType;
		typeSelect.addEventListener("change", () => {
			this.quickAddType = typeSelect.value as InteractionType;
		});

		const quickInput = quickAdd.createEl("input", {
			cls: "contact-quick-add-input",
			attr: {
				type: "text",
				placeholder: "What did you do together today?",
				"aria-label": "Log an interaction for today",
			},
		});
		const submitButton = quickAdd.createEl("button", {
			cls: "friend-tracker-button button-primary",
			attr: { type: "submit", "aria-label": "Add for today" },
		});
		setIcon(submitButton, "plus");
		const datedButton = quickAdd.createEl("button", {
			cls: "friend-tracker-button",
			attr: { type: "button", "aria-label": "Add with a date" },
		});
		setIcon(datedButton, "calendar-plus");

		quickAdd.addEventListener("submit", (e) => {
			e.preventDefault();
			const text = quickInput.value.trim();
			if (!text) return;
			this.focusQuickAdd = true;
			this.addInteraction({
				date: toLocalISODate(new Date()),
				text,
				type: this.quickAddType,
			});
		});
		datedButton.addEventListener("click", () => {
			this.openAddInteractionModal();
		});

		if (this.focusQuickAdd) {
			this.focusQuickAdd = false;
			setTimeout(() => quickInput.focus(), 0);
		}

		const list = this.contactData.interactions;
		if (!Array.isArray(list) || list.length === 0) {
			interactions.createEl("div", {
				cls: "section-helper-text",
				text: "Log meaningful touchpoints like meetings, calls, or important conversations to help maintain strong relationships",
			});
		} else {
			this.interactionView.render(interactions, list);
		}

		this.renderMentions(interactions);
	}

	/**
	 * Notes that link to this contact (e.g. "Had coffee with [[Anna]]" in a
	 * daily note), newest first
	 */
	private renderMentions(container: HTMLElement) {
		const file = this._file;
		if (!file) return;

		const resolved = this.app.metadataCache.resolvedLinks;
		// Other contacts link here via connections; those aren't mentions
		const contactsFolder = this.plugin.settings.contactsFolder + "/";
		const sources = Object.keys(resolved)
			.filter(
				(path) =>
					!path.startsWith(contactsFolder) && resolved[path][file.path]
			)
			.map((path) => this.app.vault.getFileByPath(path))
			.filter((source): source is TFile => source !== null)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		if (sources.length === 0) return;

		const section = container.createDiv({ cls: "contact-mentions" });
		section.createEl("h3", {
			text: `Mentioned in ${pluralize(sources.length, "note")}`,
		});
		const list = section.createDiv({ cls: "contact-mentions-list" });
		for (const source of sources.slice(0, MAX_MENTIONS)) {
			const item = list.createDiv({ cls: "contact-mention" });
			const link = item.createEl("a", {
				text: source.basename,
				href: "#",
			});
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.app.workspace.getLeaf("tab").openFile(source);
			});
			item.createSpan({
				cls: "contact-mention-date",
				text: new Date(source.stat.mtime).toLocaleDateString(),
			});
		}
		if (sources.length > MAX_MENTIONS) {
			section.createDiv({
				cls: "contact-mentions-more",
				text: `and ${sources.length - MAX_MENTIONS} more (see backlinks)`,
			});
		}
	}

	private async addInteraction(interaction: Interaction) {
		if (!Array.isArray(this.contactData.interactions)) {
			this.contactData.interactions = [];
		}
		this.contactData.interactions.push(interaction);
		await this.saveContactData();
		// Header (last contact) and tab count change too
		this.render();
	}

	// ---------------------------------------------------------------------
	// Markdown
	// ---------------------------------------------------------------------

	private async renderExtrasSection(container: HTMLElement) {
		const extrasSection = container.createEl("div", {
			cls: "contact-extras-section",
		});

		if (!this._file) return;
		const file = this._file;

		const headerContainer = extrasSection.createEl("div", {
			cls: "contact-extras-header",
		});

		let extrasContent = "";
		try {
			const content = await this.app.vault.read(file);
			extrasContent = splitFrontmatter(content).body;
		} catch (error) {
			console.error(
				`Error reading extras from file ${file.path}:`,
				error
			);
		}

		// Add helper text if no markdown content
		if (!extrasContent.trim()) {
			headerContainer.createEl("div", {
				cls: "section-helper-text",
				text: "Add formatted text, links, and other Markdown content",
			});
		}

		const editButton = headerContainer.createEl("button", {
			cls: "friend-tracker-button button-align-right",
			text: "Edit markdown",
		});

		// Open the note next to the profile to see changes side by side
		editButton.addEventListener("click", () => {
			this.app.workspace.getLeaf("split", "vertical").openFile(file);
		});

		if (!extrasContent.trim()) return;

		const contentDiv = extrasSection.createEl("div", {
			cls: "contact-extras-content",
		});

		await MarkdownRenderer.render(
			this.app,
			extrasContent,
			contentDiv,
			file.path,
			this
		);

		// Add click handlers for internal links; external links
		// (http, mailto, ...) keep their default behavior
		contentDiv.addEventListener("click", (event) => {
			const anchor = (event.target as HTMLElement).closest("a");
			if (!anchor) return;

			if (anchor.classList.contains("internal-link")) {
				event.preventDefault();
				const linkText =
					anchor.getAttribute("data-href") ??
					anchor.getAttribute("href") ??
					"";
				this.app.workspace.openLinkText(
					linkText,
					file.path,
					event.ctrlKey || event.metaKey
				);
			} else if (anchor.getAttribute("href")?.startsWith("#")) {
				// Handle internal anchor links
				event.preventDefault();
				const href = anchor.getAttribute("href") ?? "";
				try {
					contentDiv.querySelector(href)?.scrollIntoView();
				} catch {
					// Ignore anchors that are not valid selectors
				}
			}
		});
	}

	private adjustTextareaHeight(textarea: HTMLTextAreaElement) {
		textarea.classList.add("measuring");
		textarea.style.setProperty(
			"--scroll-height",
			`${textarea.scrollHeight}px`
		);
		textarea.classList.remove("measuring");
	}

	// ---------------------------------------------------------------------
	// Saving
	// ---------------------------------------------------------------------

	/** Write contactData to the frontmatter; `removedKeys` are deleted */
	async saveContactData(removedKeys: string[] = []) {
		if (!this._file) return;
		const file = this._file;

		// Sort interactions by date in descending order (newest first)
		if (Array.isArray(this.contactData.interactions)) {
			const getTime = (interaction: Interaction) =>
				parseLocalDate(interaction?.date)?.getTime() ?? 0;
			this.contactData.interactions.sort(
				(a, b) => getTime(b) - getTime(a)
			);
		}

		this.pendingSaves++;
		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter) => {
					Object.assign(frontmatter, this.contactData);
					for (const key of removedKeys) delete frontmatter[key];
				}
			);
			this.lastContent = await this.app.vault.read(file);
		} finally {
			this.pendingSaves--;
		}
	}

	// Modal methods
	private async openAddFieldModal() {
		const modal = new AddFieldModal(this.app, async (fieldName) => {
			if (!(fieldName in this.contactData)) {
				this.contactData[fieldName] = "";
				await this.saveContactData();
				this.focusField = fieldName;
				this.rerenderInfo();
			} else {
				new Notice("Field already exists!");
			}
		});
		modal.open();
	}

	private async openAddInteractionModal() {
		const modal = new InteractionModal(
			this.app,
			null,
			(interaction) => {
				this.addInteraction(interaction);
			}
		);
		modal.open();
	}

	public async openEditInteractionModal(
		index: number,
		interaction: Interaction
	) {
		const modal = new InteractionModal(
			this.app,
			interaction,
			async (updated) => {
				if (!Array.isArray(this.contactData.interactions)) {
					this.contactData.interactions = [];
				}
				this.contactData.interactions[index] = updated;
				await this.saveContactData();
				this.render();
			}
		);
		modal.open();
	}

	/** Delete an interaction; the notice offers to undo it */
	public async deleteInteraction(index: number) {
		const list = this.contactData.interactions;
		if (!Array.isArray(list) || !list[index]) return;
		const [removed] = list.splice(index, 1);
		await this.saveContactData();
		this.render();

		this.showUndoNotice("Interaction deleted", () => {
			if (!Array.isArray(this.contactData.interactions)) {
				this.contactData.interactions = [];
			}
			// Saving sorts the list by date again
			this.contactData.interactions.push(removed);
		});
	}

	async updateContactData(field: string, value: string) {
		this.contactData[field] = value;
		await this.saveContactData();
	}
}

/** Display text for a frontmatter value; null for nested objects */
function formatFieldValue(value: unknown): string | null {
	if (value == null) return "";
	if (["string", "number", "boolean"].includes(typeof value)) {
		return String(value).trim();
	}
	if (
		Array.isArray(value) &&
		value.every((item) => item == null || typeof item !== "object")
	) {
		return value.filter((item) => item != null).join(", ");
	}
	return null;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
