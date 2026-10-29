import { App, TFile, moment, normalizePath } from "obsidian";

interface DailyNotesOptions {
	folder?: string;
	format?: string;
}

// Shape of Obsidian's internal plugin registry (not part of the public API)
interface InternalPlugins {
	getPluginById?: (id: string) =>
		| { enabled?: boolean; instance?: { options?: DailyNotesOptions } }
		| undefined;
}

/** Settings of the core "Daily notes" plugin, or null when it's off */
function getDailyNotesOptions(app: App): DailyNotesOptions | null {
	const internal = (app as unknown as { internalPlugins?: InternalPlugins })
		.internalPlugins;
	const plugin = internal?.getPluginById?.("daily-notes");
	if (!plugin?.enabled) return null;
	return plugin.instance?.options ?? {};
}

/** The existing daily note for a "YYYY-MM-DD" date, if any */
export function getDailyNote(app: App, date: string): TFile | null {
	const options = getDailyNotesOptions(app);
	if (!options) return null;

	const day = moment(date, "YYYY-MM-DD", true);
	if (!day.isValid()) return null;

	const name = day.format(options.format || "YYYY-MM-DD");
	const folder = options.folder?.trim();
	const path = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	return app.vault.getFileByPath(path);
}
