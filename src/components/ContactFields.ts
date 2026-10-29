import type FriendTracker from "@/main";

export function createRelationshipInput(
	container: HTMLElement,
	plugin: FriendTracker,
	value: string = "",
	onChange?: (value: string) => void
) {
	const input = container.createEl("input", {
		cls: "friend-tracker-modal-input",
		attr: {
			type: "text",
			value: value || "",
			placeholder: "Friend, Family, Colleague, etc.",
			list: "relationship-types",
			autocomplete: "on",
			role: "combobox",
			"aria-autocomplete": "list",
		},
	});

	// Create or get existing datalist
	let datalist = document.getElementById(
		"relationship-types"
	) as HTMLDataListElement;
	if (!datalist) {
		datalist = document.createElement("datalist");
		datalist.id = "relationship-types";
		document.body.appendChild(datalist);
	}

	// Update options
	const updateDatalist = (filter?: string) => {
		datalist.empty();
		const types = plugin.settings.relationshipTypes;
		types
			.filter((type) => !filter || type.includes(filter.toLowerCase()))
			.forEach((type) => {
				const option = datalist.createEl("option");
				option.text = type.charAt(0).toUpperCase() + type.slice(1);
			});
	};

	updateDatalist();

	// Add input event listener for immediate feedback
	input.addEventListener("input", () => {
		updateDatalist(input.value);
	});

	if (onChange) {
		input.addEventListener("change", () => {
			onChange(input.value);
		});
	}

	return input;
}
