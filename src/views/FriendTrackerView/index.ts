import {
	ItemView,
	WorkspaceLeaf,
	TAbstractFile,
	TFile,
	Platform,
	Notice,
	debounce,
} from "obsidian";
import type FriendTracker from "@/main";
import { TableView } from "./TableView";
import { VIEW_TYPE_CONTACT_PAGE } from "@/views/ContactPageView";
import type {
	SortConfig,
	SortColumn,
	ContactWithCountdown,
} from "@/types";
import { AddContactModal } from "@/modals/AddContactModal";
import { DeleteContactModal } from "@/modals/DeleteContactModal";
import { InteractionModal } from "@/modals/InteractionModal";

export const VIEW_TYPE_FRIEND_TRACKER = "friend-tracker-view";

export class FriendTrackerView extends ItemView {
	currentSort: SortConfig;
	/** Kept across refreshes so file changes don't reset the search */
	searchQuery = "";
	/** Lowercase relationship type to show, "" for all */
	relationshipFilter = "";
	private tableView: TableView;
	private isRefreshing = false;
	private refreshPending = false;

	constructor(leaf: WorkspaceLeaf, private plugin: FriendTracker) {
		super(leaf);
		this.currentSort = {
			column: this.plugin.settings.defaultSortColumn,
			direction: this.plugin.settings.defaultSortDirection,
		};
		this.tableView = new TableView(this, this.plugin.contactOperations);
	}

	public async openAddContactModal() {
		const modal = new AddContactModal(this.app, this.plugin);
		modal.open();
	}

	public handleSort(column: SortColumn) {
		if (this.currentSort.column === column) {
			this.currentSort.direction =
				this.currentSort.direction === "asc" ? "desc" : "asc";
		} else {
			this.currentSort = { column, direction: "asc" };
		}
		this.refresh();
	}

	public async openContact(file: TFile) {
		// Try to find existing contact page view
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

		// On mobile, collapse the main view after opening contact
		if (Platform.isMobile) {
			this.app.workspace.rightSplit.collapse();
		}
	}

	/** Log an interaction without opening the contact page */
	public openAddInteractionModal(contact: ContactWithCountdown) {
		new InteractionModal(
			this.app,
			null,
			async (date, text) => {
				try {
					await this.plugin.contactOperations.addInteraction(
						contact.file,
						{ date, text }
					);
					// The table refreshes itself on the file change
					new Notice(`Interaction with ${contact.name} added`);
				} catch (error) {
					console.error("Error adding interaction:", error);
					new Notice(`Could not add interaction: ${error}`);
				}
			},
			contact.name
		).open();
	}

	public async openDeleteModal(file: TFile) {
		const modal = new DeleteContactModal(this.app, file, async () => {
			await this.app.fileManager.trashFile(file);
		});
		modal.open();
	}

	getViewType(): string {
		return VIEW_TYPE_FRIEND_TRACKER;
	}

	getDisplayText(): string {
		return "Friend tracker";
	}

	async onOpen() {
		// Batch bursts of file events into a single refresh
		const scheduleRefresh = debounce(() => this.refresh(), 200, true);
		const onContactChange = (file: TAbstractFile, oldPath?: string) => {
			if (this.isInContactsFolder(file.path)) {
				scheduleRefresh();
			} else if (oldPath && this.isInContactsFolder(oldPath)) {
				scheduleRefresh();
			}
		};

		this.registerEvent(this.app.vault.on("modify", onContactChange));
		this.registerEvent(this.app.vault.on("create", onContactChange));
		this.registerEvent(this.app.vault.on("delete", onContactChange));
		this.registerEvent(this.app.vault.on("rename", onContactChange));

		// Refresh when returning to the app (e.g. after a sync on mobile)
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "visible") scheduleRefresh();
		});
		this.registerDomEvent(window, "focus", () => scheduleRefresh());

		await this.refresh();
	}

	async refresh() {
		// Don't drop refreshes requested while one is running
		if (this.isRefreshing) {
			this.refreshPending = true;
			return;
		}
		this.isRefreshing = true;

		try {
			const contacts = await this.plugin.contactOperations.getContacts();

			const container = this.containerEl.children[1] as HTMLElement;
			// Keep the scroll position across re-renders
			const scroller = container.querySelector(".friend-tracker-content");
			const scrollTop = scroller?.scrollTop ?? 0;
			const scrollLeft = scroller?.scrollLeft ?? 0;
			// Re-rendering replaces the search input; keep typing uninterrupted
			const oldSearch = this.tableView.searchInput;
			const searchFocused =
				!!oldSearch && oldSearch === document.activeElement;
			const selection = oldSearch
				? [oldSearch.selectionStart, oldSearch.selectionEnd]
				: null;

			container.empty();
			const layout = container.createDiv({
				cls: "friend-tracker-layout",
			});
			this.tableView.render(layout, contacts, this.currentSort);

			const newScroller = container.querySelector(
				".friend-tracker-content"
			);
			if (newScroller) {
				newScroller.scrollTop = scrollTop;
				newScroller.scrollLeft = scrollLeft;
			}

			const newSearch = this.tableView.searchInput;
			if (searchFocused && newSearch) {
				newSearch.focus();
				if (selection) {
					newSearch.setSelectionRange(selection[0], selection[1]);
				}
			}
		} finally {
			this.isRefreshing = false;
		}

		if (this.refreshPending) {
			this.refreshPending = false;
			await this.refresh();
		}
	}

	private isInContactsFolder(path: string): boolean {
		const contactFolder = this.plugin.settings.contactsFolder;
		return path.startsWith(contactFolder + "/");
	}
}
