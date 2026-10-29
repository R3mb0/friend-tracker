import { setIcon } from "obsidian";
import type { ContactPageView } from "@/views/ContactPageView";
import type { Interaction } from "@/types";
import { getInteractionType } from "@/constants";
import { getDailyNote } from "@/utils/dailyNotes";
import { daysBetween, getToday, parseLocalDate } from "@/utils/date";

// Longer lists get month headings
const GROUP_BY_MONTH_FROM = 8;
const MONTH_FORMAT: Intl.DateTimeFormatOptions = {
	month: "long",
	year: "numeric",
};

export class InteractionView {
	constructor(private view: ContactPageView) {}

	render(container: HTMLElement, interactions: Interaction[]) {
		const interactionsList = container.createEl("div", {
			cls: "contact-interactions-list",
		});

		// Keep the original index so edit/delete target the stored entry
		const sortedInteractions = interactions
			.map((interaction, index) => ({ interaction, index }))
			.sort(
				(a, b) =>
					getTime(b.interaction.date) - getTime(a.interaction.date)
			);

		const groupByMonth = sortedInteractions.length >= GROUP_BY_MONTH_FROM;
		let currentGroup = "";

		sortedInteractions.forEach(({ interaction, index }) => {
			if (groupByMonth) {
				const date = parseLocalDate(interaction.date);
				const group = date
					? date.toLocaleDateString(undefined, MONTH_FORMAT)
					: "No date";
				if (group !== currentGroup) {
					currentGroup = group;
					interactionsList.createDiv({
						cls: "contact-interaction-group",
						text: group,
					});
				}
			}
			this.createInteractionItem(interactionsList, interaction, index);
		});
	}

	private createInteractionItem(
		container: HTMLElement,
		interaction: Interaction,
		index: number
	) {
		const interactionEl = container.createEl("div", {
			cls: "contact-interaction-item",
		});

		const date = parseLocalDate(interaction.date);
		const dateFormat: Intl.DateTimeFormatOptions = {
			year: "numeric",
			month: "short",
			day: "numeric",
		};
		const formattedDate = date
			? date.toLocaleDateString(undefined, dateFormat)
			: String(interaction.date ?? "");

		// Date with relative time below it
		const dateEl = interactionEl.createEl("div", {
			cls: "contact-interaction-date",
		});
		// Link the date to the daily note of that day, if there is one
		const dailyNote = getDailyNote(this.view.app, interaction.date);
		if (dailyNote) {
			const link = dateEl.createEl("a", {
				cls: "contact-interaction-daily-link",
				text: formattedDate,
				href: "#",
				attr: { "aria-label": `Open daily note ${dailyNote.basename}` },
			});
			// New tab, so the contact page stays open
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.view.app.workspace.getLeaf("tab").openFile(dailyNote);
			});
		} else {
			dateEl.createDiv({ text: formattedDate });
		}
		if (date) {
			dateEl.createDiv({
				cls: "contact-interaction-relative",
				text: this.view.plugin.contactOperations.formatDaysAgo(
					daysBetween(date, getToday())
				),
			});
		}

		// Text, with the type as icon in front
		const textEl = interactionEl.createEl("div", {
			cls: "contact-interaction-text",
		});
		const type = getInteractionType(interaction.type);
		if (type) {
			const icon = textEl.createSpan({
				cls: "contact-interaction-type",
				attr: { "aria-label": type.label },
			});
			setIcon(icon, type.icon);
		}
		textEl.createSpan({ text: interaction.text });

		// Actions
		const actions = interactionEl.createEl("div", {
			cls: "contact-interaction-actions",
		});

		// Edit button
		const editBtn = actions.createEl("button", {
			cls: "friend-tracker-button button-icon",
			attr: { "aria-label": "Edit interaction" },
		});
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("click", () => {
			this.view.openEditInteractionModal(index, interaction);
		});

		// Delete button (can be undone from the notice)
		const deleteBtn = actions.createEl("button", {
			cls: "friend-tracker-button button-icon button-danger",
			attr: { "aria-label": "Delete interaction" },
		});
		setIcon(deleteBtn, "trash");
		deleteBtn.addEventListener("click", () => {
			this.view.deleteInteraction(index);
		});
	}
}

function getTime(date: unknown): number {
	return parseLocalDate(date)?.getTime() ?? 0;
}
