# Contributing to Fieldy Sync

Thanks for your interest. Bug reports, ideas and pull requests are welcome.

## Reporting a bug or asking a question

Open a [GitHub issue](https://github.com/jeromeauclair/fieldy-sync/issues) with:

- what you did, what you expected and what happened instead;
- your Obsidian version, the plugin version and your platform;
- the report from **Fieldy Sync: Copy diagnostics**. It contains no API key, note paths, conversation titles or privacy filter entries, but read it before posting.

Never post your Fieldy API key, transcripts or other conversation content.

## Suggesting a feature

Check the [roadmap](ROADMAP.md) first, then open an issue that describes the problem you want solved, not only the solution.

## Pull requests

1. For anything larger than a small fix, open an issue first so we can agree on the approach.
2. Fork the repository and create a branch from `main`.
3. Set up and check your change:

   ```bash
   npm install
   npm run dev      # watch build into main.js (copy it to a test vault)
   npm run check    # typecheck, lint, unit tests and production build
   ```

   `npm run check` must pass. Add or update tests in `tests/` for changed behaviour; unit tests never need an API key or the network.
4. Test in a vault you don't mind changing. `npm run test:live` (optional) runs read-only checks against the real API with your own key; see `.env.example`.
5. Update the docs (`README.md`, `docs/guide.md`, `docs/reference.md`) and describe the change in `CHANGELOG.md` when users would notice it.
6. Keep pull requests focused: one change per pull request.

### Guidelines

- Use Obsidian's API for vault access (`Vault`, `FileManager`, `metadataCache`), never Node's file system.
- The plugin talks only to the Fieldy API. Don't add other network requests, telemetry or analytics.
- Never log, store or display the API key; it lives in Obsidian's secret storage.
- Interface text is in sentence case and plain English.

## License

Fieldy Sync is licensed under the [Functional Source License 1.1, MIT Future License](LICENSE). By contributing, you agree that your contribution is licensed under the same terms.
