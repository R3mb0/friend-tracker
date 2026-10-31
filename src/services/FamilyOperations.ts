import { TFile } from "obsidian";
import type FriendTracker from "@/main";
import { STANDARD_FIELDS } from "@/constants";
import type { Connection } from "@/types";
import { FamilyGraph, FamilyPerson } from "@/services/family";
import {
	getLinkTarget,
	parseConnections,
	parseDeceased,
} from "@/services/ContactOperations";
import { toLocalISODate } from "@/utils/date";

/** Relations in "connections" that the migration turns into family links */
const PARENT_RELATIONS = ["parent", "mother", "father", "mom", "dad", "mum"];
const CHILD_RELATIONS = ["child", "son", "daughter"];
const PARTNER_RELATIONS = [
	"partner",
	"spouse",
	"husband",
	"wife",
	"boyfriend",
	"girlfriend",
];

/** Links in a frontmatter list, e.g. ["[[Maria]]"]; other values skipped */
export function parseLinkList(value: unknown): string[] {
	const list = Array.isArray(value) ? value : value ? [value] : [];
	return list
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

export interface FamilyData {
	graph: FamilyGraph;
	/** File per person id (file path) */
	files: Map<string, TFile>;
}

/** Reads and changes parents and partners of contacts */
export class FamilyOperations {
	constructor(private plugin: FriendTracker) {}

	private resolve(link: string, from: TFile): TFile | null {
		return this.plugin.app.metadataCache.getFirstLinkpathDest(
			getLinkTarget(link),
			from.path
		);
	}

	private toLink(file: TFile): string {
		return `[[${file.basename}]]`;
	}

	/** Family graph of all contacts, links resolved to file paths */
	async load(): Promise<FamilyData> {
		const entries = await this.plugin.contactOperations.getContactData();
		const files = new Map<string, TFile>();
		const people: FamilyPerson[] = [];

		for (const { file, data } of entries) {
			files.set(file.path, file);
			const resolveAll = (value: unknown) =>
				parseLinkList(value)
					.map((link) => this.resolve(link, file)?.path)
					.filter((path): path is string => !!path);
			const death = parseDeceased(data.deceased);
			people.push({
				id: file.path,
				name:
					typeof data.name === "string" && data.name.trim()
						? data.name.trim()
						: file.basename,
				parents: resolveAll(data.parents),
				partners: resolveAll(data.partners),
				birthday: typeof data.birthday === "string" ? data.birthday : "",
				deceased: death.deceased,
				deathDate: death.date ? toLocalISODate(death.date) : "",
			});
		}
		return { graph: new FamilyGraph(people), files };
	}

	/** Change a link list in a file's frontmatter */
	private async updateLinks(
		file: TFile,
		key: string,
		change: (links: string[], isTarget: (link: string) => boolean) => string[],
		target: TFile
	) {
		await this.plugin.app.fileManager.processFrontMatter(
			file,
			(frontmatter) => {
				const isTarget = (link: string) =>
					this.resolve(link, file) === target;
				const links = change(parseLinkList(frontmatter[key]), isTarget);
				if (links.length > 0) frontmatter[key] = links;
				else delete frontmatter[key];
			}
		);
	}

	private add(file: TFile, key: string, target: TFile) {
		return this.updateLinks(
			file,
			key,
			(links, isTarget) =>
				links.some(isTarget) ? links : [...links, this.toLink(target)],
			target
		);
	}

	private remove(file: TFile, key: string, target: TFile) {
		return this.updateLinks(
			file,
			key,
			(links, isTarget) => links.filter((link) => !isTarget(link)),
			target
		);
	}

	/**
	 * Make `parent` a parent of `child`. Returns an error message if that
	 * isn't possible (e.g. it would create a loop).
	 */
	async addParent(child: TFile, parent: TFile): Promise<string | null> {
		const { graph } = await this.load();
		const problem = graph.checkNewParent(child.path, parent.path);
		if (problem) return problem;
		await this.add(child, STANDARD_FIELDS.PARENTS, parent);
		return null;
	}

	async removeParent(child: TFile, parent: TFile) {
		await this.remove(child, STANDARD_FIELDS.PARENTS, parent);
	}

	/** Partners are stored on both sides */
	async addPartner(a: TFile, b: TFile): Promise<string | null> {
		if (a === b) return "A person can't be their own partner";
		await this.add(a, STANDARD_FIELDS.PARTNERS, b);
		await this.add(b, STANDARD_FIELDS.PARTNERS, a);
		return null;
	}

	async removePartner(a: TFile, b: TFile) {
		await this.remove(a, STANDARD_FIELDS.PARTNERS, b);
		await this.remove(b, STANDARD_FIELDS.PARTNERS, a);
	}

	/**
	 * Turn family relations stored as connections (parent, child, partner,
	 * …) into parents/partners and remove those connections.
	 */
	async convertConnections(): Promise<{ converted: number; skipped: number }> {
		let converted = 0;
		let skipped = 0;
		const entries = await this.plugin.contactOperations.getContactData();

		for (const { file, data } of entries) {
			const remaining: Connection[] = [];
			for (const connection of parseConnections(data.connections)) {
				const relation = connection.relation.toLowerCase();
				const other = this.resolve(connection.contact, file);
				const isFamily =
					PARENT_RELATIONS.includes(relation) ||
					CHILD_RELATIONS.includes(relation) ||
					PARTNER_RELATIONS.includes(relation);
				if (!isFamily || !other) {
					remaining.push(connection);
					continue;
				}

				// "Other is my <relation>"
				let problem: string | null = null;
				if (PARENT_RELATIONS.includes(relation)) {
					problem = await this.addParent(file, other);
				} else if (CHILD_RELATIONS.includes(relation)) {
					problem = await this.addParent(other, file);
				} else {
					problem = await this.addPartner(file, other);
				}
				if (problem && problem !== "Already a parent") {
					remaining.push(connection);
					skipped++;
				} else {
					converted++;
				}
			}

			const before = parseConnections(data.connections).length;
			if (remaining.length !== before) {
				await this.plugin.app.fileManager.processFrontMatter(
					file,
					(frontmatter) => {
						if (remaining.length > 0) {
							frontmatter.connections = remaining;
						} else {
							delete frontmatter.connections;
						}
					}
				);
			}
		}
		return { converted, skipped };
	}
}
