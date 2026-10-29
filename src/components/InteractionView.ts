import { setIcon } from "obsidian";
import type { ContactPageView } from "@/views/ContactPageView";
import type { Interaction } from "@/types";
import { parseLocalDate } from "@/utils/date";

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

		sortedInteractions.forEach(({ interaction, index }) => {
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

		// Date
		interactionEl.createEl("div", {
			cls: "contact-interaction-date",
			text: formattedDate,
		});

		// Text
		interactionEl.createEl("div", {
			cls: "contact-interaction-text",
			text: interaction.text,
		});

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

		// Delete button
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
