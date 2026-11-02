# Fieldy Sync reference

What a note contains, how sync decides what to write, every setting, and what to do when something goes wrong. For a tour of the panel, the note banners, the `fieldy` blocks and export, see the [user guide](guide.md). For installation, see the [README](../README.md).

- [What a note looks like](#what-a-note-looks-like)
- [How synchronisation works](#how-synchronisation-works)
- [Settings](#settings)
- [Commands](#commands)
- [Requests and large accounts](#requests-and-large-accounts)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

## What a note looks like

```markdown
---
fieldy_id: 2f0c6d2e-1b7a-4c1e-9a55-0d6f2b9c1e42
fieldy_type: conversation
fieldy_start: 2026-11-02T09:30:00
fieldy_end: 2026-11-02T10:12:00
fieldy_duration_minutes: 42
fieldy_kind: full
fieldy_updated: 2026-11-02T10:12:00
fieldy_synced: 2026-11-02T12:08:45
fieldy_speakers:
  - Alex Martin
  - Priya Shah
fieldy_keywords:
  - roadmap
fieldy_location: Studio 4, 120 King Street
tags:
  - fieldy
fieldy_hash: 0ebef1c31b6f1b
fieldy_src: 1bf45f4fee548a
---
%% fieldy:begin %%
# Product roadmap review

- **When:** 2026-11-02 09:30 – 10:12 (42 min)
- **Speakers:** Alex Martin, Priya Shah
- **Location:** Studio 4, 120 King Street
- **Keywords:** roadmap

## Summary

Ship offline mode before the redesign…

## Tasks

- [ ] Send the beta invite list (due 2026-11-03) %%fieldy-task:7c1…%%
- [x] Book the finance review %%fieldy-task:a90…%%

## Quotes

> Offline first, then the shiny things.
> — *Priya on priorities*

## Transcript

`09:30:05` **Alex Martin:** Let's start with the roadmap…

`09:30:45` **Priya Shah:** Design is done…

%% fieldy:end %%

## My notes

Anything here is yours and is never touched by the plugin.
```

- **The Fieldy section** is everything between `%% fieldy:begin %%` and `%% fieldy:end %%`. In Live Preview and reading view the two markers are shown as [banners](guide.md#note-banners); in source mode, and in other apps, they are plain Obsidian comments. The blank line before the end marker keeps it out of a closing callout or list.
- **Sections without data** from Fieldy (no quotes, no tasks, no transcript…) are left out.
- **Task ids** (`%%fieldy-task:…%%`) match each checkbox to its Fieldy task. They are hidden in reading view and Live Preview, except on the line you are editing.
- **The title** stays inside the section. The file name is chosen once, when the note is created, and is never changed afterwards.
- **Properties:** keys starting with `fieldy_` belong to the plugin. `fieldy_hash` and `fieldy_src` are its bookkeeping (see below); the others describe the conversation and can be used in searches, Bases and [Dataview](guide.md#dataview). `tags` and `aliases` are only set when the note is created and are yours afterwards, like every other property you add.

## How synchronisation works

### Identity and duplicates

Every note stores the Fieldy conversation id in the `fieldy_id` property. Before each sync, the plugin looks up all notes with a `fieldy_id` anywhere in the vault (through Obsidian's metadata cache, reading the file directly if it is not indexed yet). A conversation that already has a note is updated in place, wherever the note now lives and whatever it is called. A new note is only created when no note with that id exists. If you copy a note, so that two notes share an id, the plugin never creates a third, updates only the original, and mentions the duplicate in the summary.

New file names follow the pattern setting (default `{date} - {title}`). Names are made safe for Windows, macOS, Linux, iOS and Android, and name clashes get ` (2)`, ` (3)`… The plugin never overwrites a file it did not create.

### Detecting changes

For each conversation the plugin computes a **fingerprint** of everything the note is built from: the conversation's content fields, its tasks and the settings that change how notes look. The note keeps it in `fieldy_src`, and a small local sync index keeps a copy.

- Same fingerprint, and the file unchanged since the last check → the conversation is skipped. No file is read or written, and no transcript is downloaded.
- Different fingerprint → the note is re-rendered and written only if the result differs.

`fieldy_synced` changes only when a note is actually written, so running sync twice in a row with nothing new in Fieldy leaves every file untouched. Changing a setting that affects how notes look re-renders the notes in the sync window once.

Some data would cost one extra request per conversation on every sync, so it is not part of the fingerprint. It is refreshed whenever the note is next updated for another reason:

- transcript corrections Fieldy makes without changing the conversation itself;
- renamed speaker profiles and memory templates;
- share links (when **Share links** is on).

To refresh one note right away, use **Refresh current note from Fieldy**, or the ⟳ button on its banner or its card in the panel.

### Protecting your edits

`fieldy_hash` records a hash of the Fieldy section exactly as the plugin wrote it.

- **Outside the section** (above or below it), your text is never modified. Updates replace only the section.
- **Inside the section:** as soon as its content no longer matches `fieldy_hash`, you edited it, and the note becomes **your edited version**. Its banner turns to *Edited*, and sync leaves the note exactly as you wrote it, properties included, with no warning and no conflict. Whitespace-only changes made by editors or formatters do not count.
- **Ticking tasks** is not an edit: checkbox states are ignored by the hash, and your ticks are kept when the section is refreshed.
- **Properties:** `fieldy_*` keys are refreshed with the note (unless you edited it). All other properties are yours.
- If you edit the note while a sync is writing it, the write is abandoned and your edit wins.

An edited note is never overwritten and the original is never lost: the Fieldy version stays in Fieldy, one click away in the panel, and can be [restored](guide.md#edited-notes) whenever you like. If you undo your edits yourself, the note goes back to receiving updates on its own. To freeze a note without editing it, set `fieldy_sync: false` in its properties (its banner shows *Paused*).

### Other situations

| Situation | Behaviour |
| --- | --- |
| You delete a note | It is not re-created by sync (unless **Re-create deleted notes** is on). You can bring it back from the import dialog or the panel. |
| You rename or move a note | It keeps syncing at its new location. |
| You remove the markers | The whole note becomes your edited version and is left alone. Restoring appends a fresh Fieldy section. |
| A conversation is locked by your Fieldy plan's history window | Existing notes are never replaced with the locked (redacted) version; locked conversations are not imported. |
| A conversation is deleted in Fieldy | Its note is kept. The plugin never deletes notes. |
| One conversation fails (network, vault write…) | The rest of the sync continues; the summary lists the failure, and the next sync retries it. |
| The destination folder exists with different capitalisation (`fieldy` vs `Fieldy`) | The existing folder is used. |
| A note is edited | It is never reported as a problem. Manual sync summaries mention how many edited notes were kept as you wrote them. |
| Several devices (for example Obsidian Sync) | Settings changed on another device apply immediately. The sync indexes of both devices are merged, never overwritten. |

### Sync window and older history

Fieldy's API lists conversations by start time, so each sync checks conversations that **started** within the sync window (default: the last 7 days). That covers new recordings and late summary updates. To import or refresh older conversations, use **Import conversations** with a larger range or **Entire history**.

### What the plugin changes in Fieldy

Nothing, unless you ask:

- **Tasks tab:** ticking, reopening, editing the title or due date, and cancelling a task are sent to Fieldy when you click.
- **Mark ticked tasks as completed in Fieldy** (off by default): a task you tick in a note is marked completed in Fieldy on the next sync.

It never deletes tasks, never edits conversations, speakers or templates, and never creates share links.

## Settings

The settings are grouped in pages under **Settings → Fieldy Sync**. Each setting explains itself on the page, and previews show the file name of a new note, your date formats and your transcript format as you change them. The page **How Fieldy Sync works** is a short guide.

### Connection

| Setting | Default | Description |
| --- | --- | --- |
| API key | (none) | The secret in Obsidian's secret storage that holds your Fieldy key. The plugin only stores the secret's name. |
| Test connection | | Checks the key with one request and shows the account's email address. |

### Sync

| Setting | Default | Description |
| --- | --- | --- |
| Import new conversations during sync | On | Off: sync only updates notes you already have. |
| Sync window | Last 7 days | Conversations each sync checks (last day to last 365 days). |
| Recording source | All sources | Only wearable, phone or desktop recordings. |
| Include brief conversations | On | Short conversations Fieldy marks as brief. |
| Sync on startup | Off | Syncs about 10 seconds after Obsidian starts. |
| Automatic sync | Off | Every 15 minutes to once a day. |
| Re-create deleted notes | Off | Imports again notes you deleted. |

### Folders and file names

| Setting | Default | Description |
| --- | --- | --- |
| Folder | `Fieldy` | Where new notes go. |
| Subfolders | None | By year (`Fieldy/2026`), month (`Fieldy/2026-10`), year then month (`Fieldy/2026/2026-10`), year then ISO week (`Fieldy/2026/2026-W44`), year/month/day, or a custom format. Existing notes are not moved. |
| Subfolder format | `YYYY/MM` | The custom [Moment.js format](https://momentjs.com/docs/#/displaying/format/), such as `YYYY/[Q]Q`. |
| File name pattern | `{date} - {title}` | Tokens `{date}`, `{time}`, `{title}` and `{id}`. |
| File name date format | `YYYY-MM-DD` | Moment.js format of `{date}`. |

### Note content

| Setting | Default | Description |
| --- | --- | --- |
| Summary | On | Fieldy's summary. |
| Full memory content | On | The write-up made with your Fieldy memory template, when it says more than the summary (under "Details"). |
| Quotes | On | Notable quotes with their context. |
| Transcript | On | One extra request per new or changed conversation. |
| Share links | Off | Existing share links (one extra request per updated note). |
| Section banner | On | Shows the section's markers as [banners](guide.md#note-banners) in Live Preview and reading view. Display only. |
| Banner colours | Theme | The theme's blue, orange and grey, or your own colours for synced, edited and paused sections, separately for light and dark mode. |

### Tasks

| Setting | Default | Description |
| --- | --- | --- |
| Tasks | On | Fieldy's action items as checkboxes. |
| Completed tasks | On | Also list tasks done in Fieldy, ticked. |
| Dismissed tasks | Off | Also list rejected, skipped, cancelled or expired tasks, as `[-]`. |
| Due dates as Dataview fields | Off | Writes `[due:: 2026-11-05]` instead of `(due 2026-11-05)`, so [Dataview](guide.md#dataview) can sort and filter by due date. |
| Mark ticked tasks as completed in Fieldy | Off | When you tick an open task in a note, the next sync marks it completed in Fieldy. |

### Transcript

| Setting | Default | Description |
| --- | --- | --- |
| Transcript format | Timestamped, with speakers | Or timestamped segments, or readable paragraphs. Speaker profile names are used where Fieldy links them. |
| Transcript timestamps | Time of day | Or time since the start of the conversation. |
| Collapse transcript | Off | Puts the transcript in a collapsed callout. |

### Properties, tags and dates

| Setting | Default | Description |
| --- | --- | --- |
| Date format in notes | `YYYY-MM-DD HH:mm` | The "When" line. |
| Property dates | Local time | Local `YYYY-MM-DDTHH:mm:ss` (works with Obsidian date properties) or Fieldy's UTC ISO 8601 values. |
| Speakers / Keywords / Location / Template property | On | The optional `fieldy_speakers`, `fieldy_keywords`, `fieldy_location` and `fieldy_template` properties. |
| Tags | `fieldy` | Added to new notes. |
| Add keywords as tags | Off | Applied when a note is created. |
| Add title as alias | Off | Applied when a note is created. |

### People

| Setting | Default | Description |
| --- | --- | --- |
| Link speakers to people notes | Off | Speaker names matching a note's name or `aliases` become links in the Speakers line and `fieldy_speakers`, so that person's note lists every conversation they were in. Names matching several notes stay plain text. |
| People folder | (whole vault) | Only notes in this folder count as people. |
| Link speakers in the transcript | Off | Also links the transcript's speaker names. |
| Create notes for new speakers | Off | Creates an empty note (with `fieldy_speaker`) in the people folder, or `People`, for each speaker without one. Never for "Unknown", "Speaker A" or other generic labels. |

### Advanced

| Setting | Default | Description |
| --- | --- | --- |
| Request timeout | 30 s | |
| Retries | 3 | For network errors, timeouts, rate limiting and server errors, with exponential backoff. |
| Request budget | 60 per minute | Fieldy allows 100 requests per minute per key; the plugin never exceeds 95. |
| Notifications for automatic syncs | When something changed or failed | Manual syncs always show a summary. Edited notes never trigger a notice. |
| Status bar indicator | On | Sync status and progress in the status bar. |
| Debug logging | Off | Request details in the developer console. Keys are never logged. |

### Edited notes and troubleshooting

| Setting | Default | Description |
| --- | --- | --- |
| Edited notes | | Opens the list of notes you edited, to view or restore the Fieldy version. |
| Keep the transcript in your edited copy | On | When you restore and keep your edits, your edited copy below the section includes its transcript. Turn off to leave it out (the restored section already has it); leave on if you edited the transcript itself. |
| Diagnostics | | Copies a report without keys or note content. |
| Reset sync state | | Clears the local index. Notes are not changed and no duplicates are created, but deleted notes may be imported again. |

## Commands

All commands start with `Fieldy Sync:` in the command palette. No hotkeys are assigned; add your own under **Settings → Hotkeys**.

| Command | What it does |
| --- | --- |
| Sync now | Syncs conversations that started within the sync window: creates notes for new ones (if enabled) and updates changed ones. |
| Open Fieldy panel | Opens the side panel (also on the ribbon). |
| Import conversations | Opens the import dialog: pick a date range (up to your entire history), review each conversation's status, filter, select and choose a folder. |
| Export conversations | Saves conversations to one file in your vault (see [Export](guide.md#export)). |
| Insert a Fieldy or Dataview query | Inserts a ready-made `fieldy` block or Dataview query at the cursor. |
| Test connection | Checks the API key with one request. |
| Review edited notes | Lists notes you edited inside their Fieldy section: search, sort, open, view the Fieldy version, or restore one or several. |
| Show Fieldy version of current note | Opens the active note's conversation in the panel, without changing the note. |
| Cancel running sync | Stops the current sync after the conversation in progress. |
| Refresh current note from Fieldy | Re-renders the active note (your edits are still protected). |
| Copy share link of current note | Copies an existing Fieldy share link of the active note's conversation. |
| Copy diagnostics | Copies a report without secrets, for bug reports. |

## Requests and large accounts

Fieldy allows **100 requests per 60 seconds** per API key. All requests go through one shared limiter (60 per minute by default). On a `429` response the plugin pauses every request for Fieldy's cooldown (60 seconds, or the server's `Retry-After`) before retrying.

A sync costs one request per 50 conversations listed, one to seven for tasks (one per task status: open and approved, plus completed and the four dismissed statuses when those are included), and one transcript request per new or changed conversation. A first import of several hundred conversations takes a few minutes, with progress in the status bar. Syncs never overlap; a scheduled sync is skipped while another one runs.

The panel stays light on long histories: it draws 100 cards at a time, checks share links only for cards you see, and looks up recording sources once per loaded period. An export with transcripts costs one request per conversation, so the dialog shows the time left.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "No Fieldy API key is configured" | Choose or create the secret under **Settings → Fieldy Sync → Connection → API key**. |
| "Fieldy rejected the API key" | The key is wrong or was revoked. Create a new one in the Fieldy app and update the secret. |
| "Fieldy's rate limit was reached" | Another tool may be using the same key. Wait a minute; scheduled syncs back off on their own. Lower the request budget if it keeps happening. |
| "Could not reach Fieldy" or timeouts | Check your connection; raise the request timeout on slow networks. |
| "Fieldy returned a response the plugin could not understand" | The API may have changed. Please open an issue with the copied diagnostics. |
| A note is not updating | Its banner tells you why: *Edited* (you changed the section; see **Review edited notes**) or *Paused* (`fieldy_sync: false`). Otherwise it may be outside the sync window or locked by your plan. |
| The banner does not appear | It shows in Live Preview and reading view, not in source mode, and only when both markers are present once each. Check **Section banner** under Note content. |
| A note I deleted came back | **Re-create deleted notes** is on, or the sync state was reset. |
| Old conversations are missing | Use **Import conversations** with a larger range. Conversations outside your plan's history window are locked by Fieldy. |
| A `fieldy` block is empty | It reads your Fieldy notes only: import the period first, or widen `period` (tasks default to all time, conversations to the last 7 days). A message above the block points out options it did not understand. |
| Dataview does not sort Fieldy tasks by due date | Turn on **Due dates as Dataview fields** (Tasks page); notes update at their next sync, or refresh them. |

## FAQ

**Can I edit imported notes?** Yes. Write freely outside the Fieldy section. Edits inside it are kept too: the note becomes your edited version and sync leaves it as you wrote it. The original stays in Fieldy, where the panel shows it, and you can restore it whenever you like.

**Can I rename or move notes?** Yes. Notes are tracked by `fieldy_id`, not by path.

**Does the plugin delete anything?** No. It never deletes notes, and it never deletes or edits anything in Fieldy except the task changes you make yourself (see [What the plugin changes in Fieldy](#what-the-plugin-changes-in-fieldy)).

**Can speakers be identified from Obsidian?** Not yet. Fieldy's API reports speaker profiles but cannot assign them. Local speaker mapping is on the [roadmap](../ROADMAP.md).

**Can I open the settings with a command?** Obsidian has no public API for opening a specific plugin's settings. Use **Settings → Fieldy Sync**.

**Are audio files imported?** No. The Public API does not provide audio. Audio is only available through Fieldy's organisation webhooks, which require a public server.

**Does it work on mobile?** It installs and should work, but it has not been tested on phones and tablets yet, so the plugin shows a one-time notice there and a note at the top of its settings. Please report anything that looks wrong; full mobile support is planned for 1.2.
