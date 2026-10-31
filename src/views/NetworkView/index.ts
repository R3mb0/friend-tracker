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
import {
	renderKindFilter,
	renderNetwork,
	NETWORK_KINDS,
} from "@/components/NetworkRenderer";
import {
	NetworkEdgeKind,
	NetworkLayout,
	layoutNetwork,
} from "@/services/network";

export const VIEW_TYPE_NETWORK = "friend-tracker-network";

/** Relationship network around a person or organization */
export class NetworkView extends ItemView {
	private centerPath: string | null = null;
	private depth: 1 | 2 = 1;
	private kinds: NetworkEdgeKind[] = NETWORK_KINDS.map((k) => k.kind);
	private panZoomState: PanZoomState = { scale: 1, x: 0, y: 0 };
	private panZoom: PanZoom | null = null;
	private layout: NetworkLayout | null = null;
	private recenter = true;

	constructor(leaf: WorkspaceLeaf, private plugin: FriendTracker) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_NETWORK;
	}

	getDisplayText(): string {
		const name = this.centerPath?.split("/").pop()?.replace(/\.md$/, "");
		return name ? `Network: ${name}` : "Network";
	}

	getIcon(): string {
		return "share-2";
	}

	async setState(state: unknown, result: ViewStateResult) {
		const filePath = (state as { filePath?: unknown } | null)?.filePath;
		if (typeof filePath === "string") {
			this.centerPath = filePath;
			this.recenter = true;
			await this.render();
		}
		await super.setState(state, result);
	}

	getState() {
		return { type: VIEW_TYPE_NETWORK, filePath: this.centerPath };
	}

	async onOpen() {
		const scheduleRender = debounce(() => this.render(), 300, true);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (
					file instanceof TFile &&
					file.path.startsWith(this.plugin.settings.contactsFolder + "/")
				) {
					scheduleRender();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (oldPath === this.centerPath) this.centerPath = file.path;
				scheduleRender();
			})
		);
		await this.render();
	}

	private openNode(path: string) {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		if (this.plugin.contactOperations.isOrganization(file)) {
			this.plugin.openOrganization(file);
		} else {
			this.plugin.openContact(file);
		}
	}

	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		const centerPath = this.centerPath;
		if (!centerPath) {
			container.empty();
			container.createDiv({
				cls: "contact-empty-state",
				text: "Open the network from a contact or organization page.",
			});
			return;
		}

		const data = await this.plugin.networkOperations.load();
		if (this.centerPath !== centerPath) return;
		const center = data.nodes.get(centerPath);

		container.empty();
		container.addClass("friend-tracker-tree-container");
		if (!center) {
			container.createDiv({
				cls: "contact-empty-state",
				text: "This contact or organization could not be found.",
			});
			return;
		}

		this.layout = layoutNetwork(data, centerPath, {
			depth: this.depth,
			kinds: this.kinds,
		});

		// Toolbar
		const toolbar = container.createDiv({ cls: "friend-tracker-tree-toolbar" });
		toolbar.createEl("h3", { text: center.name });
		renderKindFilter(toolbar, this.kinds, (kinds) => {
			this.kinds = kinds;
			this.recenter = true;
			this.render();
		});

		const depthLabel = toolbar.createEl("label", {
			cls: "friend-tracker-tree-generations",
		});
		depthLabel.appendText("Depth ");
		const depthSelect = depthLabel.createEl("select", { cls: "dropdown" });
		depthSelect.createEl("option", { text: "1", value: "1" });
		depthSelect.createEl("option", { text: "2", value: "2" });
		depthSelect.value = String(this.depth);
		depthSelect.addEventListener("change", () => {
			this.depth = depthSelect.value === "2" ? 2 : 1;
			this.recenter = true;
			this.render();
		});

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
		setIcon(profile, center.kind === "organization" ? "building-2" : "user");
		profile.addEventListener("click", () => this.openNode(centerPath));

		// Canvas
		const viewport = container.createDiv({
			cls: "friend-tracker-tree-viewport",
		});
		const canvas = viewport.createDiv({ cls: "friend-tracker-tree-canvas" });
		this.panZoom = new PanZoom(viewport, canvas, this.panZoomState);

		renderNetwork(canvas, this.layout, {
			labels: true,
			isDragging: () => this.panZoom?.wasDragged ?? false,
			// Click: make this the center; icon/Enter: open the profile
			onNodeClick: (node) => {
				if (node.id === centerPath) return;
				this.centerPath = node.id;
				this.recenter = true;
				this.app.workspace.requestSaveLayout();
				this.render();
			},
			onNodeOpen: (node) => this.openNode(node.id),
		});

		if (this.layout.nodes.length <= 1) {
			viewport.createDiv({
				cls: "friend-tracker-tree-hint",
				text:
					this.kinds.length === 0
						? "All kinds are hidden. Turn on Family, Connections or Organizations above."
						: "No connections yet.",
			});
		}

		if (this.recenter) {
			this.recenter = false;
			requestAnimationFrame(() => {
				const node = this.layout?.nodes.find((n) => n.id === centerPath);
				if (node) this.panZoom?.centerOn(node.x, node.y);
			});
		}
	}
}

