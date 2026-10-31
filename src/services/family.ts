/**
 * Family graph and tree layout. Kept free of Obsidian APIs so it can be
 * tested on its own; links are resolved to ids (file paths) beforehand.
 *
 * Only parents and partners are stored. Children and siblings are derived.
 */

export interface FamilyPerson {
	id: string;
	name: string;
	/** Ids of the parents (resolved links) */
	parents: string[];
	/** Ids of the partners (resolved links, one direction is enough) */
	partners: string[];
	/** "YYYY-MM-DD", "--MM-DD" or "" */
	birthday: string;
	deceased: boolean;
	/** "YYYY-MM-DD" or "" (unknown or alive) */
	deathDate: string;
}

export interface Sibling {
	id: string;
	/** Only one parent in common */
	half: boolean;
}

export class FamilyGraph {
	private people = new Map<string, FamilyPerson>();
	private children = new Map<string, string[]>();
	private partners = new Map<string, Set<string>>();

	constructor(people: FamilyPerson[]) {
		for (const person of people) this.people.set(person.id, person);

		for (const person of people) {
			for (const parent of this.parentsOf(person.id)) {
				const list = this.children.get(parent) ?? [];
				list.push(person.id);
				this.children.set(parent, list);
			}
			// Partnerships count in both directions
			for (const partner of person.partners) {
				if (!this.people.has(partner) || partner === person.id) continue;
				this.addPartner(person.id, partner);
				this.addPartner(partner, person.id);
			}
		}
		for (const list of this.children.values()) {
			list.sort((a, b) => this.compareByBirth(a, b));
		}
	}

	private addPartner(a: string, b: string) {
		const set = this.partners.get(a) ?? new Set<string>();
		set.add(b);
		this.partners.set(a, set);
	}

	get(id: string): FamilyPerson | undefined {
		return this.people.get(id);
	}

	has(id: string): boolean {
		return this.people.has(id);
	}

	/** Known parents (links to non-contacts are ignored) */
	parentsOf(id: string): string[] {
		const person = this.people.get(id);
		if (!person) return [];
		return Array.from(new Set(person.parents)).filter(
			(parent) => parent !== id && this.people.has(parent)
		);
	}

	childrenOf(id: string): string[] {
		return this.children.get(id) ?? [];
	}

	partnersOf(id: string): string[] {
		return Array.from(this.partners.get(id) ?? []).sort((a, b) =>
			this.compareByBirth(a, b)
		);
	}

	/** People sharing at least one parent, oldest first */
	siblingsOf(id: string): Sibling[] {
		const parents = this.parentsOf(id);
		const result = new Map<string, number>();
		for (const parent of parents) {
			for (const child of this.childrenOf(parent)) {
				if (child === id) continue;
				result.set(child, (result.get(child) ?? 0) + 1);
			}
		}
		return Array.from(result.entries())
			.map(([sibling, shared]) => ({
				id: sibling,
				// Half siblings: one of them has a known parent the other lacks
				half:
					shared <
					Math.max(parents.length, this.parentsOf(sibling).length),
			}))
			.sort((a, b) => this.compareByBirth(a.id, b.id));
	}

	/** Whether `ancestor` is a (great-...)parent of `id`; cycle-safe */
	isAncestor(ancestor: string, id: string): boolean {
		const seen = new Set<string>();
		const queue = [...this.parentsOf(id)];
		while (queue.length > 0) {
			const current = queue.shift() as string;
			if (current === ancestor) return true;
			if (seen.has(current)) continue;
			seen.add(current);
			queue.push(...this.parentsOf(current));
		}
		return false;
	}

	/**
	 * Why `parent` can't become a parent of `child`, or null if it can.
	 * Prevents loops such as someone becoming their own grandparent.
	 */
	checkNewParent(child: string, parent: string): string | null {
		if (child === parent) return "A person can't be their own parent";
		if (this.parentsOf(child).includes(parent)) {
			return "Already a parent";
		}
		if (this.isAncestor(child, parent)) {
			return "That would make someone their own ancestor";
		}
		return null;
	}

