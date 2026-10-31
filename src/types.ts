import { TFile } from "obsidian";

export interface FriendTrackerSettings {
	contactsFolder: string;
	defaultSortColumn: SortColumn;
	defaultSortDirection: "asc" | "desc";
	relationshipTypes: string[];
	defaultActiveTab: "notes" | "interactions" | "markdown";
	/** Birthday notices on startup for birthdays within this many days */
	birthdayReminderDays: number;
	showDeceased: boolean;
	/** Template for new contacts */
	newContactNoteSections: string[];
	newContactFields: string[];
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
	/** "Keep in touch" goal in days, null = none */
	contactInterval: number | null;
	connections: Connection[];
	/** Names of the organizations the contact belongs to */
	organizations: string[];
}

/** Columns the overview can be sorted by */
export type SortColumn = Exclude<
	keyof ContactWithCountdown,
	"file"
	| "deceased"
	| "deathDate"
	| "contactInterval"
	| "connections"
	| "organizations"
>;

export interface SortConfig {
	column: SortColumn;
	direction: "asc" | "desc";
}

export type InteractionType = "meeting" | "call" | "video" | "message" | "other";

export interface Interaction {
	date: string;
	text: string;
	type?: InteractionType;
}

/** Membership in a company, club etc., e.g. { organization: "[[ACME]]", role: "Engineer" } */
export interface Membership {
	organization: string;
	role: string;
}

/** Link to another contact, e.g. { contact: "[[Max]]", relation: "partner" } */
export interface Connection {
	contact: string;
	relation: string;
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
	/** "Keep in touch" goal in days */
	contact_interval?: number;
	connections?: Connection[];
	organizations?: Membership[];
	/** Links to the parents, e.g. ["[[Maria]]", "[[Peter]]"] */
	parents?: string[];
	/** Links to partners (stored on both sides) */
	partners?: string[];
	[key: string]: unknown;
}

export const DEFAULT_SETTINGS: FriendTrackerSettings = {
	contactsFolder: "FriendTracker",
	defaultSortColumn: "daysUntilBirthday",
	defaultSortDirection: "asc",
	relationshipTypes: ["family", "friend", "colleague", "pet"],
	defaultActiveTab: "notes",
	birthdayReminderDays: 1,
	showDeceased: true,
	newContactNoteSections: [],
	newContactFields: [],
};
