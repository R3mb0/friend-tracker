# Changelog

All notable changes to Friend Tracker are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

**Keeping in touch**
- "Keep in touch every N days" goal: a default in the settings (30 days) that each contact can override in its details (0 = no goal). "Last interaction" is colored relative to this goal: green while well within it, yellow when nearly due, red once overdue.
- The overview header shows how many contacts are overdue, plus a "Reach out today" list with the three most overdue contacts, one click away.
- Interaction types: meeting, call, video call, message and other, shown as icons. They can be chosen in the dialog and in the quick add.

**Reminders**
- Configurable birthday reminders: notices on startup for birthdays within N days (default 1 = today and tomorrow).

**Commands** (also usable with hotkeys)
- Open overview, Add contact, Open contact…, Log interaction… (with fuzzy contact search), Export contacts as vCard, Import contacts from vCard…

**Connections between contacts**
- Link contacts with a relation (e.g. "Max is Anna's brother"), optionally with the reverse direction stored in the other contact. Contacts that link to someone without a link back are shown too.

**Daily notes and mentions**
- Interaction dates link to the daily note of that day, if it exists (core "Daily notes" plugin).
- The Interactions tab lists notes that link to the contact ("Mentioned in").

**vCard import and export**
- Export all contacts to "Friend Tracker contacts.vcf" in the vault root, and import contacts from a .vcf file. Apple's "year unknown" birthdays are supported. Existing contacts are skipped.

**Bulk actions**
- Selection mode in the overview: select contacts with checkboxes (including "select all"), then set their type, log one interaction for all of them, or delete them.

**More**
- Hide or show deceased contacts in the overview.
- Template for new contacts: note sections and custom fields every new contact starts with (settings).

**Overview**
- Search bar that filters contacts by name and relationship as you type. It ignores case and accents, and every word must match.
- Relationship filter listing the relationship types your contacts actually use.
- At-a-glance stats in the header: number of contacts, next birthday, and who you haven't been in touch with the longest.
- "Add interaction" button on every row to log an interaction without opening the contact.

**Contact profile**
- Header with relationship tag, birthday countdown, age and last contact, colored like the overview. Zodiac, season and birthstone are shown below in smaller text.
- Menu next to the name: open note, show all contacts, mark as deceased, delete contact.
- Phone and email are clickable (`tel:` / `mailto:`) and have a copy button.
- Empty fields show a placeholder such as "Add phone" that jumps straight into edit mode.
- Custom fields can be removed, not just cleared.
- Quick add for interactions: type and press Enter to log something for today.
- Interactions show relative dates ("3 days ago"). Longer lists are grouped by month.
- Deleted interactions and note sections can be restored with "Undo".
- The Interactions tab shows how many entries there are.

**Notes sections**
- The Notes tab has a fixed "General" block plus your own sections with a heading, e.g. Diet, Sports, Gift ideas. Sections can be renamed, reordered and deleted, and are stored in `note_sections`.

**Deceased contacts**
- Mark a contact as deceased, with or without a date of death (stored in `deceased`).
- Deceased contacts are shown muted with "†" and their age at death. They get no birthday countdown, no birthday reminders and no "overdue" warnings.

**Birthdays without a year**
- "Year unknown" option when adding or editing a birthday (stored as `--MM-DD`).
- Countdown, reminders, sorting and zodiac work as usual. Age is left out.

### Changed

**Overview**
- Redesigned header with a solid background and a centered title. Search, filter and "Add contact" sit in a bar between the header and the table.
- Only the table scrolls; header and column headings stay in place.
- The whole row opens the contact, also with Tab + Enter. Rows are highlighted on hover.
- Delete and add buttons only appear on hover or keyboard focus. They stay visible on touch devices.
- Sort arrows on all columns; the active column is highlighted.
- Birthday and countdown are combined into one column, e.g. "October 29 · in 3 days".
- Relationship types are shown as colored tags.
- "Last interaction" is color-coded relative to the contact's "keep in touch" goal.
- The header stat "longest without contact" was replaced by the overdue count and "Reach out today".
- Rows with a birthday within a week are tinted green.
- Empty values show "–" instead of "N/A".
- In narrow sidebars the Age and Type columns are hidden. The name column stays visible when scrolling sideways.

**Contact profile**
- Details are listed in a fixed order with icons: birthday, phone, email, address, then custom fields.
- Notes are saved automatically while typing.
- "Edit markdown" opens the note in a split next to the profile.

**General**
- Dates follow your system language.
- "Last interaction" reads "Today" or "12 days ago".

### Fixed

- Editing or deleting an interaction could change the wrong entry if the file wasn't sorted by date.
- "Last interaction" sorted alphabetically ("12 days" before "3 days").
- Several dates were off by one day depending on the time zone: the default date of a new interaction after midnight, "days ago" (could show -1), and birthday sorting.
- Contact files with Windows line endings (CRLF) were not recognized.
- The "folder not found" notice appeared on every refresh when the contacts folder didn't exist yet.
- Names with characters like `/` or `:` broke contact creation and renaming. Duplicate names are now rejected with a clear message.
- `mailto:` and other external links in the Markdown tab created empty notes.
- Relationship suggestions in edit mode only worked after the "Add contact" dialog had been opened once.
- The profile didn't update after the note was edited elsewhere, and stayed open after the contact was deleted.
- The overview missed new, deleted and renamed contacts, lost its scroll position and could drop refreshes.
- Switching tabs on the profile left edit mode.
- Notes could be lost when closing the profile right after typing.
- Contacts without a `name` field showed "No contact data available". They now use the file name.
- Internal fields such as `extras` were listed on the profile, and lists or nested values showed as raw text or `[object Object]`.
- The Chinese zodiac ignored the lunar new year, so January and early February birthdays could get the wrong animal.
- The ribbon icon could open a second overview if the first one had not loaded yet.
- The plugin overrode Obsidian's green theme color (`--color-green`) globally, affecting themes and other plugins.

### Developer

- Pinned the `obsidian` API to 1.7.2, updated TypeScript to 5.4, and added ESLint with `npm run lint`.
- Release workflow uses `actions/*@v4`, Node 20 and `npm ci`.
- Shared helpers for dates (`src/utils/date.ts`), frontmatter (`src/utils/frontmatter.ts`), file names (`src/utils/file.ts`) and display (`src/utils/display.ts`).
- New frontmatter fields: `contact_interval`, `connections`, and `type` on interactions.
- Contact creation lives in `ContactOperations.createContact` (used by the dialog and the vCard import). vCard handling is in `src/services/vcard.ts`, free of Obsidian APIs.
