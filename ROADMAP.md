# Roadmap

Planned work, in priority order. Plans can change; released items move to the [changelog](CHANGELOG.md).

Anything that changes your data on Fieldy always asks first and never runs as part of a sync.

## 1.1: notes your way

- **Fieldy tasks in the [Tasks](https://publish.obsidian.md/tasks/) plugin format inside notes**, with due, done and cancelled dates, so synced tasks appear in your Tasks queries. The panel already inserts tasks this way. Ticking a task will still never count as an edit.
- **Your own template for new notes**, using the familiar `{{title}}` and `{{date}}` variables plus Fieldy placeholders such as `{{fieldy_summary}}` or `{{fieldy_tasks}}`. Applied only when a note is created; existing notes are never re-templated.

- **A clear notice when an edited note has a newer source.** Today an edited note is left exactly as you wrote it, so a corrected transcript or summary in Fieldy does not reach it, and the note does not say that a newer version exists. Planned: remember the source version the edit was based on, and when Fieldy's version has changed since, show "Newer version in Fieldy" on the banner, the panel card and the **Review edited notes** list, with the side-by-side view already available. Syncing still never overwrites your edits.
- **Finer protection for edited notes**, so correcting one line does not cut a note off from later updates. Options under consideration, to be chosen after testing:
  - **Protect by part:** treat the summary, tasks, quotes and transcript as separate parts, so editing one only pauses that part and the others keep updating.
  - **Keep both on update:** an opt-in setting where a changed source refreshes the Fieldy section and keeps your edited text below it ("Your edited version"), as **Restore, keep my edits** does today, but only when you ask for it.
  - **Show what changed:** a short diff between the version your edit was based on and the new Fieldy version, before you choose.
- **Tests for ticked tasks and corrected sources.** Ticking a task is never an edit and your ticks are kept when a note updates. Add a test, and a demo, covering a ticked task followed by a corrected transcript, to guard that the update arrives and the tick survives.

## 1.2: mobile, people and context

- **Full mobile support**, tested on iOS and Android. Until then, the plugin installs on phones and tablets with a "not tested yet" notice.
- **Speaker mapping:** link "Speaker B" in a conversation to one of your people notes. Fieldy's API can't assign speakers inside a conversation, so the mapping is kept in your vault.
- **Daily notes:** a ready-made list of the day's conversations.
- **A ready-made Bases view** of your conversations, without Dataview.

## 1.3: insights and export

- Charts for time recorded, people over time and task completion.
- More export options: one file per conversation, JSON Lines, scheduled export.
- Conversations on a map.

## 1.4: manage Fieldy from Obsidian

- **Delete a conversation on Fieldy** from the panel, after a confirmation. Your note in the vault stays and says the conversation was deleted.
- **Share links:** create, copy, turn off or delete a conversation's share link from the panel.
- **Tasks:** add a task to Fieldy from Obsidian, and delete tasks you no longer need.
- **Speaker profiles:** add, rename or delete them from the plugin's People settings.

## Later

- Editing conversations on Fieldy: title, summary, notes, Brief or Full format, and the summary template.
- Sending a note to Fieldy as a Fieldy page.
- Faster syncs that fetch only changed conversations, if Fieldy's API adds a way to ask for them.
- Templater support for the note template.
- Translations, French first.

## Far-off ideas

Not planned, just kept in mind.

- **Other transcription assistants:** maybe one day, sync conversations from other recording devices and apps, alongside Fieldy, for those that offer a public API.
- **Calendars:** link conversations to your calendars and to calendar plugins in Obsidian, beyond the calendar event Fieldy already attaches.
- **Advanced and semantic search:** combine filters (people, dates, places, tasks), and find conversations by meaning rather than exact words.
- **Conversation and speech analysis:** talk time per speaker, speaking pace, topics over time and other statistics, going further than the 1.3 charts.
- **Meeting prep briefs:** before a meeting on your calendar, a note with your past conversations with the attendees, the open tasks involving them and what was last discussed.
- **Periodic reviews:** a weekly or monthly digest of the period's conversations, people, main decisions and tasks done or still open.
- **Ask your conversations:** questions in plain language answered from your conversations by an AI, with links to the conversations it used.
