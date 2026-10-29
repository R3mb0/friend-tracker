const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Parse a "YYYY-MM-DD" value as a local date at midnight.
 * Returns null for empty or invalid values.
 */
export function parseLocalDate(value: unknown): Date | null {
	if (value instanceof Date) {
		// YAML parsers may turn unquoted dates into UTC Date objects
		if (isNaN(value.getTime())) return null;
		return makeLocalDate(
			value.getUTCFullYear(),
			value.getUTCMonth(),
			value.getUTCDate()
		);
	}
	if (typeof value !== "string") return null;

	const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = makeLocalDate(year, month, day);

	// Reject overflowing values like 2024-02-31
	if (date.getMonth() !== month || date.getDate() !== day) return null;
	return date;
}

function makeLocalDate(year: number, month: number, day: number): Date {
	const date = new Date(0);
	date.setFullYear(year, month, day);
	date.setHours(0, 0, 0, 0);
	return date;
}

/** Today at local midnight */
export function getToday(): Date {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return today;
}

/** Format a date as "YYYY-MM-DD" in local time */
export function toLocalISODate(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** Whole days from `from` to `to` (both expected at local midnight) */
export function daysBetween(from: Date, to: Date): number {
	// Rounding absorbs DST shifts of one hour
	return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function pluralize(count: number, singular: string, plural?: string) {
	return `${count} ${count === 1 ? singular : plural ?? singular + "s"}`;
}
