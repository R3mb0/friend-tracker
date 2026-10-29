import { TFile } from "obsidian";

export interface FriendTrackerSettings {
	contactsFolder: string;
	defaultSortColumn: SortColumn;
	defaultSortDirection: "asc" | "desc";
	relationshipTypes: string[];
	defaultActiveTab: "notes" | "interactions" | "markdown";
}

export interface Contact {
	name: string;
	birthday: string;
	relationship: string;
	age: number | null;
	file: TFile;
}

export interface ContactWithCountdown extends Contact {
	formattedBirthday: string;
	daysUntilBirthday: number | null;
	/** Days since the most recent interaction */
	lastInteraction: number | null;
	deceased: boolean;
	/** Date of death as "YYYY-MM-DD", "" if unknown or alive */
	deathDate: string;
}

/** Columns the overview can be sorted by */
export type SortColumn = Exclude<
	keyof ContactWithCountdown,
	"file" | "deceased" | "deathDate"
>;

export interface SortConfig {
	column: SortColumn;
	direction: "asc" | "desc";
}

export interface Interaction {
	date: string;
	text: string;
}

/** A user-defined notes block with its own heading, e.g. "Diet" */
export interface NoteSection {
	title: string;
	text: string;
}

/** Frontmatter of a contact file */
export interface ContactData {
	name?: string;
	birthday?: string;
	relationship?: string;
	/** The "General" notes block */
	notes?: string;
	note_sections?: NoteSection[];
	interactions?: Interaction[];
	/** Date of death ("YYYY-MM-DD"), or true if the date is unknown */
	deceased?: string | boolean;
	[key: string]: unknown;
}

export const DEFAULT_SETTINGS: FriendTrackerSettings = {
	contactsFolder: "FriendTracker",
	defaultSortColumn: "daysUntilBirthday",
	defaultSortDirection: "asc",
	relationshipTypes: ["family", "friend", "colleague", "pet"],
	defaultActiveTab: "notes",
};
