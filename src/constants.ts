import type { InteractionType } from "@/types";

type StandardFieldKey = keyof typeof STANDARD_FIELDS;
type StandardFieldValue = (typeof STANDARD_FIELDS)[StandardFieldKey];

export const STANDARD_FIELDS = {
	NAME: "name",
	BIRTHDAY: "birthday",
	EMAIL: "email",
	PHONE: "phone",
	ADDRESS: "address",
	RELATIONSHIP: "relationship",
	INTERACTIONS: "interactions",
	DECEASED: "deceased",
	CONTACT_INTERVAL: "contact_interval",
	CONNECTIONS: "connections",
	ORGANIZATIONS: "organizations",
	PARENTS: "parents",
	PARTNERS: "partners",
	CREATED: "created",
	UPDATED: "updated",
	NOTES: "notes",
	NOTE_SECTIONS: "note_sections",
	EXTRAS: "extras",
} as const;

// System fields that shouldn't be shown as custom fields
export const SYSTEM_FIELDS: StandardFieldValue[] = [
	STANDARD_FIELDS.NAME,
	STANDARD_FIELDS.INTERACTIONS,
	STANDARD_FIELDS.DECEASED,
	STANDARD_FIELDS.CONTACT_INTERVAL,
	STANDARD_FIELDS.CONNECTIONS,
	STANDARD_FIELDS.ORGANIZATIONS,
	STANDARD_FIELDS.PARENTS,
	STANDARD_FIELDS.PARTNERS,
	STANDARD_FIELDS.CREATED,
	STANDARD_FIELDS.UPDATED,
	STANDARD_FIELDS.NOTES,
	STANDARD_FIELDS.NOTE_SECTIONS,
	STANDARD_FIELDS.EXTRAS,
];

// Fields that have special input handling
export const SPECIAL_INPUT_FIELDS = {
	[STANDARD_FIELDS.BIRTHDAY]: "date",
	[STANDARD_FIELDS.PHONE]: "tel",
	[STANDARD_FIELDS.EMAIL]: "email",
} as const;


export const INTERACTION_TYPES: Array<{
	id: InteractionType;
	label: string;
	icon: string;
}> = [
	{ id: "meeting", label: "Meeting", icon: "users" },
	{ id: "call", label: "Call", icon: "phone" },
	{ id: "video", label: "Video call", icon: "video" },
	{ id: "message", label: "Message", icon: "message-square" },
	{ id: "other", label: "Other", icon: "circle-dot" },
];

export function getInteractionType(type: unknown) {
	return INTERACTION_TYPES.find((entry) => entry.id === type) ?? null;
}
