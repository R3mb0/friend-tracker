import { DropdownComponent, SearchComponent, setIcon } from "obsidian";
import type { FriendTrackerView } from "./index";
import type { ContactWithCountdown, SortConfig } from "@/types";
import type { ContactOperations } from "@/services/ContactOperations";
import { parseLocalDate, pluralize } from "@/utils/date";

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
			const when =
				days === 0
					? "today"
					: days === 1
					? "tomorrow"
					: `in ${pluralize(days, "day")}`;
			addStat("cake", `${nextBirthday.name} ${when}`, days <= 7);
		}

		// Contact you haven't been in touch with for the longest time
		const longestAgo = this.findMin(contacts, (c) =>
			c.lastInteraction === null ? null : -c.lastInteraction
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
		const headerRow = table.createEl("tr") as HTMLTableRowElement;
		const columns: Array<{
			key: keyof Omit<ContactWithCountdown, "file"> | "actions";
			label: string;
			sortable?: boolean;
		}> = [
			{ key: "name", label: "Name", sortable: true },
			{ key: "age", label: "Age", sortable: true },
			{ key: "birthday", label: "Birthday", sortable: true },
			{ key: "daysUntilBirthday", label: "Days left", sortable: true },
			{ key: "relationship", label: "Type", sortable: true },
			{
				key: "lastInteraction",
				label: "Last interaction",
				sortable: true,
			},
			{ key: "actions", label: "", sortable: false },
		];

		columns.forEach(({ key, label, sortable }) => {
			const th = headerRow.createEl("th");

			if (sortable) {
				const button = th.createEl("button", {
					cls: "friend-tracker-sort-button",
				});

				// Add text span
				button.createEl("span", { text: label });

				// Add sort indicator span
				button.createEl("span", {
					cls: "sort-indicator",
					text:
						sort.column === key
							? sort.direction === "asc"
								? "↑"
								: "↓"
							: "",
				});

				button.addEventListener("click", () => {
					if (key !== "actions") {
						this.view.handleSort(
							key as keyof Omit<ContactWithCountdown, "file">
						);
					}
				});
			} else {
				th.setText(label);
			}
		});
	}

	private renderTableRows(
		table: HTMLTableElement,
		contacts: ContactWithCountdown[]
	) {
		contacts.forEach((contact) => {
			const row = table.createEl("tr") as HTMLTableRowElement;
			this.rows.push({
				row,
				searchText: normalizeForSearch(
					`${contact.name} ${contact.relationship}`
				),
				relationship: contact.relationship.trim().toLowerCase(),
			});

			// Create name cell with click handler
			const nameCell = this.renderNameCell(contact);
			row.appendChild(nameCell); // Add the name cell to the row
			nameCell.addEventListener("click", (e) => {
				e.stopPropagation(); // Stop event from bubbling
				this.view.openContact(contact.file);
			});

			// Rest of the cells (no click handlers)
			row.createEl("td", { text: contact.age?.toString() ?? "N/A" });
			row.createEl("td", {
				text: contact.formattedBirthday || "N/A",
			});
			row.createEl("td", {
				text:
					contact.daysUntilBirthday !== null
						? pluralize(contact.daysUntilBirthday, "day")
						: "N/A",
			});
			row.createEl("td", {
				text: contact.relationship || "N/A",
				cls: "friend-tracker-relationship-cell",
			});
			row.createEl("td", {
				text: this.contactOps.formatDaysAgo(contact.lastInteraction),
			});

			// Actions cell
			const actionsCell = row.createEl("td", {
				cls: "friend-tracker-actions",
			});

			// Delete button
			const deleteButton = actionsCell.createEl("button", {
				cls: "friend-tracker-delete-button",
				attr: { "aria-label": "Remove contact" },
			});
			setIcon(deleteButton, "trash");

			deleteButton.addEventListener("click", (e) => {
				e.stopPropagation();
				this.view.openDeleteModal(contact.file);
			});
		});
	}

	private renderNameCell(contact: ContactWithCountdown): HTMLElement {
		const cell = document.createElement("td");
		cell.className = "friend-tracker-name-cell";

		if (contact.daysUntilBirthday !== null) {
			if (contact.daysUntilBirthday === 0) {
				// Birthday today - show cake
				cell.createEl("div", {
					cls: "table-birthday-indicator birthday-today",
					text: "🎂",
				});
			} else if (contact.daysUntilBirthday <= 7) {
				// Within a week - show green dot
				const dotContainer = cell.createEl("div", {
					cls: "table-birthday-status-dot",
				});
				dotContainer.createEl("div", {
					cls: "table-birthday-status-dot-inner",
				});
			}
		}

		cell.createSpan({ text: contact.name });

		return cell;
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
				const date = parseLocalDate(contact.birthday);
				return date ? (date.getMonth() + 1) * 100 + date.getDate() : null;
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
