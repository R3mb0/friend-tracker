import { normalizePath } from "obsidian";

// Characters that are invalid in file names or break Obsidian links
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Turn a contact name into a safe file name (without extension) */
export function sanitizeFileName(name: string): string {
	return name
		.replace(INVALID_FILENAME_CHARS, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "");
}

export function getContactFilePath(folder: string, name: string): string {
	return normalizePath(`${folder}/${sanitizeFileName(name)}.md`);
}
