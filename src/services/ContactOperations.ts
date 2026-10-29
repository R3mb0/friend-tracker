import { TFile, normalizePath, stringifyYaml } from "obsidian";
import type FriendTracker from "@/main";
import type {
	Connection,
	ContactData,
	ContactWithCountdown,
	Interaction,
	Membership,
} from "@/types";
import { getContactFilePath, sanitizeFileName } from "@/utils/file";

// Organization notes live in this subfolder of the contacts folder
export const ORGANIZATIONS_FOLDER = "Organizations";

// Code block that renders the member list inside an organization note
export const MEMBERS_CODE_BLOCK = "friend-tracker-members";
import { splitFrontmatter } from "@/utils/frontmatter";
import {
	daysBetween,
	getToday,
	parseBirthday,
	parseLocalDate,
	pluralize,
	toLocalISODate,
} from "@/utils/date";

/** Connections from the frontmatter, skipping malformed entries */
export function parseConnections(value: unknown): Connection[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(item): item is Connection =>
				!!item &&
				typeof item === "object" &&
				typeof item.contact === "string" &&
				!!item.contact.trim()
		)
		.map((item) => ({
			contact: item.contact.trim(),
			relation:
				typeof item.relation === "string" ? item.relation.trim() : "",
		}));
}

/** Organization memberships from the frontmatter, skipping malformed ones */
export function parseMemberships(value: unknown): Membership[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(item): item is Membership =>
				!!item &&
				typeof item === "object" &&
				typeof item.organization === "string" &&
				!!item.organization.trim()
		)
		.map((item) => ({
			organization: item.organization.trim(),
			role: typeof item.role === "string" ? item.role.trim() : "",
		}));
}

/** "[[Max Müller]]" or "[[Max Müller|Max]]" -> "Max Müller" */
export function getLinkTarget(link: string): string {
	return link
		.replace(/^\[\[/, "")
		.replace(/\]\]$/, "")
		.split("|")[0]
		.trim();
}

/**
 * The "deceased" field holds the date of death, or `true` when the date
 * is unknown. Anything else (missing, false, empty) means alive.
 */
