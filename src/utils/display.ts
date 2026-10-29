import { pluralize } from "@/utils/date";

// Within this share of the contact goal the status turns yellow
export const DUE_SOON_RATIO = 0.8;

export type ContactStatus = "is-recent" | "is-due" | "is-overdue";

/**
 * Status relative to the "keep in touch" goal: green while well within it,
 * yellow when it is nearly reached, red once it has passed. null without
 * a goal.
 */
export function getContactStatus(
	daysSince: number,
	interval: number | null
): ContactStatus | null {
	if (!interval) return null;
	if (daysSince >= interval) return "is-overdue";
	if (daysSince >= interval * DUE_SOON_RATIO) return "is-due";
	return "is-recent";
}

/**
 * How urgent it is to get in touch: days since the last interaction
 * relative to the goal (1 = goal reached). Contacts without any
 * interaction count as due. null without a goal.
 */
export function getContactUrgency(
	daysSince: number | null,
	interval: number | null
): number | null {
	if (!interval) return null;
	if (daysSince === null) return 1;
	return daysSince / interval;
}

// Theme colors for relationship tags (see styles.css)
const TAG_COLORS = [
	"red",
	"orange",
	"yellow",
	"green",
	"cyan",
	"blue",
	"purple",
	"pink",
];

/** Stable color per relationship type, so "family" always looks the same */
export function getTagColorClass(relationship: string): string {
	const key = relationship.trim().toLowerCase();
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0;
	}
	return `is-${TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]}`;
}

/** Relationship type as a colored tag element */
export function createRelationshipTag(
	container: HTMLElement,
	relationship: string
): HTMLElement {
	return container.createSpan({
		cls: `friend-tracker-tag ${getTagColorClass(relationship)}`,
		text: relationship,
	});
}

/** "today", "tomorrow" or "in 5 days" */
export function formatCountdown(days: number): string {
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return `in ${pluralize(days, "day")}`;
}

const CHINESE_ZODIAC = [
	"Rat",
	"Ox",
	"Tiger",
	"Rabbit",
	"Dragon",
	"Snake",
	"Horse",
	"Goat",
	"Monkey",
	"Rooster",
	"Dog",
	"Pig",
];

/**
 * Chinese zodiac animal. The Chinese year starts with the lunar new year
 * (late January to mid February), so early-year birthdays may belong to
 * the previous year's animal.
 */
export function getChineseZodiac(date: Date): string {
	let year = date.getFullYear();
	try {
		const relatedYear = new Intl.DateTimeFormat("en-u-ca-chinese", {
			year: "numeric",
		})
			.formatToParts(date)
			// "relatedYear" is missing from older TypeScript DOM typings
			.find((part) => (part.type as string) === "relatedYear")?.value;
		if (relatedYear) year = Number(relatedYear);
	} catch {
		// Without Chinese calendar support fall back to the Gregorian year
	}
	return CHINESE_ZODIAC[(((year - 4) % 12) + 12) % 12];
}
