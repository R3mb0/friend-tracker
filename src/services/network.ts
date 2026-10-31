/**
 * Relationship network around one person or organization ("ego network")
 * and its radial layout. Free of Obsidian APIs so it can be tested alone.
 */

export type NetworkNodeKind = "person" | "organization";
export type NetworkEdgeKind = "family" | "connection" | "organization";

export interface NetworkNode {
	id: string;
	name: string;
	kind: NetworkNodeKind;
	deceased?: boolean;
}

/** Undirected edge with a label for each direction */
export interface NetworkEdge {
	a: string;
	b: string;
	kind: NetworkEdgeKind;
	/** What b is to a, e.g. "mother" or "Engineer" */
	labelForA: string;
	/** What a is to b */
	labelForB: string;
}

export class NetworkData {
	readonly nodes = new Map<string, NetworkNode>();
	private edges: NetworkEdge[] = [];
	private byNode = new Map<string, NetworkEdge[]>();

	addNode(node: NetworkNode) {
		if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
	}

	/** Adds an edge unless the same kind already connects the two */
	addEdge(edge: NetworkEdge) {
		if (edge.a === edge.b) return;
		if (!this.nodes.has(edge.a) || !this.nodes.has(edge.b)) return;
		const existing = this.edgesOf(edge.a).find(
			(other) =>
				other.kind === edge.kind &&
				(other.a === edge.b || other.b === edge.b)
		);
		if (existing) {
			// Keep labels the first edge lacked (e.g. a reverse connection)
			const forward = existing.a === edge.a;
			if (forward) {
				existing.labelForA ||= edge.labelForA;
				existing.labelForB ||= edge.labelForB;
			} else {
				existing.labelForA ||= edge.labelForB;
				existing.labelForB ||= edge.labelForA;
			}
			return;
		}
		this.edges.push(edge);
		for (const id of [edge.a, edge.b]) {
			const list = this.byNode.get(id) ?? [];
			list.push(edge);
			this.byNode.set(id, list);
		}
	}

	edgesOf(id: string): NetworkEdge[] {
		return this.byNode.get(id) ?? [];
	}
}

/** Other end of an edge and its label as seen from `from` */
function otherEnd(edge: NetworkEdge, from: string) {
	return edge.a === from
		? { id: edge.b, label: edge.labelForA }
		: { id: edge.a, label: edge.labelForB };
}

export interface PlacedNode extends NetworkNode {
	x: number;
	y: number;
	/** 0 = center, 1 = direct link, 2 = link of a link */
	ring: number;
}

export interface PlacedEdge {
	from: string;
	to: string;
	kind: NetworkEdgeKind;
	label: string;
}

export interface NetworkLayout {
	nodes: PlacedNode[];
	edges: PlacedEdge[];
	width: number;
	height: number;
}

export interface NetworkOptions {
	depth: 1 | 2;
	kinds: NetworkEdgeKind[];
	/** Space each node needs on its ring (px) */
	nodeSpacing: number;
	ringGap: number;
	/** Half the node size, used for the bounds */
	nodeRadius: number;
	/** Cap for the second ring, so busy networks stay readable */
	maxPerParent: number;
}

export const DEFAULT_NETWORK: NetworkOptions = {
	depth: 1,
	kinds: ["family", "connection", "organization"],
	nodeSpacing: 130,
	ringGap: 150,
	nodeRadius: 60,
	maxPerParent: 6,
};

// Order around the circle: family, then organizations, then connections
const KIND_ORDER: Record<NetworkEdgeKind, number> = {
	family: 0,
	organization: 1,
	connection: 2,
};

