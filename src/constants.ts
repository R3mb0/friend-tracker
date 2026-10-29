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
