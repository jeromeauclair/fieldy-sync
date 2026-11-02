# Roadmap

Planned work, in priority order. Plans can change; released items move to the [changelog](CHANGELOG.md).

## 1.1: notes your way

- **Fieldy tasks in the [Tasks](https://publish.obsidian.md/tasks/) plugin format inside notes**, with due, done and cancelled dates, so synced tasks appear in your Tasks queries. The panel already inserts tasks this way. Ticking a task will still never count as an edit.
- **Your own template for new notes**, using the familiar `{{title}}` and `{{date}}` variables plus Fieldy placeholders such as `{{fieldy_summary}}` or `{{fieldy_tasks}}`. Applied only when a note is created; existing notes are never re-templated.

## 1.2: mobile, people and context

- **Full mobile support**, tested on iOS and Android. Until then, the plugin installs on phones and tablets with a "not tested yet" notice.
- **Speaker mapping:** link "Speaker B" in a conversation to one of your people notes.
- **Daily notes:** a ready-made list of the day's conversations.
- **A ready-made Bases view** of your conversations, without Dataview.

## 1.3: insights and export

- Charts for time recorded, people over time and task completion.
- More export options: one file per conversation, JSON Lines, scheduled export.
- Conversations on a map.

## Later, or depending on Fieldy's API

- Creating share links and editing speakers, if Fieldy's API allows it.
- Faster syncs that fetch only changed conversations.
- Translations, French first.
