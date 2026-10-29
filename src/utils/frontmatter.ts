import { parseYaml } from "obsidian";

// Accepts both LF and CRLF line endings
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

export interface SplitContent {
	frontmatter: Record<string, unknown> | null;
	body: string;
}

/** Split file content into parsed YAML frontmatter and the markdown body */
export function splitFrontmatter(content: string): SplitContent {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) return { frontmatter: null, body: content };

	const parsed = parseYaml(match[1]);
	return {
		frontmatter:
			parsed && typeof parsed === "object"
				? (parsed as Record<string, unknown>)
				: {},
		body: content.slice(match[0].length),
	};
}
