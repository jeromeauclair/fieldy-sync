# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0

First release, licensed under the Functional Source License (FSL-1.1-MIT). Requires Obsidian 1.14.0 or newer. Tested on desktop; it installs on mobile with a one-time "not tested yet" notice (full mobile support is planned for 1.2). Documentation: [README](https://github.com/jeromeauclair/fieldy-sync/blob/main/README.md), [user guide](https://github.com/jeromeauclair/fieldy-sync/blob/main/docs/guide.md) and [reference](https://github.com/jeromeauclair/fieldy-sync/blob/main/docs/reference.md).

### Notes and sync

- Import and sync Fieldy conversations into Markdown notes: title, date, duration, speakers, location, template, keywords, summary, full memory content, tasks, quotes, optional share links and transcript.
- Duplicate-free, idempotent sync keyed on `fieldy_id`; renamed and moved notes keep syncing.
- A Fieldy section between short `%% fieldy:begin %%` / `%% fieldy:end %%` markers, with its hash and fingerprint in `fieldy_hash` and `fieldy_src`: text outside it is never modified. Edits inside it turn the note into the user's edited version, which sync leaves exactly as written (no conflicts, no warnings). The original stays in Fieldy and can be restored, keeping the edits below it or discarding them.
- Note banners in Live Preview and reading view show the section's state (Synced, Edited, Paused), when it was last synced, and buttons to show it in the panel, refresh or restore it; colours follow the theme or your own, for light and dark mode. Task ids are hidden in Live Preview.
- Manual sync, sync on startup and periodic sync (default window: the last 7 days); never overlapping; status bar progress and one summary per run.
- Import dialog for date ranges up to the entire history, with per-conversation status, filtering and selection.
- Transcript formats: paragraphs, timestamped, timestamped with speakers; time of day or elapsed; optional collapsed callout.
- Subfolders by year, month, year/month, ISO week, day, or a custom Moment format.
- Optional speaker links: speaker names matching a people note's name or alias become links in the note, its `fieldy_speakers` property and, optionally, the transcript. Creating a people note later updates the conversation notes that mention that person. Optionally, sync creates a people note for speakers who have none.
- **Use Fieldy share links** (on by default): off, the plugin never lists, checks, creates or changes share links and shows none.
- A Fieldy share link for every new note, if the conversation has none (on by default; the author name is copied from a link made in the Fieldy app, or else the account email's name; transcript included unless turned off). A failure never blocks the note.
- Tasks as checkboxes; ticking is never an edit. Optional, off by default: ticked tasks are marked completed in Fieldy. Optional `[due:: …]` due dates for Dataview.

### Side panel

- Connection status with the requests sent in the last minute; last sync; sync, import and edited-notes buttons.
- Conversations: periods from today to the entire history (including 3 and 14 days), search, content icons (brief, summary, memory content, tasks, quotes, share link, location, calendar event) and recording source, icon filters and a filter bar (date, time of day, speaker, location, note status). Card icons copy their content on click and offer insert, the Tasks plugin format, Google Maps or OpenStreetMap, and the share link on right-click. Copy and Insert menus grey out pieces a conversation lacks. Cards open in place without the list jumping; a loaded transcript can be hidden again. An expanded card's share link switch creates the conversation's Fieldy share link or turns it on or off, with the link and a copy button.
- Tasks tab: icon filters for open, completed and dismissed tasks with counts (only these, hidden or any, like the Conversations filters), grouping by due date or conversation; mark done, reopen, edit title and due date, or cancel in Fieldy (only on click); insert or copy as Obsidian Tasks items (emoji or Dataview format, global filter) when the Tasks plugin is enabled.
- Account: connection, export, speaker profiles, and memory templates with their last change.

### Privacy filters and sync times

- **Privacy** settings page: private keywords, speakers, places and Fieldy memory templates (one per line; case and accents ignored; whole words, `*` for word starts), and private times as a small form of rules (days, from, to, combined with *or*, *and*, *except*). A conversation with any moment in a private time is private.
- Private conversations get no note, their tasks are hidden, and they are left out of exports and shown as *Private* in the import dialog. In the panel they appear as a brief card with their date and the matching filter (optionally their title), and never match a search or another filter; a lock icon in the filter row shows only them, hides them, or either.
- Notes imported before a filter matched are kept as they are, no longer updated, with a *Private* banner, and listed in the settings; optionally (off by default, asks first) sync moves them to the trash instead.
- Privacy filters are a filter, not security: the settings and docs say so. Anyone with the API key can read the whole Fieldy account.
- Optional **Also search transcripts**, with a warning about the extra requests: each transcript is checked once and the result remembered.
- **Only sync conversations recorded at** (Sync settings): the same time rules, such as *Mon–Fri 08:00–18:00, except 12:00–13:00*. Conversations that started at other times are left alone by sync; imports are not limited.

### Dashboards, Dataview and export

- `fieldy` code blocks list conversations, tasks or stats from the vault's Fieldy notes in any note (period, speaker, kind, task status, sort, limit), updated live, without other plugins or requests.
- Dataview-ready notes and a command inserting ready-made Fieldy and Dataview queries.
- Export the entire history or a date range, with or without brief conversations, to one vault file as Markdown, JSON, CSV or plain text, with tasks and optional transcripts; cancellable, with the time left shown.

### Settings, security and robustness

- Settings in pages, with a getting-started guide, a plain-language explanation of every option and live previews of file names, dates and transcript format.
- API key stored with Obsidian's secret storage; never written to settings, logs, notices or notes.
- Rate limiting within Fieldy's 100 requests per minute, retries with backoff, timeouts, cancellation and clear error messages.
- Built for long histories: panel lists are drawn in batches and keep open cards while searching, filtering and after syncs; share links are checked only for cards in view; list endpoints follow page cursors and settings changes are saved together.
- Edited notes review built for long lists: search, sort, compact rows, paging, and restoring a selection of notes at once.
- Restoring a Fieldy version never writes plan-locked content; "Unknown" and other generic speakers never get a people note; existing folders with different capitalisation are reused; settings and sync indexes from other devices are merged safely; edited notes never trigger notices; image embeds and `obsidian://` links in Fieldy text are neutralised; Windows device names with extensions are made safe; diagnostics never include note paths, titles or privacy filter entries.
