import { TFile, setIcon } from "obsidian";
import type FriendTracker from "@/main";
import {
	NETWORK_KINDS,
	renderKindFilter,
	renderNetwork,
} from "@/components/NetworkRenderer";
import { NetworkEdgeKind, layoutNetwork } from "@/services/network";

// Space kept free around the network inside the box
const MINI_PADDING = 12;

/** Filter state of a mini network; owned by the page so it survives re-renders */
export interface MiniNetworkState {
	kinds: NetworkEdgeKind[];
}

export function createMiniNetworkState(): MiniNetworkState {
	return { kinds: NETWORK_KINDS.map((k) => k.kind) };
}

/**
 * Small network (family, connections, organizations) for profile pages.
 * Kinds can be toggled; a click on a node opens its page, the expand
 * button opens the full network view.
 */
export async function renderMiniNetwork(
	section: HTMLElement,
	plugin: FriendTracker,
	file: TFile,
	state: MiniNetworkState
) {
	section.empty();
	const header = section.createDiv({ cls: "contact-connections-header" });
	header.createEl("h3", { text: "Network" });
	const expand = header.createEl("button", {
		cls: "clickable-icon",
		attr: { "aria-label": "Open full network" },
	});
	setIcon(expand, "maximize-2");
	expand.addEventListener("click", () => plugin.openNetwork(file));

	renderKindFilter(section, state.kinds, (kinds) => {
		state.kinds = kinds;
		renderMiniNetwork(section, plugin, file, state);
	});

	const box = section.createDiv({ cls: "friend-tracker-mini-net" });
	const data = await plugin.networkOperations.load();
	if (!section.isConnected) return;

	const layout = layoutNetwork(data, file.path, { kinds: state.kinds });
	if (layout.nodes.length <= 1) {
		box.addClass("is-empty");
		box.createDiv({
			cls: "contact-connections-empty",
			text:
				state.kinds.length === 0
					? "All kinds are hidden"
					: "No family, connections or organizations yet",
		});
		return;
	}

	const canvas = box.createDiv({ cls: "friend-tracker-tree-canvas" });
	renderNetwork(canvas, layout, {
		labels: true,
		onNodeClick: (node) => {
			if (node.id === file.path) return;
			const target = plugin.app.vault.getFileByPath(node.id);
			if (!target) return;
			if (plugin.contactOperations.isOrganization(target)) {
				plugin.openOrganization(target);
			} else {
				plugin.openContact(target);
			}
		},
	});

	// Scale the whole network into the box once its size is known
	requestAnimationFrame(() => {
		const width = box.clientWidth - MINI_PADDING * 2;
		const height = box.clientHeight - MINI_PADDING * 2;
		const scale = Math.min(
			1,
			width / layout.width,
			height / layout.height
		);
		const x = (box.clientWidth - layout.width * scale) / 2;
		const y = (box.clientHeight - layout.height * scale) / 2;
		canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
	});
}
