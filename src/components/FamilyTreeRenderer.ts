import { TFile, setIcon } from "obsidian";
import {
	DEFAULT_LAYOUT,
	FamilyGraph,
	TreeLayout,
	TreeNode,
	formatLifeDates,
} from "@/services/family";

export type RelativeKind = "parent" | "partner" | "child";

export interface FamilyTreeRenderOptions {
	onCardClick?: (file: TFile, node: TreeNode) => void;
	/** Shows an "open profile" icon on each card */
	onOpen?: (file: TFile) => void;
	/** Shows "+" buttons around each card */
	onAddRelative?: (file: TFile, kind: RelativeKind) => void;
}

/**
 * Draw a family tree layout: connector lines (SVG) and person cards
 * (HTML). Used by the full tree view and the mini tree on profiles.
 */
export function renderFamilyTree(
	canvas: HTMLElement,
	layout: TreeLayout,
	graph: FamilyGraph,
	files: Map<string, TFile>,
	options: FamilyTreeRenderOptions
) {
	canvas.style.width = `${layout.width}px`;
	canvas.style.height = `${layout.height}px`;

	const svgNs = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNs, "svg");
	svg.setAttribute("class", "friend-tracker-tree-lines");
	svg.setAttribute("width", String(layout.width));
	svg.setAttribute("height", String(layout.height));
	for (const line of layout.lines) {
		const polyline = document.createElementNS(svgNs, "polyline");
		polyline.setAttribute(
			"points",
			line.points.map(([x, y]) => `${x},${y}`).join(" ")
		);
		polyline.setAttribute("class", `is-${line.kind}`);
		svg.appendChild(polyline);
	}
	canvas.appendChild(svg);

	const { cardWidth, cardHeight } = DEFAULT_LAYOUT;
	for (const node of layout.nodes) {
		const person = graph.get(node.id);
		const file = files.get(node.id);
		if (!person || !file) continue;

		const card = canvas.createDiv({
			cls: `friend-tracker-tree-card is-${node.role}`,
			attr: { tabindex: "0", "data-path": node.id },
		});
		if (person.deceased) card.addClass("is-deceased");
		card.style.left = `${node.x - cardWidth / 2}px`;
		card.style.top = `${node.y - cardHeight / 2}px`;
		card.style.width = `${cardWidth}px`;
		card.style.height = `${cardHeight}px`;

		card.createDiv({
			cls: "friend-tracker-tree-name",
			text: person.name + (person.deceased ? " †" : ""),
		});
		const dates = formatLifeDates(person);
		if (dates) {
			card.createDiv({ cls: "friend-tracker-tree-dates", text: dates });
		}

		if (options.onCardClick) {
			const onClick = options.onCardClick;
			card.addEventListener("click", () => onClick(file, node));
		}
		if (options.onOpen) {
			const onOpen = options.onOpen;
			card.addEventListener("keydown", (e) => {
				if (e.key === "Enter") onOpen(file);
			});
			// Opening the profile needs its own button: a first click on
			// another card re-renders the tree, so double-click can't work
			const open = card.createEl("button", {
				cls: "friend-tracker-tree-open",
				attr: { "aria-label": "Open profile" },
			});
			setIcon(open, "external-link");
			open.addEventListener("click", (e) => {
				e.stopPropagation();
				onOpen(file);
			});
		}
		if (options.onAddRelative) {
			renderAddButtons(card, file, options.onAddRelative);
		}
	}
}

/** "+" buttons around a card to add relatives right in the tree */
function renderAddButtons(
	card: HTMLElement,
	file: TFile,
	onAdd: (file: TFile, kind: RelativeKind) => void
) {
	const buttons: Array<{ kind: RelativeKind; label: string }> = [
		{ kind: "parent", label: "Add parent" },
		{ kind: "partner", label: "Add partner" },
		{ kind: "child", label: "Add child" },
	];
	for (const { kind, label } of buttons) {
		const button = card.createEl("button", {
			cls: `friend-tracker-tree-add is-${kind}`,
			attr: { "aria-label": label },
		});
		setIcon(button, "plus");
		button.addEventListener("click", (e) => {
			e.stopPropagation();
			onAdd(file, kind);
		});
	}
}