export function layoutNetwork(
	data: NetworkData,
	center: string,
	options: Partial<NetworkOptions> = {}
): NetworkLayout {
	const opt = { ...DEFAULT_NETWORK, ...options };
	const centerNode = data.nodes.get(center);
	if (!centerNode) return { nodes: [], edges: [], width: 0, height: 0 };

	const allowed = (edge: NetworkEdge) => opt.kinds.includes(edge.kind);
	const placed = new Map<string, PlacedNode>();
	const edges: PlacedEdge[] = [];
	placed.set(center, { ...centerNode, x: 0, y: 0, ring: 0 });

	// --- Ring 1: direct links, grouped by kind -------------------------
	const first = data
		.edgesOf(center)
		.filter(allowed)
		.map((edge) => ({ edge, ...otherEnd(edge, center) }))
		.sort(
			(p, q) =>
				KIND_ORDER[p.edge.kind] - KIND_ORDER[q.edge.kind] ||
				(data.nodes.get(p.id)?.name ?? "").localeCompare(
					data.nodes.get(q.id)?.name ?? ""
				)
		);

	const radius1 = Math.max(
		opt.ringGap,
		(first.length * opt.nodeSpacing) / (2 * Math.PI)
	);
	const step1 = (2 * Math.PI) / Math.max(1, first.length);
	first.forEach(({ id, edge, label }, index) => {
		// Start at the top and go clockwise
		const angle = -Math.PI / 2 + index * step1;
		const node = data.nodes.get(id);
		if (!node || placed.has(id)) return;
		placed.set(id, {
			...node,
			x: Math.cos(angle) * radius1,
			y: Math.sin(angle) * radius1,
			ring: 1,
		});
		edges.push({ from: center, to: id, kind: edge.kind, label });
	});

	// --- Ring 2: links of links, within their parent's sector -----------
	if (opt.depth === 2) {
		const ring1 = Array.from(placed.values()).filter((n) => n.ring === 1);
		const groups = ring1.map((parent) => {
			const children = data
				.edgesOf(parent.id)
				.filter(allowed)
				.map((edge) => ({ edge, ...otherEnd(edge, parent.id) }))
				.filter(({ id }) => !placed.has(id))
				.slice(0, opt.maxPerParent);
			return { parent, children };
		});
		const total = groups.reduce((sum, g) => sum + g.children.length, 0);
		const radius2 = Math.max(
			radius1 + opt.ringGap,
			(total * opt.nodeSpacing) / (2 * Math.PI)
		);
		const sector = step1;

		for (const { parent, children } of groups) {
			const parentAngle = Math.atan2(parent.y, parent.x);
			const spread = Math.min(
				sector * 0.9,
				(children.length * opt.nodeSpacing) / radius2
			);
			children.forEach(({ id, edge, label }, index) => {
				const node = data.nodes.get(id);
				if (!node) return;
				if (!placed.has(id)) {
					const offset =
						children.length > 1
							? -spread / 2 + (index * spread) / (children.length - 1)
							: 0;
					const angle = parentAngle + offset;
					placed.set(id, {
						...node,
						x: Math.cos(angle) * radius2,
						y: Math.sin(angle) * radius2,
						ring: 2,
					});
				}
				edges.push({ from: parent.id, to: id, kind: edge.kind, label });
			});
		}

		// Links between ring-1 nodes themselves (e.g. both parents married)
		for (let i = 0; i < ring1.length; i++) {
			for (const edge of data.edgesOf(ring1[i].id).filter(allowed)) {
				const other = otherEnd(edge, ring1[i].id);
				const target = placed.get(other.id);
				if (!target || target.ring !== 1 || other.id < ring1[i].id) {
					continue;
				}
				edges.push({
					from: ring1[i].id,
					to: other.id,
					kind: edge.kind,
					label: other.label,
				});
			}
		}
	}

	// --- Normalize to positive coordinates -------------------------------
	const nodes = Array.from(placed.values());
	const pad = opt.nodeRadius;
	const minX = Math.min(...nodes.map((n) => n.x)) - pad;
	const minY = Math.min(...nodes.map((n) => n.y)) - pad;
	const maxX = Math.max(...nodes.map((n) => n.x)) + pad;
	const maxY = Math.max(...nodes.map((n) => n.y)) + pad;
	for (const node of nodes) {
		node.x -= minX;
		node.y -= minY;
	}
	return { nodes, edges, width: maxX - minX, height: maxY - minY };
}
