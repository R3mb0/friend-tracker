import { setIcon } from "obsidian";
import type {
	NetworkEdgeKind,
	NetworkLayout,
	PlacedNode,
} from "@/services/network";

export const NETWORK_KINDS: Array<{
	kind: NetworkEdgeKind;
	label: string;
	icon: string;
}> = [
	{ kind: "family", label: "Family", icon: "network" },
	{ kind: "connection", label: "Connections", icon: "link" },
	{ kind: "organization", label: "Organizations", icon: "building-2" },
];

export interface NetworkRenderOptions {
	/** Show relation labels on the lines */
	labels: boolean;
	onNodeClick?: (node: PlacedNode) => void;
	onNodeOpen?: (node: PlacedNode) => void;
	/** Ignore clicks right after dragging */
	isDragging?: () => boolean;
}

/**
 * Draw nodes (HTML) and lines (SVG) of a network layout into `canvas`.
 * Node colors follow the kind of link to the center.
 */
export function renderNetwork(
	canvas: HTMLElement,
	layout: NetworkLayout,
	options: NetworkRenderOptions
) {
	canvas.style.width = `${layout.width}px`;
	canvas.style.height = `${layout.height}px`;
	const byId = new Map(layout.nodes.map((node) => [node.id, node]));

	// Kind of the link that brought each node into the picture
	const kindOf = new Map<string, NetworkEdgeKind>();
	for (const edge of layout.edges) {
		if (!kindOf.has(edge.to)) kindOf.set(edge.to, edge.kind);
	}

	const svgNs = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNs, "svg");
	svg.setAttribute("class", "friend-tracker-net-lines");
	svg.setAttribute("width", String(layout.width));
	svg.setAttribute("height", String(layout.height));

	const labelLayer = document.createElementNS(svgNs, "g");
	for (const edge of layout.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (!from || !to) continue;
		const line = document.createElementNS(svgNs, "line");
		line.setAttribute("x1", String(from.x));
		line.setAttribute("y1", String(from.y));
		line.setAttribute("x2", String(to.x));
		line.setAttribute("y2", String(to.y));
		line.setAttribute("class", `is-${edge.kind}`);
		svg.appendChild(line);

		if (options.labels && edge.label) {
			const text = document.createElementNS(svgNs, "text");
			text.setAttribute("x", String((from.x + to.x) / 2));
			text.setAttribute("y", String((from.y + to.y) / 2));
			text.setAttribute("class", `is-${edge.kind}`);
			text.textContent = edge.label;
			labelLayer.appendChild(text);
		}
	}
	// Labels above all lines
	svg.appendChild(labelLayer);
	canvas.appendChild(svg);

	for (const node of layout.nodes) {
		const el = canvas.createDiv({
			cls: [
				"friend-tracker-net-node",
				`is-${node.kind}`,
				node.ring === 0 ? "is-center" : `is-via-${kindOf.get(node.id)}`,
			].join(" "),
			attr: { tabindex: "0" },
		});
		if (node.deceased) el.addClass("is-deceased");
		el.style.left = `${node.x}px`;
		el.style.top = `${node.y}px`;

		if (node.kind === "organization") {
			setIcon(el.createSpan({ cls: "friend-tracker-net-icon" }), "building-2");
		}
		el.createSpan({
			cls: "friend-tracker-net-name",
			text: node.name + (node.deceased ? " †" : ""),
		});

		el.addEventListener("click", () => {
			if (options.isDragging?.()) return;
			options.onNodeClick?.(node);
		});
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter") options.onNodeOpen?.(node);
		});

		if (options.onNodeOpen) {
			const onOpen = options.onNodeOpen;
			const open = el.createEl("button", {
				cls: "friend-tracker-net-open",
				attr: { "aria-label": "Open profile" },
			});
			setIcon(open, "external-link");
			open.addEventListener("click", (e) => {
				e.stopPropagation();
				onOpen(node);
			});
		}
	}
}

/** Toggle buttons for the link kinds; calls `onChange` with the new set */
export function renderKindFilter(
	container: HTMLElement,
	active: NetworkEdgeKind[],
	onChange: (kinds: NetworkEdgeKind[]) => void
) {
	const filter = container.createDiv({ cls: "friend-tracker-net-filter" });
	for (const { kind, label, icon } of NETWORK_KINDS) {
		const isOn = active.includes(kind);
		const button = filter.createEl("button", {
			cls: `friend-tracker-net-toggle is-${kind}${isOn ? " is-active" : ""}`,
			attr: { "aria-pressed": String(isOn) },
		});
		setIcon(button.createSpan({ cls: "friend-tracker-net-toggle-icon" }), icon);
		button.createSpan({ text: label });
		button.addEventListener("click", () => {
			const next = isOn
				? active.filter((k) => k !== kind)
				: [...active, kind];
			onChange(next);
		});
	}
}