export function parseDeceased(value: unknown): {
	deceased: boolean;
	date: Date | null;
} {
	if (value === true) return { deceased: true, date: null };
	const date = parseLocalDate(value);
	if (date) return { deceased: true, date };
	// Non-empty text that isn't a date still marks the person as deceased
	if (typeof value === "string" && value.trim() && value !== "false") {
		return { deceased: true, date: null };
	}
	return { deceased: false, date: null };
}

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
					const death = parseDeceased(metadata.deceased);
					// Age at death; unknown if the date of death is unknown
					const age = death.deceased
						? death.date
							? this.calculateAge(birthday, death.date)
							: null
						: this.calculateAge(birthday);

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
						age,
						// No birthday countdown or reminders for the deceased
						daysUntilBirthday: death.deceased
							? null
							: this.calculateDaysUntilBirthday(birthday),
						lastInteraction: this.calculateDaysSinceLastInteraction(
							metadata.interactions
						),
						deceased: death.deceased,
						deathDate: death.date ? toLocalISODate(death.date) : "",
						contactInterval: this.getContactInterval(
							metadata.contact_interval
						),
						connections: parseConnections(metadata.connections),
						organizations: parseMemberships(
							metadata.organizations
						).map((membership) =>
							getLinkTarget(membership.organization)
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

	/**
	 * "Keep in touch" goal in days, set per contact. There is no default:
	 * contacts without a value have no goal (null).
	 */
	public getContactInterval(value: unknown): number | null {
		if (value === undefined || value === null || value === "") return null;
		const days = Number(value);
		return Number.isFinite(days) && days > 0 ? Math.round(days) : null;
	}

	/** Set or (with null) remove a contact's "keep in touch" goal */
	public async setContactInterval(file: TFile, days: number | null) {
		await this.plugin.app.fileManager.processFrontMatter(
			file,
			(frontmatter) => {
				if (days && days > 0) frontmatter.contact_interval = days;
				else delete frontmatter.contact_interval;
			}
		);
	}

	/** Age today, or at `until` (e.g. the date of death) */
	public calculateAge(birthday: string, until = getToday()): number | null {
		const birthDate = parseLocalDate(birthday);
		if (!birthDate) return null;

		const today = until;
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

	/** Format a date or birthday; birthdays without a year show day/month */
	public formatBirthday(dateStr: string, withYear = false): string {
		const parts = parseBirthday(dateStr);
		if (!parts) return dateStr || "";

		// Any leap year works for showing day and month only
		const date = new Date(parts.year ?? 2000, parts.month - 1, parts.day);
		return date.toLocaleDateString(undefined, {
			month: "long",
			day: "numeric",
			...(withYear && parts.year !== null && { year: "numeric" }),
		});
	}

	/** Also works for birthdays without a year */
	public calculateDaysUntilBirthday(birthday: string): number | null {
		const parts = parseBirthday(birthday);
		if (!parts) return null;

		const today = getToday();

		// Create this year's birthday at local midnight
		// (February 29 rolls over to March 1 in non-leap years)
		const nextBirthday = new Date(
			today.getFullYear(),
			parts.month - 1,
			parts.day
		);

		// If this year's birthday has already passed, use next year's birthday
		if (nextBirthday < today) {
			nextBirthday.setFullYear(today.getFullYear() + 1);
		}

		return daysBetween(today, nextBirthday);
	}

	/**
	 * Create a contact file from frontmatter data (must contain `name`).
	 * Applies the "new contact" template from the settings.
	 */
	public async createContact(
		data: Record<string, unknown>
	): Promise<"created" | "exists" | "invalid-name"> {
		const name = typeof data.name === "string" ? data.name.trim() : "";
		if (!sanitizeFileName(name)) return "invalid-name";

		const vault = this.plugin.app.vault;
		const folder = this.plugin.settings.contactsFolder;
		const filePath = getContactFilePath(folder, name);
		if (vault.getAbstractFileByPath(filePath)) return "exists";

		const frontmatter: Record<string, unknown> = { ...data, name };
		const settings = this.plugin.settings;
		for (const field of settings.newContactFields) {
			if (!(field in frontmatter)) frontmatter[field] = "";
		}
		if (
			settings.newContactNoteSections.length > 0 &&
			!frontmatter.note_sections
		) {
			frontmatter.note_sections = settings.newContactNoteSections.map(
				(title) => ({ title, text: "" })
			);
		}

		if (!vault.getFolderByPath(folder)) {
			await vault.createFolder(folder);
		}
		const yaml = stringifyYaml(frontmatter);
		await vault.create(filePath, `---\n${yaml.trimEnd()}\n---\n`);
		return "created";
	}

	// ---------------------------------------------------------------------
	// Organizations (companies, clubs, ...) as notes in a subfolder
	// ---------------------------------------------------------------------

	public getOrganizationsFolder(): string {
		return normalizePath(
			`${this.plugin.settings.contactsFolder}/${ORGANIZATIONS_FOLDER}`
		);
	}

	public isOrganization(file: TFile): boolean {
		return file.parent?.path === this.getOrganizationsFolder();
	}

	/** All organization notes, sorted by name */
	public getOrganizations(): TFile[] {
		const folder = this.plugin.app.vault.getFolderByPath(
			this.getOrganizationsFolder()
		);
		if (!folder) return [];
		return folder.children
			.filter(
				(file): file is TFile =>
					file instanceof TFile && file.extension === "md"
			)
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	/** The organization note with this name, created if it doesn't exist */
	public async getOrCreateOrganization(name: string): Promise<TFile | null> {
		const clean = sanitizeFileName(name);
		if (!clean) return null;

		const existing = this.getOrganizations().find(
			(file) => file.basename.toLowerCase() === clean.toLowerCase()
		);
		if (existing) return existing;

		const vault = this.plugin.app.vault;
		const folder = this.getOrganizationsFolder();
		if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);

		// The code block renders the member list (see main.ts)
		const content = [
			"---",
			"type: organization",
			"---",
			"",
			"## Members",
			"",
			"```" + MEMBERS_CODE_BLOCK,
			"```",
			"",
		].join("\n");
		return vault.create(normalizePath(`${folder}/${clean}.md`), content);
	}

	/** Contacts linked to an organization, with their role */
	public async getMembers(
		organization: TFile
	): Promise<Array<{ file: TFile; name: string; role: string }>> {
		const metadataCache = this.plugin.app.metadataCache;
		const members: Array<{ file: TFile; name: string; role: string }> = [];
		for (const { file, data } of await this.getContactData()) {
			const membership = parseMemberships(data.organizations).find(
				(entry) =>
					metadataCache.getFirstLinkpathDest(
						getLinkTarget(entry.organization),
						file.path
					) === organization
			);
			if (!membership) continue;
			const name =
				typeof data.name === "string" && data.name.trim()
					? data.name.trim()
					: file.basename;
			members.push({ file, name, role: membership.role });
		}
		return members.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Add a contact to an organization, or update the role */
	public async setMembership(
		contact: TFile,
		organization: TFile,
		role: string
	) {
		const metadataCache = this.plugin.app.metadataCache;
		await this.plugin.app.fileManager.processFrontMatter(
			contact,
			(frontmatter) => {
				const memberships = parseMemberships(frontmatter.organizations);
				const existing = memberships.find(
					(entry) =>
						metadataCache.getFirstLinkpathDest(
							getLinkTarget(entry.organization),
							contact.path
						) === organization
				);
				if (existing) existing.role = role;
				else {
					memberships.push({
						organization: `[[${organization.basename}]]`,
						role,
					});
				}
				frontmatter.organizations = memberships;
			}
		);
	}

	/** Remove a contact from an organization */
	public async removeMembership(contact: TFile, organization: TFile) {
		const metadataCache = this.plugin.app.metadataCache;
		await this.plugin.app.fileManager.processFrontMatter(
			contact,
			(frontmatter) => {
				const memberships = parseMemberships(
					frontmatter.organizations
				).filter(
					(entry) =>
						metadataCache.getFirstLinkpathDest(
							getLinkTarget(entry.organization),
							contact.path
						) !== organization
				);
				if (memberships.length > 0) {
					frontmatter.organizations = memberships;
				} else {
					delete frontmatter.organizations;
				}
			}
		);
	}

	/** Full frontmatter of every contact file */
	public async getContactData(): Promise<
		Array<{ file: TFile; data: ContactData }>
	> {
		const folder = this.plugin.app.vault.getFolderByPath(
			this.plugin.settings.contactsFolder
		);
		if (!folder) return [];

		const result: Array<{ file: TFile; data: ContactData }> = [];
		for (const file of folder.children) {
			if (!(file instanceof TFile) || file.extension !== "md") continue;
			try {
				const content = await this.plugin.app.vault.cachedRead(file);
				const { frontmatter } = splitFrontmatter(content);
				if (frontmatter) {
					result.push({ file, data: frontmatter as ContactData });
				}
			} catch (error) {
				console.error(`Error reading contact file ${file.path}:`, error);
			}
		}
		return result;
	}

	/** Add an interaction to a contact file (newest first, like the profile) */
	public async addInteraction(file: TFile, interaction: Interaction) {
		await this.plugin.app.fileManager.processFrontMatter(
			file,
			(frontmatter) => {
				const list: Interaction[] = Array.isArray(
					frontmatter.interactions
				)
					? frontmatter.interactions
					: [];
				list.push(interaction);
				const getTime = (item: Interaction) =>
					parseLocalDate(item?.date)?.getTime() ?? 0;
				list.sort((a, b) => getTime(b) - getTime(a));
				frontmatter.interactions = list;
			}
		);
	}

	public calculateDaysSinceLastInteraction(
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
