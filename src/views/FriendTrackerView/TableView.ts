import { setIcon } from "obsidian";
import type { FriendTrackerView } from "./index";
import type { ContactWithCountdown, SortConfig } from "@/types";
import type { ContactOperations } from "@/services/ContactOperations";
import { parseLocalDate, pluralize } from "@/utils/date";

type SortColumn = SortConfig["column"];

export class TableView {
	constructor(
		private view: FriendTrackerView,
		private contactOps: ContactOperations
	) {}

	render(
		container: HTMLElement,
		contacts: ContactWithCountdown[],
		sort: SortConfig
	) {
		// Create header and add contact button container
		const headerContainer = container.createEl("div", {
			cls: "friend-tracker-header",
		});
		headerContainer.createEl("h2", { text: "Friend tracker" });

		const addButton = headerContainer.createEl("button", {
			text: "Add contact",
			cls: "friend-tracker-button button-outlined",
		});
		addButton.addEventListener("click", () =>
			this.view.openAddContactModal()
		);

		const content = container.createEl("div", {
			cls: "friend-tracker-content",
		});

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
