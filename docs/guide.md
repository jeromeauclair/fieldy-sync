# Fieldy Sync user guide

How to use the side panel, the note banners, `fieldy` blocks, Dataview, edited notes, privacy filters, and import and export. For installation and setup, see the [README](../README.md). For every setting and the details of sync, see the [reference](reference.md).

- [The Fieldy panel](#the-fieldy-panel)
- [Note banners](#note-banners)
- [Tasks in notes](#tasks-in-notes)
- [Dashboards: fieldy blocks](#dashboards-fieldy-blocks)
- [Dataview](#dataview)
- [Edited notes](#edited-notes)
- [Privacy filters](#privacy-filters)
- [Import](#import)
- [Export](#export)

## The Fieldy panel

Open it with the <img src="icons/messages-square.svg" width="16" height="16" alt="Fieldy panel"> ribbon icon or **Fieldy Sync: Open Fieldy panel**. It lives in the right sidebar and works independently of sync: you take exactly what you need, when you need it. Text you insert or copy from it is plain Markdown that belongs to you; it is never synced or updated afterwards.

![A synced note next to the Conversations tab](images/panel-and-note.png)

### Status

At the top: a coloured dot with "Connected as you@example.com" (or what is wrong), the requests sent to Fieldy in the last minute against your request budget, and <img src="icons/refresh-ccw.svg" width="16" height="16" alt="Check again"> to check again. Below it: when the last sync ran and what it did, <img src="icons/refresh-cw.svg" width="16" height="16" alt="Sync now"> to sync now, <img src="icons/download.svg" width="16" height="16" alt="Import"> to open the import dialog, and <img src="icons/pencil.svg" width="16" height="16" alt="Edited notes"> listing your edited notes when there are any.

### Conversations

Pick a period (today; the last 3, 7, 14, 30 or 90 days; the last 12 months; or your entire history) and search the loaded conversations by title, summary, keyword or person. Older ones load page by page with **Load older conversations**; long lists are drawn 100 cards at a time as you scroll.

Each card shows the title, date, length and people, the note status, and a row of icons for what the conversation contains: coloured when present, grey when not (hover for details).

| Icon | Meaning |
| --- | --- |
| <img src="icons/zap.svg" width="16" height="16" alt="Brief"> | Brief: Fieldy's short format |
| <img src="icons/align-left.svg" width="16" height="16" alt="Summary"> | Summary |
| <img src="icons/file-text.svg" width="16" height="16" alt="Full memory content"> | Full memory content from your template |
| <img src="icons/list-checks.svg" width="16" height="16" alt="Tasks"> | Tasks (the tooltip gives the count) |
| <img src="icons/quote.svg" width="16" height="16" alt="Quotes"> | Quotes |
| <img src="icons/link.svg" width="16" height="16" alt="Share link"> | An active Fieldy share link (checked in the background for the cards you see, faint until checked) |
| <img src="icons/map-pin.svg" width="16" height="16" alt="Location"> | Location |
| <img src="icons/calendar.svg" width="16" height="16" alt="Calendar event"> | Linked calendar event |

Before these, a grey icon shows where it was recorded: the Fieldy wearable <img src="icons/mic.svg" width="16" height="16" alt="Wearable">, your phone <img src="icons/smartphone.svg" width="16" height="16" alt="Phone"> or the desktop app <img src="icons/monitor.svg" width="16" height="16" alt="Desktop">. These are the same icons as the source filters under the search box. Fieldy does not include this in a conversation, so the panel looks it up in the background (one short listing per source for the loaded period); until then, or when no source lists the conversation, the place stays empty. Click it to show only conversations recorded the same way.

**Card icons are buttons.** Click one to copy what it stands for: the summary, full memory content, tasks, quotes, share link, location or calendar event (<img src="icons/zap.svg" width="16" height="16" alt="Brief"> copies the overview). Right-click it to insert it into the note you are editing instead, open the location in Google Maps or OpenStreetMap, or open the share link. While the [Tasks](https://publish.obsidian.md/tasks/) plugin is enabled, tasks and the calendar event are copied as Tasks items written with your Tasks settings (the event is scheduled ⏳ on its day); the right-click menu also offers this plugin's own format.

**Filters.** Under the search box, one button per icon filters the list: click once for "only with it", again for "only without it", a third time for "any". The recording sources follow (one at a time), then, while [privacy filters](#privacy-filters) are set, the <img src="icons/lock.svg" width="16" height="16" alt="Private conversations"> private conversations. The <img src="icons/filter.svg" width="16" height="16" alt="Filters"> button next to the search box opens more filters: date, time of day, speaker, location and note status. Filters apply to the loaded conversations.

**Note status.** The label shows whether the conversation has a note (In vault, Not imported, Edited, Paused, Deleted from vault, Locked). It has a solid border when the last sync created the note and a dashed one when it updated it. Click it to open the note.

**Expand a card** to read its details, summary, tasks and quotes, and load its transcript on demand (and hide it again). Its **Share link** switch turns the conversation's Fieldy share link on (creating it if needed) or off, and shows the link with a copy button while it is on. Share links are public: anyone with the URL can read what they share. For an edited note, it shows the Fieldy version next to yours. A card stays open while you search or filter, and after syncs.

The buttons on each card:

- <img src="icons/file-text.svg" width="16" height="16" alt="Open the note"> **Open the note**, or <img src="icons/file-plus.svg" width="16" height="16" alt="Create a note"> **Create a note**: creates the same note a sync would, without running a sync.
- <img src="icons/refresh-cw.svg" width="16" height="16" alt="Refresh"> **Refresh** the note from Fieldy, or, for a note you edited, <img src="icons/rotate-ccw.svg" width="16" height="16" alt="Restore"> **Restore** the Fieldy version (see [Edited notes](#edited-notes)).
- <img src="icons/text-cursor-input.svg" width="16" height="16" alt="Insert"> **Insert…** puts a piece at your cursor in the note you were last editing: the summary, tasks (also as Obsidian Tasks when that plugin is enabled), quotes, transcript, full memory content, title and details, the whole conversation, a link to its note, its share link or its ID. Pieces the conversation does not have are greyed out.
- <img src="icons/copy.svg" width="16" height="16" alt="Copy"> **Copy…**: the same pieces, to the clipboard.
- <img src="icons/fingerprint.svg" width="16" height="16" alt="Copy the ID"> copies the conversation's ID.

### Tasks

All your Fieldy tasks, searchable. The icons under the search box filter by status, each with its count: open <img src="icons/circle.svg" width="16" height="16" alt="Open">, completed <img src="icons/circle-check.svg" width="16" height="16" alt="Completed"> and dismissed <img src="icons/circle-slash.svg" width="16" height="16" alt="Dismissed">. Like the Conversations filters, click once for "only these", again to hide them, a third time for "any". The tab starts with open tasks only; with all three on "any", it shows every task. The next icons choose how to group them: by due date <img src="icons/calendar-clock.svg" width="16" height="16" alt="By due date"> (overdue, today, next 7 days, later, no date), by conversation <img src="icons/messages-square.svg" width="16" height="16" alt="By conversation">, or not at all <img src="icons/list.svg" width="16" height="16" alt="No grouping">. Each task shows its due date and the conversation it came from. Tasks of [private conversations](#privacy-filters) are hidden, and the tab says how many.

![The Tasks tab](images/tasks-tab.png)

- **Change them in Fieldy:** tick the checkbox to mark a task done, or untick it to reopen it. The buttons under each task reopen a dismissed task <img src="icons/rotate-ccw.svg" width="16" height="16" alt="Reopen">, edit its title and due date <img src="icons/pencil.svg" width="16" height="16" alt="Edit">, cancel it after confirmation <img src="icons/circle-x.svg" width="16" height="16" alt="Cancel">, open its conversation's note <img src="icons/file-text.svg" width="16" height="16" alt="Open the note">, show the conversation in the panel <img src="icons/messages-square.svg" width="16" height="16" alt="Show the conversation">, or insert <img src="icons/text-cursor-input.svg" width="16" height="16" alt="Insert"> and copy <img src="icons/copy.svg" width="16" height="16" alt="Copy"> the task. Changes are sent to Fieldy only when you click, and the note shows them after the next sync.
- **Insert or copy** one task, or the whole list with **Insert all…** and **Copy all…**, as a Markdown checklist. When the Tasks plugin is enabled you can also insert them as Obsidian Tasks items, written with your Tasks settings, read each time: emoji or Dataview format, global filter, your symbols for done and cancelled, and whether to add created ➕, done ✅ and cancelled ❌ dates. Due dates use 📅, and each task links back to its note.

### Account

Connection details; sync status with the main actions (sync, import, edited notes, diagnostics); [Export conversations…](#export); your speaker profiles; and your memory templates with their instructions and when they last changed, ready to copy. Profiles and templates are read-only here (manage them in the Fieldy app) and are loaded once per panel; use **Reload profiles and templates** after changing them. Editing a template does not rewrite existing notes.

## Note banners

In Live Preview and reading view, the Fieldy section's markers are shown as two banners instead of `%% fieldy:begin %%` and `%% fieldy:end %%`:

- **The top banner** shows the section's state, when it was last synced, and buttons: <img src="icons/panel-right.svg" width="16" height="16" alt="Show in the panel"> show the conversation in the panel, <img src="icons/refresh-cw.svg" width="16" height="16" alt="Refresh"> **Refresh from Fieldy** (synced notes) or <img src="icons/rotate-ccw.svg" width="16" height="16" alt="Restore"> **Restore the Fieldy version** (edited notes).
- **The end banner** marks where the section ends: your own notes go below it.

| State | Meaning |
| --- | --- |
| **Synced** (blue) | Kept up to date from Fieldy. |
| **Edited** (orange) | You changed the section, so sync leaves it as you wrote it. It changes the moment you type inside the section. |
| **Paused** (grey) | The note has `fieldy_sync: false`, so it is never updated. |
| **Private** (grey) | A [privacy filter](#privacy-filters) matches the conversation, so the note is no longer updated. |

The banners are display only: the file still contains the plain markers, visible in source mode and in other apps. To edit a marker line, put the cursor on it with the keyboard or mouse and it shows as text. Turn banners off with **Section banner**, and pick your own colours for light and dark mode with **Banner colours** (both on the Note content settings page).

## Tasks in notes

Fieldy tasks linked to a conversation appear under **Tasks** in its note: open tasks as `- [ ]`, completed ones as `- [x]`, and optionally dismissed ones as `- [-]`, with their due date.

- **Ticking a box** is never treated as an edit, and your ticks are kept when the note updates.
- **Mark ticked tasks as completed in Fieldy** (off by default) sends a tick to Fieldy on the next sync.
- **Due dates as Dataview fields** (off by default) writes `[due:: 2026-11-05]` instead of `(due 2026-11-05)` for [Dataview](#dataview).

Writing tasks in the Tasks plugin's own format inside notes is planned for 1.1 (see the [roadmap](../ROADMAP.md)); the panel already inserts them that way.

## Dashboards: fieldy blocks

Put a `fieldy` code block in any note to list what your Fieldy notes contain. It reads your vault only (no requests to Fieldy), works without other plugins, and updates when your Fieldy notes change. **Fieldy Sync: Insert a Fieldy or Dataview query** inserts ready-made ones.

````markdown
```fieldy
show: tasks
tasks: open
```
````

![Fieldy blocks in a dashboard note](images/fieldy-blocks.png)

| Option | Values | Default |
| --- | --- | --- |
| `show` | `conversations`, `tasks` or `stats` | `conversations` |
| `period` | `today`, `yesterday`, `this week`, `last week`, `this month`, `last month`, a number of days (`3 days`, `14 days`), `all`, a date (`2026-10-05`) or a range (`2026-10-01 to 2026-10-31`) | last 7 days (all time for tasks) |
| `speaker` | part of a speaker's name, such as `Marie` | anyone |
| `kind` | `all`, `full` or `brief` | `all` |
| `tasks` | `open`, `done` or `all` (for `show: tasks`) | `open` |
| `sort` | `newest`, `oldest` or `longest` (for conversations) | `newest` |
| `limit` | how many items to list | 50 |

- **conversations:** a list with date, length and people, each linking to its note.
- **tasks:** the tasks of the Fieldy sections, soonest due first (overdue in red), each linking to its line in the note. Tick them in the note or in the panel.
- **stats:** conversations, time recorded, average length, days with conversations, open and completed tasks, the longest conversation, the busiest days and the people you talk with most.

Weeks start on Monday. A mistake in a block shows a short message above the result instead of breaking the note. Lines starting with `#` are comments.

## Dataview

Fieldy notes carry their data as properties (`fieldy_id`, `fieldy_start`, `fieldy_end`, `fieldy_duration_minutes`, `fieldy_kind`, `fieldy_speakers`, `fieldy_keywords`, `fieldy_location`), and tasks inherit their note's properties, so [Dataview](https://github.com/blacksmithgu/obsidian-dataview) can query both. `WHERE fieldy_id` selects Fieldy notes. Turn on **Due dates as Dataview fields** (Tasks settings page) so Dataview can sort and filter tasks by due date.

Open Fieldy tasks, grouped by conversation:

````markdown
```dataview
TASK
WHERE fieldy_id AND !completed AND status = " "
SORT due ASC
GROUP BY file.link
```
````

Recent conversations:

````markdown
```dataview
TABLE WITHOUT ID file.link AS "Conversation", fieldy_start AS "Start", fieldy_duration_minutes AS "Minutes", fieldy_speakers AS "Speakers"
WHERE fieldy_id
SORT fieldy_start DESC
LIMIT 50
```
````

Minutes recorded per day over the last 30 days:

````markdown
```dataview
TABLE WITHOUT ID key AS "Day", length(rows) AS "Conversations", sum(rows.fieldy_duration_minutes) AS "Minutes"
WHERE fieldy_id AND date(fieldy_start) >= date(today) - dur(30 days)
GROUP BY dateformat(date(fieldy_start), "yyyy-MM-dd")
SORT key DESC
```
````

Conversations with someone, when speakers are linked to people notes (**Link speakers to people notes**):

````markdown
```dataview
TABLE WITHOUT ID file.link AS "Conversation", fieldy_start AS "Start"
WHERE fieldy_id AND contains(fieldy_speakers, [[Priya Shah]])
SORT fieldy_start DESC
```
````

## Edited notes

When you edit inside a note's Fieldy section, the note becomes your edited version: its banner turns to *Edited* and sync leaves it as you wrote it. Nothing is lost, because the original is still in Fieldy.

- **See the original:** the <img src="icons/panel-right.svg" width="16" height="16" alt="Show in the panel"> button on the banner, **Show Fieldy version of current note**, or the conversation's card in the panel.
- **Bring it back:** the <img src="icons/rotate-ccw.svg" width="16" height="16" alt="Restore"> button on the banner or the card, or **Review edited notes** (also for several notes at once).

| Choice | Result |
| --- | --- |
| **Restore Fieldy version, keep my edits below it** | The section gets the latest Fieldy content again, and your edited text is kept right below it under "Your edited version (kept …)". The note receives updates again. **Keep the transcript in your edited copy** decides whether that copy includes its transcript. |
| **Restore Fieldy version, discard my edits** | After confirmation, the section is replaced with the latest Fieldy content. Text outside it is kept. The note receives updates again. |

If you undo your edits yourself, the note goes back to receiving updates on its own. To freeze a note without editing it, set `fieldy_sync: false` in its properties.

## Privacy filters

> [!warning] Not a security feature
> Privacy filters are not a security feature, and no real privacy should be expected from them. They are a filter: matching conversations get no note and some views of this plugin hide them. Everything stays in your Fieldy account, private conversations included, and anyone with your API key (or your Fieldy login) can read all of it, through Fieldy or any other tool. Other Obsidian plugins can also read secrets stored in Obsidian.

Some conversations do not belong in your vault: a doctor's appointment, a salary talk, a private call. **Settings → Privacy** lists what makes a conversation private, one entry per line:

| Filter | Matches |
| --- | --- |
| **Private keywords** | Words or phrases in the title, summary, memory content, keywords or quotes. |
| **Private speakers** | A speaker's name, as Fieldy shows it. |
| **Private places** | Words of the address where it was recorded: street, city, postal code or country. |
| **Private templates** | Fieldy memory templates by name: every conversation summarised with one is private. |
| **Private times** | [Time rules](reference.md#time-rules): days and hours, one rule per row, combined with *or*, *and*, *except* (a lunch break, the weekend…). A conversation with any moment matching them is private. |

Case and accents are ignored. Keywords and places match whole words; end one with `*` to match every word starting with it (`therap*` catches *therapy* and *therapist*).

A private conversation:

- gets **no note**, and its **tasks are hidden** in the Tasks tab (which says how many) and in notes;
- is **left out of exports**, and shown as *Private* (not selectable) in the import dialog;
- appears in the panel as a short card: **"Private conversation"**, its date and length, and the filter that matched ("No access: private filter keyword "doctor""). No title (unless **Show titles of private conversations** is on: then the title, and the brief icon for brief ones), content, icons or actions. Private cards never match a search or another filter. The <img src="icons/lock.svg" width="16" height="16" alt="Private conversations"> icon at the end of the filter row (shown while privacy filters are set) cycles like the others: only private conversations, none of them, or any.

A note imported **before** you added the filter is kept exactly as it is but no longer updated; its banner says *Private*. **Settings → Privacy → Notes of private conversations** lists those notes so you can delete the ones you do not want. Removing the filter brings them back to normal at the next sync.

To have them removed instead, turn on **Move notes of private conversations to the trash** (off by default; it asks first). Sync then moves those notes to the trash, Obsidian's or your system's as set in **Files and links**, with any text you added to them. If you remove the filter later, the conversation is imported again like a new one.

**Also search transcripts** (off by default) looks for private keywords and speakers in what was said too, not only in what Fieldy summarised. Each transcript has to be downloaded once to be checked, one request per conversation, even when transcripts are not written into notes. A sync over a long period, an import of your history or browsing older conversations in the panel can then take many minutes, within Fieldy's limit of 100 requests per minute. Results are remembered (only whether each conversation matched, not its text), so a transcript is checked again only when its conversation or the filters change. Until a conversation is checked, the panel shows it as *Checking privacy filters…* without any content.

Privacy filters work in Obsidian only: the conversations stay in your Fieldy account, and the filters are never sent anywhere or included in diagnostics.

## Import

**Fieldy Sync: Import conversations** (or the <img src="icons/download.svg" width="16" height="16" alt="Import"> button in the panel) brings in conversations outside the sync window: pick a period up to your entire history or a custom range, see each conversation's status (new, in vault, edited, paused, deleted, locked, private), filter by title, select, and choose the destination folder. The import runs in the background with progress in the status bar, and follows the same rules as sync: no duplicates, and edited notes are left alone.

## Export

**Export conversations…** (Account tab, or the command) saves conversations to one new file in your vault, `Fieldy/Exports` by default:

![The export dialog](images/export.png)

- **What:** the entire history, a preset period (3 days to 12 months) or a date range, with or without brief conversations.
- **Formats:** one Markdown note; JSON with all the data; CSV with one row per conversation, readable by any spreadsheet; or plain text.
- **Included:** each conversation's details, summary, full memory content, quotes and tasks; transcripts on request. [Private conversations](#privacy-filters) are always left out.
- **Time:** transcripts cost one request each, so the dialog shows the time left, and **Cancel export** stops without saving.
