import { TFile } from "obsidian";
import type FriendTracker from "@/main";
import type { ContactWithCountdown, Interaction } from "@/types";
import { splitFrontmatter } from "@/utils/frontmatter";
import { daysBetween, getToday, parseLocalDate, pluralize } from "@/utils/date";

export class ContactOperations {
	constructor(private plugin: FriendTracker) {}

	async getContacts(): Promise<ContactWithCountdown[]> {
		const folder = this.plugin.settings.contactsFolder;
		const vault = this.plugin.app.vault;
		const folderPath = vault.getFolderByPath(folder);

		// A missing folder simply means there are no contacts yet
		if (!folderPath) return [];

		const contacts: ContactWithCountdown[] = [];

		for (const file of folderPath.children) {
			if (!(file instanceof TFile) || file.extension !== "md") continue;

			try {
				// Read the file content directly instead of relying on metadata cache
				const content = await vault.cachedRead(file);
				const { frontmatter: metadata } = splitFrontmatter(content);

				if (metadata) {
					const birthday =
						typeof metadata.birthday === "string"
							? metadata.birthday
							: "";

					contacts.push({
						name:
							typeof metadata.name === "string" && metadata.name
								? metadata.name
								: file.basename,
						birthday,
						formattedBirthday: this.formatBirthday(birthday),
						relationship:
							typeof metadata.relationship === "string"
								? metadata.relationship
								: "",
						age: this.calculateAge(birthday),
						daysUntilBirthday:
							this.calculateDaysUntilBirthday(birthday),
						lastInteraction: this.calculateDaysSinceLastInteraction(
							metadata.interactions
						),
						file,
					});
				}
			} catch (error) {
				console.error(
					`Error reading contact file ${file.path}:`,
					error
				);
			}
		}

		return contacts;
	}

	private calculateAge(birthday: string): number | null {
		const birthDate = parseLocalDate(birthday);
		if (!birthDate) return null;

		const today = getToday();
		let age = today.getFullYear() - birthDate.getFullYear();
		const monthDiff = today.getMonth() - birthDate.getMonth();

		if (
			monthDiff < 0 ||
			(monthDiff === 0 && today.getDate() < birthDate.getDate())
		) {
			age--;
		}

		return age;
	}

	public calculateDetailedAge(birthday: string): string {
		const birthDate = parseLocalDate(birthday);
		if (!birthDate) return "";

		const today = getToday();

		let years = today.getFullYear() - birthDate.getFullYear();
		let months = today.getMonth() - birthDate.getMonth();
		let days = today.getDate() - birthDate.getDate();

		// Adjust for negative days
		if (days < 0) {
			months--;
			// Get last day of previous month
			const lastMonth = new Date(
				today.getFullYear(),
				today.getMonth(),
				0
			);
			days += lastMonth.getDate();
		}

		// Adjust for negative months
		if (months < 0) {
			years--;
			months += 12;
		}

		if (years < 0) return "";

		// Format the output
		const parts = [];

		if (years > 0) parts.push(pluralize(years, "year"));
		if (months > 0) parts.push(pluralize(months, "month"));
		if (days > 0) parts.push(pluralize(days, "day"));

		if (parts.length === 0) return "Born today";
		return parts.join(", ") + " old";
	}

	public formatBirthday(dateStr: string, withYear = false): string {
		const birthDate = parseLocalDate(dateStr);
		if (!birthDate) return dateStr || "";

		return birthDate.toLocaleDateString(undefined, {
			month: "long",
			day: "numeric",
			...(withYear && { year: "numeric" }),
		});
	}

	public calculateDaysUntilBirthday(birthday: string): number | null {
		const birthDate = parseLocalDate(birthday);
		if (!birthDate) return null;

		const today = getToday();

		// Create this year's birthday at local midnight
		const nextBirthday = new Date(
			today.getFullYear(),
			birthDate.getMonth(),
			birthDate.getDate()
		);

		// If this year's birthday has already passed, use next year's birthday
		if (nextBirthday < today) {
			nextBirthday.setFullYear(today.getFullYear() + 1);
		}

		return daysBetween(today, nextBirthday);
	}

	private calculateDaysSinceLastInteraction(
		interactions: unknown
	): number | null {
		if (!Array.isArray(interactions)) return null;

		// Don't rely on the stored order, pick the most recent date
		const latest = (interactions as Interaction[])
			.map((interaction) => parseLocalDate(interaction?.date))
			.filter((date): date is Date => date !== null)
			.reduce<Date | null>(
				(max, date) => (!max || date > max ? date : max),
				null
			);

		return latest ? daysBetween(latest, getToday()) : null;
	}

	public formatDaysAgo(days: number | null): string {
		if (days === null) return "";
		if (days === 0) return "Today";
		if (days < 0) return `In ${pluralize(-days, "day")}`;
		return `${pluralize(days, "day")} ago`;
	}
}
