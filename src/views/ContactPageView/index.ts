import {
	ItemView,
	WorkspaceLeaf,
	Notice,
	TFile,
	setIcon,
	MarkdownRenderer,
	ViewStateResult,
} from "obsidian";
import type FriendTracker from "@/main";
import { createRelationshipInput } from "@/components/ContactFields";
import { InteractionView } from "@/components/InteractionView";
import type { ContactData, Interaction } from "@/types";
import { AddFieldModal } from "@/modals/AddFieldModal";
import { InteractionModal } from "@/modals/InteractionModal";
import {
	SPECIAL_INPUT_FIELDS,
	STANDARD_FIELDS,
	SYSTEM_FIELDS,
} from "@/constants";
import { splitFrontmatter } from "@/utils/frontmatter";
import { parseLocalDate } from "@/utils/date";
import { getContactFilePath, sanitizeFileName } from "@/utils/file";

export const VIEW_TYPE_CONTACT_PAGE = "contact-page-view";

export class ContactPageView extends ItemView {
	private _file: TFile | null = null;
	private contactData: ContactData = {};
	private lastContent = "";
	private pendingSaves = 0;
	private interactionView: InteractionView;
	public plugin: FriendTracker;
	private activeTab: "notes" | "interactions" | "markdown";

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
	}

	getViewType(): string {
		return VIEW_TYPE_CONTACT_PAGE;
	}

	getDisplayText(): string {
		return this._file?.basename || "Contact";
	}

	get file() {
		return this._file;
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

		if (!this.contactData || !this.contactData.name) {
			container.createEl("div", {
				text: "No contact data available",
				cls: "contact-empty-state",
			});
			return;
		}

		// Header with name
		const header = container.createEl("div", {
			cls: "contact-page-header",
		});
		const nameContainer = header.createEl("div", {
			cls: "contact-name-container",
		});
		this.renderNameSection(nameContainer);

		// Info section (always visible)
		const infoSection = container.createEl("div", {
			cls: "contact-info-section",
		});
		this.renderInfoSection(infoSection);

		// Tabs container
		const tabsContainer = container.createEl("div", {
			cls: "contact-tabs",
		});

		const tabs = [
			{ id: "notes" as const, icon: "pencil", label: "Notes" },
			{
				id: "interactions" as const,
				icon: "clock",
				label: "Interactions",
			},
			{
				id: "markdown" as const,
				icon: "document",
				label: "Markdown",
			},
		];

		tabs.forEach((tab) => {
			const tabButton = tabsContainer.createEl("button", {
				cls: `contact-tab ${this.activeTab === tab.id ? "active" : ""}`,
			});

			setIcon(tabButton, tab.icon);
			tabButton.createSpan({ text: tab.label });

			tabButton.addEventListener("click", async () => {
				this.activeTab = tab.id;
				this.plugin.settings.defaultActiveTab = tab.id;
				await this.plugin.saveSettings();
				this.render();
			});
		});

		// Content container for tab content
		const contentContainer = container.createEl("div", {
			cls: "contact-content",
		});

		// Render content based on active tab
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

	private renderNameSection(container: HTMLElement) {
		const nameSection = container.createEl("div", {
			cls: "contact-name-section",
		});

		const nameDisplay = nameSection.createEl("div", {
			cls: "contact-name-display",
		});

		const editContainer = nameDisplay.createEl("div", {
			cls: "contact-name-row",
		});

		const nameText = editContainer.createEl("h1", {
			text: this.contactData.name || "Unnamed Contact",
		});

		const nameInput = editContainer.createEl("input", {
			type: "text",
			value: this.contactData.name || "",
			placeholder: "Contact name",
			cls: "contact-name-input",
		});

		const editButton = editContainer.createEl("button", {
			cls: "friend-tracker-button button-icon contact-name-edit",
		});
		setIcon(editButton, "pencil");

		// Add age display if birthday exists
		const birthDate = parseLocalDate(this.contactData.birthday);
		if (this.contactData.birthday && birthDate) {
			const ageText = this.plugin.contactOperations.calculateDetailedAge(
				this.contactData.birthday
			);
			nameDisplay.createEl("span", {
				text: ageText,
				cls: "contact-age-display",
			});

			// Add both zodiac displays
			const year = birthDate.getFullYear();
			const month = birthDate.getMonth() + 1;
			const day = birthDate.getDate();
			const animals = [
				"Rat",
				"Ox",
				"Tiger",
				"Rabbit",
				"Dragon",
				"Snake",
				"Horse",
				"Goat",
				"Monkey",
				"Rooster",
				"Dog",
				"Pig",
			];
			const chineseZodiac = animals[(((year - 4) % 12) + 12) % 12];
			const westernZodiac = this.getZodiacSign(month, day);

			const season = this.getSeason(month, day);
			const birthstone = this.getBirthstone(month);

			nameDisplay.createEl("span", {
				text: `${westernZodiac} • Year of the ${chineseZodiac}`,
				cls: "contact-age-display",
			});
			nameDisplay.createEl("span", {
				text: `${season} baby • Birthstone: ${birthstone}`,
				cls: "contact-age-display",
			});

			const daysUntil = this.calculateDaysUntilBirthday(
				this.contactData.birthday
			);
			if (daysUntil !== null) {
				const countdownContainer = nameDisplay.createEl("div", {
					cls: "contact-birthday-countdown",
				});

				if (daysUntil === 0) {
					// Birthday today - show cake
					countdownContainer.createEl("div", {
						cls: "table-birthday-indicator birthday-today",
						text: "🎂",
					});
					countdownContainer.createSpan({
						text: "Birthday today!",
					});
				} else {
					// Show dot if within a week
					if (daysUntil <= 7) {
						const dotContainer = countdownContainer.createEl(
							"div",
							{
								cls: "birthday-status-dot",
							}
						);
						dotContainer.createEl("div", {
							cls: "birthday-status-dot-inner",
						});
					}

					const daysText =
						daysUntil === 1
							? "Birthday tomorrow!"
							: `${daysUntil} days until birthday`;

					countdownContainer.createSpan({
						text: daysText,
					});
				}
			}
		}

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
				const currentName = this.contactData.name ?? "";

				if (!newName || newName === currentName) {
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
				nameText.textContent =
					this.contactData.name || "Unnamed Contact";
				setEditing(false);
				isSaving = false;
			}
		};

		nameInput.addEventListener("change", saveNameChange);
	}

	private calculateDaysUntilBirthday(birthday: string): number | null {
		return this.plugin.contactOperations.calculateDaysUntilBirthday(
			birthday
		);
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

	private renderInfoSection(container: HTMLElement) {
		const infoSection = container.createEl("div", {
			cls: "contact-info-section",
		});

		const fieldsContainer = infoSection.createEl("div", {
			cls: "contact-fields-container",
		});

		const renderViewMode = () => {
			fieldsContainer.empty();
			fieldsContainer.classList.remove("editing");

			// Render each field as read-only text
			Object.entries(this.contactData)
				.filter(
					([key]) =>
						![
							"name",
							"notes",
							"interactions",
							"created",
							"updated",
						].includes(key)
				)
				.forEach(([key, value]) => {
					if (!value) return; // Skip empty values

					const field = fieldsContainer.createEl("div", {
						cls: "contact-field-view",
						attr: {
							"data-field": key.toLowerCase(),
						},
					});

					field.createEl("div", {
						cls: "contact-field-label",
						text: key,
					});

					// Format birthday in view mode
					const ops = this.plugin.contactOperations;
					const displayValue =
						key === "birthday"
							? ops.formatBirthday(String(value), true)
							: String(value);

					field.createEl("div", {
						cls: "contact-field-value",
						text: displayValue as string,
					});
				});

			// Add edit button at the bottom
			const editButton = fieldsContainer.createEl("button", {
				cls: "friend-tracker-button",
				text: "Edit",
			});

			editButton.addEventListener("click", () => {
				renderEditMode();
			});
		};

		const renderEditMode = () => {
			fieldsContainer.empty();
			fieldsContainer.classList.add("editing");

			// Standard fields first
			Object.values(STANDARD_FIELDS)
				.filter((field) => !SYSTEM_FIELDS.includes(field))
				.forEach((field) => {
					this.createInfoField(
						fieldsContainer,
						field,
						this.contactData[field]
					);
				});

			// Then custom fields
			const excludedFields = [
				...SYSTEM_FIELDS,
				...Object.values(STANDARD_FIELDS).map((f) => f.toLowerCase()),
				"created",
				"updated",
			];
			Object.entries(this.contactData)
				.filter(([key]) => !excludedFields.includes(key.toLowerCase()))
				.forEach(([key, value]) => {
					this.createInfoField(fieldsContainer, key, value);
				});

			// Add custom field button
			const addFieldButton = fieldsContainer.createEl("button", {
				cls: "friend-tracker-button button-outlined",
				text: "Add custom field",
			});
			addFieldButton.addEventListener("click", () => {
				this.openAddFieldModal();
			});

			// Add done button
			const doneButton = fieldsContainer.createEl("button", {
				cls: "friend-tracker-button button-primary button-full-width",
				text: "Done",
			});

			doneButton.addEventListener("click", async () => {
				await this.saveContactData();
				renderViewMode();
			});
		};

		// Initial render in view mode
		renderViewMode();
	}

	private createInfoField(
		container: HTMLElement,
		field: string,
		value: unknown
	) {
		const fieldContainer = container.createEl("div", {
			cls: "contact-field",
		});

		fieldContainer.createEl("label", {
			text: field,
		});

		const stringValue = value == null ? "" : String(value);

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
				placeholder: `Enter ${field.toLowerCase()}`,
				value: stringValue,
			},
		});

		input.addEventListener("change", () => {
			this.updateContactData(field, input.value);
		});
	}

	private renderNotesSection(container: HTMLElement) {
		const notesSection = container.createEl("div", {
			cls: "contact-notes-section",
		});

		const notesInput = notesSection.createEl("textarea", {
			cls: "contact-notes-input",
			attr: {
				placeholder:
					"Add notes about family members, parents' names, or anything else you want to remember...",
			},
		});
		notesInput.value = this.contactData.notes || "";

		notesInput.addEventListener("input", () => {
			this.adjustTextareaHeight(notesInput);
		});

		setTimeout(() => {
			this.adjustTextareaHeight(notesInput);
		}, 0);

		notesInput.addEventListener("change", async () => {
			if (!this._file) return;
			this.contactData.notes = notesInput.value;
			await this.saveContactData();
		});
	}

	private renderInteractionsSection(container: HTMLElement) {
		const interactions = container.createEl("div", {
			cls: "contact-interactions",
		});

		const headerContainer = interactions.createEl("div", {
			cls: "contact-interactions-header",
		});

		// Add helper text if no interactions
		if (
			!Array.isArray(this.contactData.interactions) ||
			this.contactData.interactions.length === 0
		) {
			headerContainer.createEl("div", {
				cls: "section-helper-text",
				text: "Log meaningful touchpoints like meetings, calls, or important conversations to help maintain strong relationships",
			});
		}

		const addButton = headerContainer.createEl("button", {
			cls: "friend-tracker-button button-align-right",
			text: "Add interaction",
		});
		addButton.addEventListener("click", () => {
			this.openAddInteractionModal();
		});

		if (Array.isArray(this.contactData.interactions)) {
			this.interactionView.render(
				interactions,
				this.contactData.interactions
			);
		}
	}

	private async renderExtrasSection(container: HTMLElement) {
		const extrasSection = container.createEl("div", {
			cls: "contact-extras-section",
		});

		if (!this._file) return;

		const headerContainer = extrasSection.createEl("div", {
			cls: "contact-extras-header",
		});

		let extrasContent = "";
		try {
			const content = await this.app.vault.read(this._file);
			extrasContent = splitFrontmatter(content).body;
		} catch (error) {
			console.error(
				`Error reading extras from file ${this._file.path}:`,
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

		editButton.addEventListener("click", () => {
			this.app.workspace.openLinkText(this._file?.path || "", "", true);
		});

		if (!extrasContent.trim()) return;

		const contentDiv = extrasSection.createEl("div", {
			cls: "contact-extras-content",
		});

		await MarkdownRenderer.render(
			this.app,
			extrasContent,
			contentDiv,
			this._file.path,
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
					this._file?.path || "",
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

	async saveContactData() {
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
				this.render();
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
			async (date: string, text: string) => {
				if (!Array.isArray(this.contactData.interactions)) {
					this.contactData.interactions = [];
				}
				this.contactData.interactions.push({ date, text });
				await this.saveContactData();
				this.render();
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
			async (date: string, text: string) => {
				if (!Array.isArray(this.contactData.interactions)) {
					this.contactData.interactions = [];
				}
				this.contactData.interactions[index] = { date, text };
				await this.saveContactData();
				this.render();
			}
		);
		modal.open();
	}

	public async deleteInteraction(index: number) {
		if (!Array.isArray(this.contactData.interactions)) return;
		this.contactData.interactions.splice(index, 1);
		await this.saveContactData();
		this.render();
	}

	async updateContactData(field: string, value: string) {
		this.contactData[field] = value;
		await this.saveContactData();
	}
}
