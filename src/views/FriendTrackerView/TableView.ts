import { DropdownComponent, SearchComponent, setIcon } from "obsidian";
import type { FriendTrackerView } from "./index";
import type { ContactWithCountdown, SortConfig } from "@/types";
import type { ContactOperations } from "@/services/ContactOperations";
import { parseBirthday, pluralize } from "@/utils/date";
import {
	createRelationshipTag,
	formatCountdown,
	getContactStatus,
} from "@/utils/display";

type SortColumn = SortConfig["column"];

interface ContactRow {
	row: HTMLTableRowElement;
	searchText: string;
	relationship: string;
}

export class TableView {
	private rows: ContactRow[] = [];
	private noResultsEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(
		private view: FriendTrackerView,
		private contactOps: ContactOperations
	) {
		this.view.register(() => this.resizeObserver?.disconnect());
	}

	render(
		container: HTMLElement,
		contacts: ContactWithCountdown[],
		sort: SortConfig
	) {
		this.rows = [];
		this.noResultsEl = null;
		this.searchInputEl = null;

		this.renderHeader(container, contacts);
		const toolbar = this.renderToolbar(container, contacts);

		const content = container.createEl("div", {
			cls: "friend-tracker-content",
		});
		this.syncScrollbarWidth(toolbar, content);

		if (contacts.length === 0) {
			const emptyState = content.createEl("div", {
				cls: "friend-tracker-empty-state",
			});
			emptyState.createEl("p", {
				text: "No contacts found. Get started by creating your first contact!",
			});
			return;
		}

		// Create scrollable container for table
		const tableContainer = content.createEl("div", {
			cls: "friend-tracker-table-container",
		});

		// Create table for contacts
		const table = tableContainer.createEl("table", {
			cls: "friend-tracker-table",
		}) as HTMLTableElement;

		this.renderTableHeader(table, sort);
		this.renderTableRows(table, this.sortContacts(contacts, sort));

		this.noResultsEl = content.createDiv({
			cls: "friend-tracker-empty-state friend-tracker-no-results",
			text: "No contacts match your search or filter.",
		});
		this.applyFilters();
	}

	/** The search input, if rendered (used to restore focus after a refresh) */
	get searchInput(): HTMLInputElement | null {
		return this.searchInputEl;
	}

	/**
	 * Keep the toolbar aligned with the table: when the table area shows a
	 * vertical scrollbar, the table gets narrower by its width.
	 */
	private syncScrollbarWidth(toolbar: HTMLElement, scroller: HTMLElement) {
		this.resizeObserver?.disconnect();
		const update = () => {
			const width = scroller.offsetWidth - scroller.clientWidth;
			toolbar.style.setProperty(
				"--friend-tracker-scrollbar",
				`${width}px`
			);
		};
		// Fires on layout changes, including the scrollbar (dis)appearing
		this.resizeObserver = new ResizeObserver(update);
		this.resizeObserver.observe(scroller);
	}

	/** Search, relationship filter and add button between header and table */
	private renderToolbar(
		container: HTMLElement,
		contacts: ContactWithCountdown[]
	): HTMLElement {
		const toolbar = container.createDiv({
			cls: "friend-tracker-toolbar",
		});

		if (contacts.length > 0) {
			this.renderSearch(toolbar);
			this.renderRelationshipFilter(toolbar, contacts);
		}

		const addButton = toolbar.createEl("button", {
			cls: "friend-tracker-add-button mod-cta",
			attr: { "aria-label": "Add contact" },
		});
		setIcon(addButton, "user-plus");
		addButton.addEventListener("click", () =>
			this.view.openAddContactModal()
		);

		return toolbar;
	}

