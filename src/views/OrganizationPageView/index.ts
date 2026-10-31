import {
	ItemView,
	Menu,
	Notice,
	TFile,
	ViewStateResult,
	WorkspaceLeaf,
	debounce,
	Debouncer,
	setIcon,
} from "obsidian";
import type FriendTracker from "@/main";
import { ConfirmModal } from "@/modals/BulkModals";
import {
	createMiniNetworkState,
	MiniNetworkState,
	renderMiniNetwork,
} from "@/components/MiniNetwork";
import { RoleModal } from "@/modals/OrganizationModal";
import { splitFrontmatter } from "@/utils/frontmatter";
import { getContactFilePath, sanitizeFileName } from "@/utils/file";
import { pluralize } from "@/utils/date";
import { createAddButton } from "@/utils/display";

export const VIEW_TYPE_ORGANIZATION_PAGE = "friend-tracker-organization-view";

// Kinds offered in the details; stored lowercase in "kind"
const ORGANIZATION_KINDS = [
	"company",
	"club",
	"school",
	"university",
	"association",
	"other",
];

interface DetailField {
	key: string;
	label: string;
	icon: string;
	type: string;
}

const DETAIL_FIELDS: DetailField[] = [
	{ key: "website", label: "Website", icon: "globe", type: "url" },
	{ key: "phone", label: "Phone", icon: "phone", type: "tel" },
	{ key: "email", label: "Email", icon: "mail", type: "email" },
	{ key: "address", label: "Address", icon: "map-pin", type: "text" },
];

// Notes are saved this long after the last keystroke
const NOTES_SAVE_DELAY = 1000;

type Member = { file: TFile; name: string; role: string };

/** Profile page of an organization (company, club, ...) */
export class OrganizationPageView extends ItemView {
	private _file: TFile | null = null;
	private data: Record<string, unknown> = {};
	private lastContent = "";
	private pendingSaves = 0;
	private editing = false;
	// Kinds shown in the mini network; kept while the page is open
	private networkState: MiniNetworkState = createMiniNetworkState();
	private saveNotesDebounced: Debouncer<[], void>;
	// Re-render when member contacts change
	private scheduleRender: Debouncer<[], void>;

	constructor(leaf: WorkspaceLeaf, private plugin: FriendTracker) {
		super(leaf);
		this.saveNotesDebounced = debounce(
			() => {
				this.save();
			},
			NOTES_SAVE_DELAY,
			true
		);
		this.scheduleRender = debounce(() => this.render(), 300, true);
	}

	getViewType(): string {
		return VIEW_TYPE_ORGANIZATION_PAGE;
	}

	getDisplayText(): string {
		return this._file?.basename || "Organization";
	}

	getIcon(): string {
		return "building-2";
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
		if (file) await this.setFile(file);
		await super.setState(state, result);
	}

	getState() {
		return {
			type: VIEW_TYPE_ORGANIZATION_PAGE,
			filePath: this._file?.path,
		};
	}

