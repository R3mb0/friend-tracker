import {
	ItemView,
	TFile,
	ViewStateResult,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";
import type FriendTracker from "@/main";
import { PanZoom, PanZoomState } from "@/components/PanZoom";
import { renderFamilyTree } from "@/components/FamilyTreeRenderer";
import {
	DEFAULT_LAYOUT,
	FamilyGraph,
	TreeLayout,
	layoutFamilyTree,
} from "@/services/family";

export const VIEW_TYPE_FAMILY_TREE = "friend-tracker-family-tree";


/** Interactive family tree around one focus person */
export class FamilyTreeView extends ItemView {
	private focusPath: string | null = null;
	private generationsUp = DEFAULT_LAYOUT.generationsUp;
	private generationsDown = DEFAULT_LAYOUT.generationsDown;

	// Pan and zoom (state survives re-renders)
	private panZoomState: PanZoomState = { scale: 1, x: 0, y: 0 };
	private panZoom: PanZoom | null = null;
	private layout: TreeLayout | null = null;
	/** Center on the focus after the next render instead of keeping the view */
	private recenter = true;

	constructor(leaf: WorkspaceLeaf, private plugin: FriendTracker) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_FAMILY_TREE;
	}

	getDisplayText(): string {
		const name = this.focusPath?.split("/").pop()?.replace(/\.md$/, "");
		return name ? `Family tree: ${name}` : "Family tree";
	}

	getIcon(): string {
		return "network";
	}

	async setState(state: unknown, result: ViewStateResult) {
		const filePath = (state as { filePath?: unknown } | null)?.filePath;
		if (typeof filePath === "string") {
			this.focusPath = filePath;
			this.recenter = true;
			await this.render();
		}
		await super.setState(state, result);
	}

	getState() {
		return { type: VIEW_TYPE_FAMILY_TREE, filePath: this.focusPath };
	}

	async onOpen() {
		// Redraw when contacts change (e.g. a relative was added elsewhere)
		const scheduleRender = debounce(() => this.render(), 300, true);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (
					file instanceof TFile &&
					file.parent?.path === this.plugin.settings.contactsFolder
				) {
					scheduleRender();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (oldPath === this.focusPath) this.focusPath = file.path;
				scheduleRender();
			})
		);
		await this.render();
	}

	private focusFile(): TFile | null {
		return this.focusPath
			? this.app.vault.getFileByPath(this.focusPath)
			: null;
	}

	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		const focus = this.focusFile();
		if (!focus) {
			container.empty();
			container.createDiv({
				cls: "contact-empty-state",
				text: "Open a family tree from a contact's page.",
			});
			return;
		}

		const { graph, files } = await this.plugin.familyOperations.load();
		if (this.focusFile() !== focus) return;
		if (!graph.has(focus.path)) {
			container.empty();
			container.createDiv({
				cls: "contact-empty-state",
				text: "This contact could not be found.",
			});
			return;
		}

		this.layout = layoutFamilyTree(graph, focus.path, {
			generationsUp: this.generationsUp,
			generationsDown: this.generationsDown,
		});

		container.empty();
		container.addClass("friend-tracker-tree-container");
		this.renderToolbar(container, focus, graph);

		const viewport = container.createDiv({ cls: "friend-tracker-tree-viewport" });
		const canvas = viewport.createDiv({ cls: "friend-tracker-tree-canvas" });
		renderFamilyTree(canvas, this.layout, graph, files, {
			// Click: center this person; icon/Enter: open the profile
			onCardClick: (file) => {
				if (this.panZoom?.wasDragged) return;
				if (file !== focus) this.setFocus(file);
			},
			onOpen: (file) => this.plugin.openContact(file),
			onAddRelative: (file, kind) =>
				this.plugin.addRelative(file, kind, () => this.render()),
		});

		if (graph.parentsOf(focus.path).length === 0 &&
			graph.partnersOf(focus.path).length === 0 &&
			graph.childrenOf(focus.path).length === 0) {
			viewport.createDiv({
				cls: "friend-tracker-tree-hint",
				text: "No relatives yet. Hover over the card and use + to add parents, partners or children.",
			});
		}

		this.panZoom = new PanZoom(viewport, canvas, this.panZoomState);
		if (this.recenter) {
			this.recenter = false;
			// Wait for layout so the viewport has its size
			requestAnimationFrame(() => this.centerOn(focus.path));
		}
	}

	private renderToolbar(container: HTMLElement, focus: TFile, graph: FamilyGraph) {
		const toolbar = container.createDiv({ cls: "friend-tracker-tree-toolbar" });
		const person = graph.get(focus.path);
		toolbar.createEl("h3", { text: person?.name ?? focus.basename });

		const generations = (
			label: string,
			value: number,
			onChange: (value: number) => void
		) => {
			const wrapper = toolbar.createEl("label", {
				cls: "friend-tracker-tree-generations",
			});
			wrapper.appendText(label);
			const select = wrapper.createEl("select", { cls: "dropdown" });
			for (let i = 0; i <= 6; i++) {
				select.createEl("option", { text: String(i), value: String(i) });
			}
			select.value = String(value);
			select.addEventListener("change", () => {
				onChange(Number(select.value));
				this.recenter = true;
				this.render();
			});
		};
		generations("Up ", this.generationsUp, (v) => (this.generationsUp = v));
		generations("Down ", this.generationsDown, (v) => (this.generationsDown = v));

		const fit = toolbar.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Fit to screen" },
		});
		setIcon(fit, "maximize");
		fit.addEventListener("click", () => {
			if (this.layout) {
				this.panZoom?.fit(this.layout.width, this.layout.height);
			}
		});

		const profile = toolbar.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Open profile" },
		});
		setIcon(profile, "user");
		profile.addEventListener("click", () => this.plugin.openContact(focus));
	}

	setFocus(file: TFile) {
		this.focusPath = file.path;
		this.recenter = true;
		this.app.workspace.requestSaveLayout();
		this.render();
	}

	/** Put a person in the middle of the view at the current zoom */
	private centerOn(path: string) {
		const node = this.layout?.nodes.find((n) => n.id === path);
		if (node) this.panZoom?.centerOn(node.x, node.y);
	}
}
