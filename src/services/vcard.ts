/**
 * vCard 3.0 export and import. Kept free of Obsidian APIs so it can be
 * tested on its own.
 */

export interface VCardContact {
	name: string;
	/** "YYYY-MM-DD" or "--MM-DD" (year unknown) */
	birthday?: string;
	phone?: string;
	email?: string;
	address?: string;
	relationship?: string;
	notes?: string;
}

// Lines longer than this are folded (RFC 2426 recommends 75 characters)
const MAX_LINE_LENGTH = 75;

function escapeValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\r?\n/g, "\\n")
		.replace(/,/g, "\\,")
		.replace(/;/g, "\\;");
}

function unescapeValue(value: string): string {
	return value.replace(/\\([\\,;nN])/g, (_, char: string) =>
		char === "n" || char === "N" ? "\n" : char
	);
}

function foldLine(line: string): string {
	if (line.length <= MAX_LINE_LENGTH) return line;
	const parts = [line.slice(0, MAX_LINE_LENGTH)];
	for (let i = MAX_LINE_LENGTH; i < line.length; i += MAX_LINE_LENGTH - 1) {
		// Continuation lines start with a space
		parts.push(" " + line.slice(i, i + MAX_LINE_LENGTH - 1));
	}
	return parts.join("\r\n");
}

/** "Anna Maria Schmidt" -> "Schmidt;Anna Maria;;;" */
function toStructuredName(name: string): string {
	const parts = name.trim().split(/\s+/);
	const last = parts.length > 1 ? parts.pop() ?? "" : "";
	return `${escapeValue(last)};${escapeValue(parts.join(" "))};;;`;
}

function toVCardBirthday(birthday: string): string | null {
	const full = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (full) return `${full[1]}-${full[2]}-${full[3]}`;
	const yearless = birthday.match(/^--(\d{2})-(\d{2})$/);
	if (yearless) return `--${yearless[1]}${yearless[2]}`;
	return null;
}

export function buildVCards(contacts: VCardContact[]): string {
	const cards = contacts.map((contact) => {
		const lines = [
			"BEGIN:VCARD",
			"VERSION:3.0",
			`FN:${escapeValue(contact.name)}`,
			`N:${toStructuredName(contact.name)}`,
		];
		const birthday = contact.birthday && toVCardBirthday(contact.birthday);
		if (birthday) lines.push(`BDAY:${birthday}`);
		if (contact.phone) lines.push(`TEL;TYPE=CELL:${escapeValue(contact.phone)}`);
		if (contact.email) {
			lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(contact.email)}`);
		}
		if (contact.address) {
			// Free text goes into the street component
			lines.push(`ADR;TYPE=HOME:;;${escapeValue(contact.address)};;;;`);
		}
		if (contact.relationship) {
			lines.push(`CATEGORIES:${escapeValue(contact.relationship)}`);
		}
		if (contact.notes) lines.push(`NOTE:${escapeValue(contact.notes)}`);
		lines.push("END:VCARD");
		return lines.map(foldLine).join("\r\n");
	});
	return cards.join("\r\n") + "\r\n";
}

interface Property {
	name: string;
	params: string[];
	value: string;
}

function parseProperty(line: string): Property | null {
	// Split at the first ":" that isn't inside a quoted parameter
	let inQuotes = false;
	let colon = -1;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '"') inQuotes = !inQuotes;
		else if (line[i] === ":" && !inQuotes) {
			colon = i;
			break;
		}
	}
	if (colon === -1) return null;

	const [rawName, ...params] = line.slice(0, colon).split(";");
	// Drop group prefixes like "item1.TEL"
	const name = rawName.split(".").pop()?.toUpperCase() ?? "";
	return {
		name,
		params: params.map((param) => param.toUpperCase()),
		value: line.slice(colon + 1),
	};
}

/** Split on separators that aren't escaped with a backslash */
function splitUnescaped(value: string, separator: string): string[] {
	const parts: string[] = [];
	let current = "";
	for (let i = 0; i < value.length; i++) {
		if (value[i] === "\\" && i + 1 < value.length) {
			current += value[i] + value[i + 1];
			i++;
		} else if (value[i] === separator) {
			parts.push(current);
			current = "";
		} else {
			current += value[i];
		}
	}
	parts.push(current);
	return parts;
}

function parseVCardBirthday(property: Property): string | undefined {
	const value = property.value.trim();
	// Apple marks unknown years with X-APPLE-OMIT-YEAR=1604
	const omitYear = property.params.some((param) =>
		param.startsWith("X-APPLE-OMIT-YEAR")
	);

	const yearless = value.match(/^--(\d{2})-?(\d{2})/);
	if (yearless) return `--${yearless[1]}-${yearless[2]}`;

	const full = value.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
	if (!full) return undefined;
	if (omitYear || full[1] === "1604") return `--${full[2]}-${full[3]}`;
	return `${full[1]}-${full[2]}-${full[3]}`;
}

export function parseVCards(text: string): VCardContact[] {
	// Unfold continuation lines (starting with space or tab)
	const lines = text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");

	const contacts: VCardContact[] = [];
	let current: VCardContact | null = null;
	let structuredName = "";

	for (const line of lines) {
		const property = parseProperty(line.trim());
		if (!property) continue;

		if (property.name === "BEGIN" && property.value.toUpperCase() === "VCARD") {
			current = { name: "" };
			structuredName = "";
			continue;
		}
		if (!current) continue;

		switch (property.name) {
			case "END":
				if (!current.name && structuredName) current.name = structuredName;
				if (current.name) contacts.push(current);
				current = null;
				break;
			case "FN":
				current.name = unescapeValue(property.value).trim();
				break;
			case "N": {
				// "Last;First;Middle;Prefix;Suffix" -> "First Middle Last"
				const [last, first, middle] = splitUnescaped(property.value, ";").map(
					unescapeValue
				);
				structuredName = [first, middle, last]
					.map((part) => part?.trim())
					.filter(Boolean)
					.join(" ");
				break;
			}
			case "BDAY":
				current.birthday = parseVCardBirthday(property);
				break;
			case "TEL":
				current.phone ??= unescapeValue(property.value).trim();
				break;
			case "EMAIL":
				current.email ??= unescapeValue(property.value).trim();
				break;
			case "ADR":
				current.address ??= splitUnescaped(property.value, ";")
					.map((part) => unescapeValue(part).trim())
					.filter(Boolean)
					.join(", ");
				break;
			case "CATEGORIES":
				current.relationship ??= unescapeValue(
					splitUnescaped(property.value, ",")[0] ?? ""
				)
					.trim()
					.toLowerCase();
				break;
			case "NOTE":
				current.notes = unescapeValue(property.value);
				break;
		}
	}
	return contacts;
}