	private renderSearch(toolbar: HTMLElement) {
		const searchContainer = toolbar.createDiv({
			cls: "friend-tracker-search",
		});
		const search = new SearchComponent(searchContainer)
			.setPlaceholder("Search contacts")
			.setValue(this.view.searchQuery)
			.onChange((value) => {
				this.view.searchQuery = value;
				this.applyFilters();
			});
		this.searchInputEl = search.inputEl;

		search.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && search.getValue()) {
				e.preventDefault();
				search.setValue("");
				this.view.searchQuery = "";
				this.applyFilters();
			}
		});
	}

	private renderRelationshipFilter(
		toolbar: HTMLElement,
		contacts: ContactWithCountdown[]
	) {
		// Only offer relationship types that are actually in use
		const types = Array.from(
			new Set(
				contacts
					.map((contact) => contact.relationship.trim().toLowerCase())
					.filter(Boolean)
			)
		).sort((a, b) => a.localeCompare(b));

		// Reset a filter whose type no longer exists
		if (
			this.view.relationshipFilter &&
			!types.includes(this.view.relationshipFilter)
		) {
			this.view.relationshipFilter = "";
		}

		if (types.length === 0) return;

		const dropdown = new DropdownComponent(toolbar).addOption(
			"",
			"All relationships"
		);
		for (const type of types) {
			dropdown.addOption(
				type,
				type.charAt(0).toUpperCase() + type.slice(1)
			);
		}
		dropdown
			.setValue(this.view.relationshipFilter)
			.onChange((value) => {
				this.view.relationshipFilter = value;
				this.applyFilters();
			});
		dropdown.selectEl.addClass("friend-tracker-relationship-filter");
		dropdown.selectEl.setAttr("aria-label", "Filter by relationship");
	}

	/** Show only rows matching every search word and the relationship filter */
	private applyFilters() {
		const terms = normalizeForSearch(this.view.searchQuery)
			.split(/\s+/)
			.filter(Boolean);
		const relationship = this.view.relationshipFilter;

		let visibleCount = 0;
		for (const { row, searchText, relationship: rowType } of this.rows) {
			const matches =
				(!relationship || rowType === relationship) &&
				terms.every((term) => searchText.includes(term));
			row.toggleClass("friend-tracker-row-hidden", !matches);
			if (matches) visibleCount++;
		}

		this.noResultsEl?.toggleClass(
			"friend-tracker-row-hidden",
			visibleCount > 0 || this.rows.length === 0
		);
	}

	private renderHeader(
		container: HTMLElement,
		contacts: ContactWithCountdown[]
	): HTMLElement {
		const header = container.createEl("div", {
			cls: "friend-tracker-header",
		});

		header.createEl("h2", { text: "Friend tracker" });

		if (contacts.length === 0) return header;

		// At-a-glance summary below the title
		const stats = header.createDiv({ cls: "friend-tracker-stats" });
		const addStat = (icon: string, text: string, highlight = false) => {
			const stat = stats.createDiv({
				cls: `friend-tracker-stat${highlight ? " is-highlighted" : ""}`,
			});
			setIcon(stat.createSpan({ cls: "friend-tracker-stat-icon" }), icon);
			stat.createSpan({ text });
		};

		addStat("users", pluralize(contacts.length, "contact"));

		const nextBirthday = this.findMin(contacts, (c) => c.daysUntilBirthday);
		if (nextBirthday && nextBirthday.daysUntilBirthday !== null) {
			const days = nextBirthday.daysUntilBirthday;
			addStat(
				"cake",
				`${nextBirthday.name} ${formatCountdown(days)}`,
				days <= 7
			);
		}

		// Contact you haven't been in touch with for the longest time
		const longestAgo = this.findMin(contacts, (c) =>
			c.lastInteraction === null || c.deceased ? null : -c.lastInteraction
		);
		if (longestAgo && longestAgo.lastInteraction !== null) {
			addStat(
				"clock",
				`${longestAgo.name}: ${this.contactOps.formatDaysAgo(
					longestAgo.lastInteraction
				)}`
			);
		}

		return header;
	}

	/** Contact with the smallest non-null value, or null */
	private findMin(
		contacts: ContactWithCountdown[],
		getValue: (contact: ContactWithCountdown) => number | null
	): ContactWithCountdown | null {
		let best: ContactWithCountdown | null = null;
		let bestValue = Infinity;
		for (const contact of contacts) {
			const value = getValue(contact);
			if (value !== null && value < bestValue) {
				best = contact;
				bestValue = value;
			}
		}
		return best;
	}

	private renderTableHeader(table: HTMLTableElement, sort: SortConfig) {
		const headerRow = table.createEl("thead").createEl("tr");
		const columns: Array<{
			key: SortColumn | "actions";
			label: string;
			cls?: string;
		}> = [
			{ key: "name", label: "Name", cls: "friend-tracker-col-name" },
			{
				key: "age",
				label: "Age",
				cls: "friend-tracker-col-age is-numeric",
			},
			// Shows the date and the countdown; sorts by days left
			{ key: "daysUntilBirthday", label: "Birthday" },
			{
				key: "relationship",
				label: "Type",
				cls: "friend-tracker-col-type",
			},
			{ key: "lastInteraction", label: "Last interaction" },
			{ key: "actions", label: "", cls: "friend-tracker-col-actions" },
		];

		columns.forEach(({ key, label, cls }) => {
			const th = headerRow.createEl("th", { cls });
			if (key === "actions") return;

			const isActive = sort.column === key;
			if (isActive) {
				th.setAttr(
					"aria-sort",
					sort.direction === "asc" ? "ascending" : "descending"
				);
			}

			const button = th.createEl("button", {
				cls: `friend-tracker-sort-button${
					isActive ? " is-active" : ""
				}`,
			});
			button.createSpan({ text: label });
			button.createSpan({
				cls: "sort-indicator",
				text: isActive ? (sort.direction === "asc" ? "↑" : "↓") : "↕",
			});
			button.addEventListener("click", () => this.view.handleSort(key));
		});
	}

	private renderTableRows(
		table: HTMLTableElement,
		contacts: ContactWithCountdown[]
	) {
		const body = table.createEl("tbody");

		contacts.forEach((contact) => {
			const days = contact.daysUntilBirthday;
			const row = body.createEl("tr", {
				cls: "friend-tracker-row",
				attr: { tabindex: "0" },
			});
			if (contact.deceased) row.addClass("is-deceased");
			if (days === 0) row.addClass("is-birthday-today");
			else if (days !== null && days <= 7) row.addClass("is-birthday-soon");

			this.rows.push({
				row,
				searchText: normalizeForSearch(
					`${contact.name} ${contact.relationship}`
				),
				relationship: contact.relationship.trim().toLowerCase(),
			});

			// The whole row opens the contact
			row.addEventListener("click", () =>
				this.view.openContact(contact.file)
			);
			row.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && e.target === row) {
					e.preventDefault();
					this.view.openContact(contact.file);
				}
			});

			this.renderNameCell(row, contact);

			const ageCell = row.createEl("td", {
				cls: "friend-tracker-col-age is-numeric",
			});
			this.setCellValue(ageCell, contact.age?.toString() ?? null);

			this.renderBirthdayCell(row, contact);

			const typeCell = row.createEl("td", {
				cls: "friend-tracker-col-type",
			});
			if (contact.relationship) {
				createRelationshipTag(typeCell, contact.relationship);
			} else {
				this.setCellValue(typeCell, null);
			}

			this.renderLastInteractionCell(row, contact);

			// Actions cell
			const actionsCell = row.createEl("td", {
				cls: "friend-tracker-actions friend-tracker-col-actions",
			});
			const actions = actionsCell.createDiv({
				cls: "friend-tracker-row-actions",
			});

			// Log an interaction without opening the contact
			const addButton = actions.createEl("button", {
				cls: "friend-tracker-row-button",
				attr: { "aria-label": "Add interaction" },
			});
			setIcon(addButton, "calendar-plus");
			addButton.addEventListener("click", (e) => {
				e.stopPropagation();
				this.view.openAddInteractionModal(contact);
			});
			addButton.addEventListener("keydown", (e) => e.stopPropagation());

			const deleteButton = actions.createEl("button", {
				cls: "friend-tracker-row-button friend-tracker-delete-button",
				attr: { "aria-label": "Remove contact" },
			});
			setIcon(deleteButton, "trash");
			deleteButton.addEventListener("click", (e) => {
				e.stopPropagation();
				this.view.openDeleteModal(contact.file);
			});
			// Don't let Enter on the button also open the contact
			deleteButton.addEventListener("keydown", (e) => e.stopPropagation());
		});
	}

	/** Fill a cell with text, or a muted dash when the value is missing */
	private setCellValue(cell: HTMLElement, value: string | null) {
		if (value) {
			cell.setText(value);
		} else {
			cell.createSpan({ cls: "friend-tracker-empty-value", text: "–" });
		}
	}

	private renderNameCell(
		row: HTMLTableRowElement,
		contact: ContactWithCountdown
	) {
		const cell = row.createEl("td", {
			cls: "friend-tracker-name-cell friend-tracker-col-name",
		});
		const inner = cell.createDiv({ cls: "friend-tracker-name" });
		const days = contact.daysUntilBirthday;

		if (days === 0) {
			inner.createSpan({
				cls: "friend-tracker-birthday-marker is-today",
				text: "🎂",
				attr: { "aria-label": "Birthday today" },
			});
		} else if (days !== null && days <= 7) {
			inner.createSpan({
				cls: "friend-tracker-birthday-marker is-soon",
				attr: { "aria-label": "Birthday within a week" },
			});
		}

		inner.createSpan({ text: contact.name });
		if (contact.deceased) {
			inner.createSpan({
				cls: "friend-tracker-deceased-mark",
				text: "†",
				attr: { "aria-label": "Deceased" },
			});
		}
	}

	private renderBirthdayCell(
		row: HTMLTableRowElement,
		contact: ContactWithCountdown
	) {
		const cell = row.createEl("td");
		const days = contact.daysUntilBirthday;
		if (!contact.formattedBirthday || days === null) {
			this.setCellValue(cell, contact.formattedBirthday || null);
			return;
		}

		cell.createSpan({ text: contact.formattedBirthday });
		cell.createSpan({
			cls: "friend-tracker-countdown",
			text: ` · ${formatCountdown(days)}`,
		});
	}

	private renderLastInteractionCell(
		row: HTMLTableRowElement,
		contact: ContactWithCountdown
	) {
		const cell = row.createEl("td");
		const days = contact.lastInteraction;
		if (days === null) {
			this.setCellValue(cell, null);
			return;
		}

		// Color by how long ago the last contact was (not for the deceased)
		const status = contact.deceased ? "" : getContactStatus(days);
		const value = cell.createSpan({
			cls: `friend-tracker-last-interaction ${status}`,
		});
		value.createSpan({ cls: "friend-tracker-status-dot" });
		value.createSpan({ text: this.contactOps.formatDaysAgo(days) });
	}

	private sortContacts(contacts: ContactWithCountdown[], sort: SortConfig) {
		const direction = sort.direction === "asc" ? 1 : -1;

		return [...contacts].sort((a, b) => {
			const aValue = this.getSortValue(a, sort.column);
			const bValue = this.getSortValue(b, sort.column);

			// Empty values always go last, regardless of direction
			if (aValue === null && bValue === null) return 0;
			if (aValue === null) return 1;
			if (bValue === null) return -1;

			if (typeof aValue === "string" && typeof bValue === "string") {
				return (
					aValue.localeCompare(bValue, undefined, {
						sensitivity: "base",
						numeric: true,
					}) * direction
				);
			}
			return ((aValue as number) - (bValue as number)) * direction;
		});
	}

	private getSortValue(
		contact: ContactWithCountdown,
		column: SortColumn
	): string | number | null {
		switch (column) {
			case "birthday": {
				// Sort by month and day, ignoring the year
				const parts = parseBirthday(contact.birthday);
				return parts ? parts.month * 100 + parts.day : null;
			}
			case "formattedBirthday":
				return this.getSortValue(contact, "birthday");
			case "age":
			case "daysUntilBirthday":
			case "lastInteraction":
				return contact[column];
			default:
				return contact[column] || null;
		}
	}
}

/** Lowercase and strip accents so "rene" finds "René" */
function normalizeForSearch(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}