	/** Oldest first; people without a known birth year go last */
	compareByBirth(a: string, b: string): number {
		const yearA = birthSortKey(this.people.get(a)?.birthday ?? "");
		const yearB = birthSortKey(this.people.get(b)?.birthday ?? "");
		if (yearA !== yearB) return yearA < yearB ? -1 : 1;
		const nameA = this.people.get(a)?.name ?? "";
		const nameB = this.people.get(b)?.name ?? "";
		return nameA.localeCompare(nameB);
	}
}

function birthSortKey(birthday: string): string {
	return /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : "9999";
}

/** "1950 – 2020", "* 1990", "† 2020", "" */
export function formatLifeDates(person: FamilyPerson): string {
	const born = /^(\d{4})-/.exec(person.birthday)?.[1] ?? "";
	const died = /^(\d{4})-/.exec(person.deathDate)?.[1] ?? "";
	if (person.deceased) {
		if (born && died) return `${born} – ${died}`;
		if (born) return `${born} – †`;
		return died ? `† ${died}` : "†";
	}
	return born ? `* ${born}` : "";
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type NodeRole = "focus" | "ancestor" | "descendant" | "sibling" | "partner";

export interface TreeNode {
	id: string;
	/** Center of the card */
	x: number;
	y: number;
	/** 0 = focus row, negative = ancestors, positive = descendants */
	generation: number;
	role: NodeRole;
}

export interface TreeLine {
	/** Polyline points */
	points: Array<[number, number]>;
	kind: "partner" | "child";
}

export interface TreeLayout {
	nodes: TreeNode[];
	lines: TreeLine[];
	width: number;
	height: number;
}

export interface LayoutOptions {
	generationsUp: number;
	generationsDown: number;
	cardWidth: number;
	cardHeight: number;
	gapX: number;
	gapY: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
	generationsUp: 3,
	generationsDown: 3,
	cardWidth: 170,
	cardHeight: 58,
	gapX: 24,
	gapY: 70,
};

/**
 * Generation layout around a focus person: ancestors above, siblings and
 * partners beside, descendants (with their partners) below. Each subtree
 * gets its own horizontal region, so cards never overlap.
 */
export function layoutFamilyTree(
	graph: FamilyGraph,
	focus: string,
	options: Partial<LayoutOptions> = {}
): TreeLayout {
	const opt = { ...DEFAULT_LAYOUT, ...options };
	const slot = opt.cardWidth + opt.gapX;
	const rowHeight = opt.cardHeight + opt.gapY;
	const nodes = new Map<string, TreeNode>();

	const place = (id: string, x: number, generation: number, role: NodeRole) => {
		if (nodes.has(id)) return;
		nodes.set(id, { id, x, y: generation * rowHeight, generation, role });
	};

	// --- Descendants: units of a person plus partners, children below ----
	const unitMembers = (id: string, depth: number): string[] => {
		// Partners of descendants are shown next to them (not for depth 0,
		// where the focus row handles partners itself)
		const partners = graph
			.partnersOf(id)
			.filter((partner) => !nodes.has(partner) && partner !== focus);
		return depth === 0 ? [id] : [id, ...partners];
	};

	const descendantWidths = new Map<string, number>();
	const visiting = new Set<string>();
	const descendantWidth = (id: string, depth: number, members: string[]): number => {
		const own = members.length * slot;
		if (depth >= opt.generationsDown || visiting.has(id)) return own;
		visiting.add(id);
		const kids = childrenOfUnit(members);
		let sum = 0;
		for (const kid of kids) {
			sum += descendantWidth(kid, depth + 1, unitMembers(kid, depth + 1));
		}
		visiting.delete(id);
		const width = Math.max(own, sum);
		descendantWidths.set(id, width);
		return width;
	};

	const childrenOfUnit = (members: string[]): string[] => {
		const kids = new Set<string>();
		for (const member of members) {
			for (const kid of graph.childrenOf(member)) kids.add(kid);
		}
		return Array.from(kids)
			.filter((kid) => kid !== focus)
			.sort((a, b) => graph.compareByBirth(a, b));
	};

	const placeDescendants = (
		members: string[],
		left: number,
		width: number,
		depth: number
	) => {
		if (depth >= opt.generationsDown) return;
		const kids = childrenOfUnit(members).filter((kid) => !nodes.has(kid));
		const widths = kids.map((kid) =>
			descendantWidth(kid, depth + 1, unitMembers(kid, depth + 1))
		);
		const total = widths.reduce((sum, w) => sum + w, 0);
		let x = left + (width - total) / 2;
		kids.forEach((kid, index) => {
			if (nodes.has(kid)) return;
			const kidMembers = unitMembers(kid, depth + 1);
			const region = widths[index];
			placeUnit(kidMembers, x, region, depth + 1, "descendant");
			placeDescendants(kidMembers, x, region, depth + 1);
			x += region;
		});
	};

	/** Cards of a unit side by side, centered in their region */
	const placeUnit = (
		members: string[],
		left: number,
		region: number,
		generation: number,
		role: NodeRole
	) => {
		const start = left + (region - members.length * slot) / 2 + slot / 2;
		members.forEach((member, index) => {
			place(
				member,
				start + index * slot,
				generation,
				index === 0 ? role : "partner"
			);
		});
	};

	// --- Focus row: older siblings, focus + partners, younger siblings ----
	const partners = graph.partnersOf(focus);
	const focusMembers = [focus, ...partners];
	const focusRegion = Math.max(
		focusMembers.length * slot,
		descendantWidth(focus, 0, focusMembers)
	);

	const siblings = graph.siblingsOf(focus).map((sibling) => sibling.id);
	const older = siblings.filter((id) => graph.compareByBirth(id, focus) < 0);
	const younger = siblings.filter((id) => graph.compareByBirth(id, focus) >= 0);

	let x = 0;
	for (const sibling of older) {
		place(sibling, x + slot / 2, 0, "sibling");
		x += slot;
	}
	const focusLeft = x;
	placeUnit(focusMembers, focusLeft, focusRegion, 0, "focus");
	x += focusRegion;
	for (const sibling of younger) {
		place(sibling, x + slot / 2, 0, "sibling");
		x += slot;
	}
	const rowWidth = x;
	placeDescendants(focusMembers, focusLeft, focusRegion, 0);

	// --- Ancestors: each person's parents above them, in own regions ----
	const ancestorWidth = (id: string, depth: number, seen: Set<string>): number => {
		if (depth >= opt.generationsUp || seen.has(id)) return slot;
		const parents = graph.parentsOf(id);
		if (parents.length === 0) return slot;
		const next = new Set(seen).add(id);
		const sum = parents.reduce(
			(total, parent) => total + ancestorWidth(parent, depth + 1, next),
			0
		);
		return Math.max(slot, sum);
	};

	const placeAncestors = (
		id: string,
		centerX: number,
		depth: number,
		seen: Set<string>
	) => {
		if (depth >= opt.generationsUp || seen.has(id)) return;
		const parents = graph.parentsOf(id).filter((parent) => !nodes.has(parent));
		if (parents.length === 0) return;
		const next = new Set(seen).add(id);
		const widths = parents.map((parent) => ancestorWidth(parent, depth + 1, next));
		const total = widths.reduce((sum, w) => sum + w, 0);
		let left = centerX - total / 2;
		parents.forEach((parent, index) => {
			const center = left + widths[index] / 2;
			place(parent, center, -(depth + 1), "ancestor");
			placeAncestors(parent, center, depth + 1, next);
			left += widths[index];
		});
	};

	// Parents sit above the middle of their children in the focus row
	const focusNode = nodes.get(focus);
	const shareParents = [focus, ...siblings].filter((id) =>
		graph.parentsOf(id).some((p) => graph.parentsOf(focus).includes(p))
	);
	const childXs = shareParents
		.map((id) => nodes.get(id)?.x)
		.filter((value): value is number => value !== undefined);
	const parentCenter =
		childXs.length > 0
			? (Math.min(...childXs) + Math.max(...childXs)) / 2
			: focusNode?.x ?? 0;
	placeAncestors(focus, parentCenter, 0, new Set());

	// --- Normalize coordinates so everything starts at (0, 0) ------------
	const all = Array.from(nodes.values());
	const minX = Math.min(...all.map((n) => n.x)) - opt.cardWidth / 2;
	const maxX = Math.max(...all.map((n) => n.x)) + opt.cardWidth / 2;
	const minY = Math.min(...all.map((n) => n.y)) - opt.cardHeight / 2;
	const maxY = Math.max(...all.map((n) => n.y)) + opt.cardHeight / 2;
	for (const node of all) {
		node.x -= minX;
		node.y -= minY;
	}

	return {
		nodes: all,
		lines: buildLines(graph, nodes, opt),
		width: Math.max(maxX - minX, rowWidth),
		height: maxY - minY,
	};
}

/** Partner lines and orthogonal parent → children connectors */
function buildLines(
	graph: FamilyGraph,
	nodes: Map<string, TreeNode>,
	opt: LayoutOptions
): TreeLine[] {
	const lines: TreeLine[] = [];
	const halfCard = opt.cardWidth / 2;

	// Partners in the same row: line between the facing card edges
	const drawn = new Set<string>();
	for (const node of nodes.values()) {
		for (const partner of graph.partnersOf(node.id)) {
			const other = nodes.get(partner);
			const key = [node.id, partner].sort().join("|");
			if (!other || drawn.has(key) || other.generation !== node.generation) {
				continue;
			}
			drawn.add(key);
			const [left, right] = node.x < other.x ? [node, other] : [other, node];
			lines.push({
				kind: "partner",
				points: [
					[left.x + halfCard, left.y],
					[right.x - halfCard, right.y],
				],
			});
		}
	}

	// Children grouped by their set of shown parents
	const families = new Map<string, { parents: TreeNode[]; children: TreeNode[] }>();
	for (const child of nodes.values()) {
		const parents = graph
			.parentsOf(child.id)
			.map((id) => nodes.get(id))
			.filter(
				(parent): parent is TreeNode =>
					!!parent && parent.generation === child.generation - 1
			);
		if (parents.length === 0) continue;
		const key = parents
			.map((parent) => parent.id)
			.sort()
			.join("|");
		const family = families.get(key) ?? { parents, children: [] };
		family.children.push(child);
		families.set(key, family);
	}

	// Different parent sets in the same row get their connector at slightly
	// different heights, so e.g. half siblings don't look like full ones
	const busesPerRow = new Map<number, number>();
	const BUS_OFFSETS = [0, 10, -10, 20, -20];

	for (const { parents, children } of families.values()) {
		const parentY = parents[0].y + opt.cardHeight / 2;
		const index = busesPerRow.get(parentY) ?? 0;
		busesPerRow.set(parentY, index + 1);
		const busY =
			parentY + opt.gapY / 2 + BUS_OFFSETS[index % BUS_OFFSETS.length];
		const parentX =
			parents.reduce((sum, parent) => sum + parent.x, 0) / parents.length;
		const childXs = children.map((child) => child.x);
		const left = Math.min(parentX, ...childXs);
		const right = Math.max(parentX, ...childXs);

		// From the parents (or the middle of the couple) down to the bus
		const startY =
			parents.length > 1 ? parents[0].y : parentY;
		lines.push({ kind: "child", points: [[parentX, startY], [parentX, busY]] });
		lines.push({ kind: "child", points: [[left, busY], [right, busY]] });
		for (const child of children) {
			lines.push({
				kind: "child",
				points: [
					[child.x, busY],
					[child.x, child.y - opt.cardHeight / 2],
				],
			});
		}
	}
	return lines;
}