	async onOpen() {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile)) return;
				if (file === this._file) {
					if (this.pendingSaves === 0) this.reloadIfChanged();
				} else if (
					file.parent?.path === this.plugin.settings.contactsFolder
				) {
					// A contact changed; its membership may have too
					this.scheduleRender();
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
		this.saveNotesDebounced.run();
	}

	async setFile(file: TFile) {
		if (this._file && this._file !== file) {
			this.saveNotesDebounced.run();
			this.editing = false;
		}
		this._file = file;
		await this.loadFile(file);
		if (this._file === file) this.render();
	}

	private async loadFile(file: TFile) {
		try {
			const content = await this.app.vault.read(file);
			this.lastContent = content;
			this.data = splitFrontmatter(content).frontmatter ?? {};
		} catch (error) {
			console.error(`Error reading organization ${file.path}:`, error);
			this.data = {};
		}
	}

	private async reloadIfChanged() {
		const file = this._file;
		if (!file) return;
		const content = await this.app.vault.read(file);
		if (this._file !== file || content === this.lastContent) return;
		await this.loadFile(file);
		this.render();
	}

	/** Write `data` to the frontmatter; `removedKeys` are deleted */
	private async save(removedKeys: string[] = []) {
		const file = this._file;
		if (!file) return;
		this.pendingSaves++;
		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter) => {
					Object.assign(frontmatter, this.data);
					for (const key of removedKeys) delete frontmatter[key];
				}
			);
			this.lastContent = await this.app.vault.read(file);
		} finally {
			this.pendingSaves--;
		}
	}

	private text(key: string): string {
		const value = this.data[key];
		return typeof value === "string" || typeof value === "number"
			? String(value).trim()
			: "";
	}

	async render() {
		const file = this._file;
		const container = this.containerEl.children[1] as HTMLElement;
		if (!file) {
			container.empty();
			container.createDiv({
				cls: "contact-empty-state",
				text: "No organization selected",
			});
			return;
		}

		// Load members first so the page doesn't flicker while rendering
		const members = await this.plugin.contactOperations.getMembers(file);
		if (this._file !== file) return;

		container.empty();
		container.addClass("contact-page", "organization-page");

		this.renderHeader(container, file, members);
		this.renderDetails(container.createDiv({ cls: "contact-info-section" }));
		renderMiniNetwork(
			container.createDiv({
				cls: "contact-connections contact-network",
			}),
			this.plugin,
			file,
			this.networkState
		);
		this.renderMembers(
			container.createDiv({
				cls: "contact-connections organization-members",
			}),
			file,
			members
		);
		this.renderNotes(container);
	}

	// ---------------------------------------------------------------------
	// Header
	// ---------------------------------------------------------------------

	private renderHeader(container: HTMLElement, file: TFile, members: Member[]) {
		const header = container.createDiv({ cls: "contact-page-header" });
		const row = header.createDiv({ cls: "contact-name-row" });
		setIcon(row.createSpan({ cls: "organization-header-icon" }), "building-2");
		const title = row.createEl("h1", { text: file.basename });

		const renameButton = row.createEl("button", {
			cls: "friend-tracker-button button-icon contact-name-edit",
			attr: { "aria-label": "Rename organization" },
		});
		setIcon(renameButton, "pencil");
		renameButton.addEventListener("click", () =>
			this.startRename(title, file)
		);

		const menuButton = row.createEl("button", {
			cls: "clickable-icon contact-menu-button",
			attr: { "aria-label": "More options" },
		});
		setIcon(menuButton, "more-vertical");
		menuButton.addEventListener("click", (e) => this.openMenu(e, file));

		const facts = header.createDiv({ cls: "contact-facts" });
		const kind = this.text("kind");
		if (kind) {
			facts.createSpan({
				cls: "friend-tracker-tag is-blue",
				text: kind,
			});
		}
		const addFact = (icon: string, text: string) => {
			const fact = facts.createDiv({ cls: "contact-fact" });
			setIcon(fact.createSpan({ cls: "contact-fact-icon" }), icon);
			fact.createSpan({ text });
			return fact;
		};
		addFact("users", pluralize(members.length, "member"));

		const website = this.text("website");
		if (website) {
			const fact = addFact("globe", "");
			fact.lastElementChild?.remove();
			fact.createEl("a", {
				text: website.replace(/^https?:\/\//, ""),
				href: toUrl(website),
			});
		}
	}

	/** Rename the note (and with it every link to it) */
	private startRename(title: HTMLElement, file: TFile) {
		const input = createEl("input", {
			cls: "contact-name-input editing",
			attr: { type: "text", value: file.basename },
		});
		title.replaceWith(input);
		input.focus();
		input.select();

		let done = false;
		const finish = async (save: boolean) => {
			if (done) return;
			done = true;
			const name = input.value.trim();
			if (!save || !name || name === file.basename) {
				this.render();
				return;
			}
			if (!sanitizeFileName(name)) {
				new Notice("Please enter a name with valid characters");
				this.render();
				return;
			}
			const newPath = getContactFilePath(file.parent?.path ?? "", name);
			if (this.app.vault.getAbstractFileByPath(newPath)) {
				new Notice(`"${name}" already exists`);
				this.render();
				return;
			}
			// Obsidian updates links to the file (incl. the contacts' ones)
			await this.app.fileManager.renameFile(file, newPath);
			this.render();
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

	private openMenu(event: MouseEvent, file: TFile) {
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
		menu.addItem((item) =>
			item
				.setTitle("Delete organization")
				.setIcon("trash")
				.onClick(() =>
					new ConfirmModal(
						this.app,
						`Delete ${file.basename}?`,
						"The note will be moved to the trash. Contacts keep their (then broken) link to it.",
						"Delete",
						() => this.app.fileManager.trashFile(file)
					).open()
				)
		);
		menu.showAtMouseEvent(event);
	}

	// ---------------------------------------------------------------------
	// Details
	// ---------------------------------------------------------------------

	private renderDetails(section: HTMLElement) {
		section.empty();
		const fields = section.createDiv({ cls: "contact-fields-container" });

		if (this.editing) {
			fields.addClass("editing");
			this.renderKindField(fields);
			for (const field of DETAIL_FIELDS) {
				const row = fields.createDiv({ cls: "contact-field" });
				row.createEl("label", { text: field.label });
				const input = row.createEl("input", {
					cls: "contact-field-input",
					attr: {
						type: field.type,
						value: this.text(field.key),
						placeholder: `Enter ${field.label.toLowerCase()}`,
					},
				});
				input.addEventListener("change", () =>
					this.setField(field.key, input.value.trim())
				);
			}
			const done = section.createEl("button", {
				cls: "friend-tracker-button button-primary",
				text: "Done",
			});
			done.addEventListener("click", () => {
				this.editing = false;
				this.render();
			});
			return;
		}

		for (const field of DETAIL_FIELDS) {
			const value = this.text(field.key);
			const row = fields.createDiv({ cls: "contact-field-view" });
			const label = row.createDiv({ cls: "contact-field-label" });
			setIcon(label.createSpan({ cls: "contact-field-icon" }), field.icon);
			label.createSpan({ text: field.label });
			const valueEl = row.createDiv({ cls: "contact-field-value" });

			if (!value) {
				createAddButton(valueEl, `Add ${field.label.toLowerCase()}`, () => {
					this.editing = true;
					this.renderDetails(section);
				});
				continue;
			}
			if (field.key === "website") {
				valueEl.createEl("a", { text: value, href: toUrl(value) });
			} else if (field.key === "phone") {
				valueEl.createEl("a", {
					text: value,
					href: `tel:${value.replace(/[^\d+]/g, "")}`,
				});
			} else if (field.key === "email") {
				valueEl.createEl("a", { text: value, href: `mailto:${value}` });
			} else {
				valueEl.setText(value);
			}
		}

		const edit = section.createEl("button", {
			cls: "friend-tracker-button contact-edit-details",
		});
		setIcon(edit.createSpan(), "pencil");
		edit.createSpan({ text: "Edit details" });
		edit.addEventListener("click", () => {
			this.editing = true;
			this.renderDetails(section);
		});
	}

	private renderKindField(container: HTMLElement) {
		const row = container.createDiv({ cls: "contact-field" });
		row.createEl("label", { text: "Kind" });
		const select = row.createEl("select", {
			cls: "dropdown contact-field-input",
		});
		select.createEl("option", { text: "–", value: "" });
		const current = this.text("kind").toLowerCase();
		const kinds = ORGANIZATION_KINDS.includes(current) || !current
			? ORGANIZATION_KINDS
			: [...ORGANIZATION_KINDS, current];
		for (const kind of kinds) {
			select.createEl("option", {
				text: kind.charAt(0).toUpperCase() + kind.slice(1),
				value: kind,
			});
		}
		select.value = current;
		select.addEventListener("change", () =>
			this.setField("kind", select.value)
		);
	}

	private async setField(key: string, value: string) {
		if (value) {
			this.data[key] = value;
			await this.save();
		} else {
			delete this.data[key];
			await this.save([key]);
		}
	}

	// ---------------------------------------------------------------------
	// Members
	// ---------------------------------------------------------------------

	private renderMembers(section: HTMLElement, file: TFile, members: Member[]) {
		const header = section.createDiv({ cls: "contact-connections-header" });
		header.createEl("h3", {
			text: `Members (${members.length})`,
		});

		const list = section.createDiv({ cls: "contact-connections-list" });
		for (const member of members) {
			const item = list.createDiv({ cls: "contact-connection" });
			const link = item.createEl("a", {
				cls: "contact-connection-name",
				text: member.name,
				href: "#",
			});
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.plugin.openContact(member.file);
			});

			const editRole = () =>
				new RoleModal(
					this.app,
					`Role of ${member.name}`,
					member.role,
					async (newRole) => {
						await this.plugin.contactOperations.setMembership(
							member.file,
							file,
							newRole
						);
						this.render();
					}
				).open();

			if (member.role) {
				// The role itself is clickable to change it
				const role = item.createEl("button", {
					cls: "organization-member-role",
					text: member.role,
					attr: { "aria-label": `Edit role of ${member.name}` },
				});
				role.addEventListener("click", editRole);
			} else {
				// Same "+ Add …" chip as elsewhere, shown on hover
				createAddButton(item, "Add role", editRole).addClass(
					"organization-member-add-role"
				);
			}

			const remove = item.createEl("button", {
				cls: "clickable-icon contact-connection-remove",
				attr: { "aria-label": `Remove ${member.name}` },
			});
			setIcon(remove, "x");
			remove.addEventListener("click", async () => {
				await this.plugin.contactOperations.removeMembership(
					member.file,
					file
				);
				this.render();
				new Notice(`${member.name} removed from ${file.basename}`);
			});
		}

		// Same "+ Add …" chip as for empty fields and relatives
		createAddButton(list.createDiv(), "Add member", () =>
			this.addMember(file)
		);
	}

	private addMember(file: TFile) {
		this.plugin.chooseContact(`Add member to ${file.basename}`, (contact) =>
			new RoleModal(
				this.app,
				`${contact.name} at ${file.basename}`,
				"",
				async (role) => {
					await this.plugin.contactOperations.setMembership(
						contact.file,
						file,
						role
					);
					this.render();
				}
			).open()
		);
	}

	// ---------------------------------------------------------------------
	// Notes
	// ---------------------------------------------------------------------

	private renderNotes(container: HTMLElement) {
		const section = container.createDiv({ cls: "contact-notes-section" });
		const header = section.createDiv({ cls: "contact-note-header" });
		setIcon(header.createSpan({ cls: "contact-note-icon" }), "info");
		header.createEl("h3", { cls: "contact-note-title", text: "Notes" });

		const textarea = section.createEl("textarea", {
			cls: "contact-notes-input",
			attr: { placeholder: "Anything worth remembering about it..." },
		});
		textarea.value = this.text("notes");
		textarea.addEventListener("input", () => {
			this.data.notes = textarea.value;
			this.saveNotesDebounced();
		});
		textarea.addEventListener("blur", () => this.saveNotesDebounced.run());
	}
}

/** "acme.com" -> "https://acme.com" */
function toUrl(value: string): string {
	return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}
