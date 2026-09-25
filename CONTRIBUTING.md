# Contributing

1. Read the [source status](docs/SOURCE_STATUS.md) first. The current app features are in `out/`, while the original TypeScript sources in `src/` are older.
2. When possible, port the current changes back to `src/` before adding features. Rebuilding only the older sources would remove features from the installed app.
3. Do not commit secrets, `.env` files, OAuth client JSON files, personal meeting recordings, or databases.
4. Check changes with `npm run typecheck` and `npm test`. For packaging changes, also run `npm run dist`.
5. In your pull request, state whether the change affects `src/`, `out/`, or both.

See [SECURITY.md](SECURITY.md) to report a vulnerability.
