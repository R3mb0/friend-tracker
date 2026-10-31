import type FriendTracker from "@/main";
import { NetworkData } from "@/services/network";
import {
	getLinkTarget,
	parseConnections,
	parseDeceased,
	parseMemberships,
} from "@/services/ContactOperations";

/** Builds the relationship network from contacts and organizations */
export class NetworkOperations {
	constructor(private plugin: FriendTracker) {}

	async load(): Promise<NetworkData> {
		const app = this.plugin.app;
		const ops = this.plugin.contactOperations;
		const data = new NetworkData();
		const entries = await ops.getContactData();

		for (const { file, data: contact } of entries) {
			data.addNode({
				id: file.path,
				name:
					typeof contact.name === "string" && contact.name.trim()
						? contact.name.trim()
						: file.basename,
				kind: "person",
				deceased: parseDeceased(contact.deceased).deceased,
			});
		}
		for (const organization of ops.getOrganizations()) {
			data.addNode({
				id: organization.path,
				name: organization.basename,
				kind: "organization",
			});
		}

		// Family: parents, partners and (derived) siblings
		const { graph } = await this.plugin.familyOperations.load();
		for (const { file } of entries) {
			const id = file.path;
			for (const parent of graph.parentsOf(id)) {
				data.addEdge({
					a: id,
					b: parent,
					kind: "family",
					labelForA: "parent",
					labelForB: "child",
				});
			}
			for (const partner of graph.partnersOf(id)) {
				data.addEdge({
					a: id,
					b: partner,
					kind: "family",
					labelForA: "partner",
					labelForB: "partner",
				});
			}
			for (const sibling of graph.siblingsOf(id)) {
				const label = sibling.half ? "half sibling" : "sibling";
				data.addEdge({
					a: id,
					b: sibling.id,
					kind: "family",
					labelForA: label,
					labelForB: label,
				});
			}
		}

		const resolve = (link: string, from: string) =>
			app.metadataCache.getFirstLinkpathDest(getLinkTarget(link), from)
				?.path;

		// Connections ("Max is Anna's brother") and memberships
		for (const { file, data: contact } of entries) {
			for (const connection of parseConnections(contact.connections)) {
				const target = resolve(connection.contact, file.path);
				if (!target) continue;
				data.addEdge({
					a: file.path,
					b: target,
					kind: "connection",
					labelForA: connection.relation,
					labelForB: "",
				});
			}
			for (const membership of parseMemberships(contact.organizations)) {
				const target = resolve(membership.organization, file.path);
				if (!target) continue;
				const role = membership.role || "member";
				data.addEdge({
					a: file.path,
					b: target,
					kind: "organization",
					labelForA: role,
					labelForB: role,
				});
			}
		}
		return data;
	}
}
