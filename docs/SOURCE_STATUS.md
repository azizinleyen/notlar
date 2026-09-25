# Source code status

This repository contains two layers from different stages of development:

| Directory | Contents | Status |
| --- | --- | --- |
| `src/` | Original TypeScript and React development sources | Base version before the Phase 1–3 fixes |
| `out/` | Current JavaScript, CSS, and HTML extracted from the installed Notlar app | Includes the Phase 1–3 fixes |

The `out/` files are readable compiled code and are included in this repository under the MIT License. The corresponding updated TypeScript and React sources and source maps are not available, so the gap cannot be reversed automatically.

`npm run dist` packages the existing `out/` output into an Electron/NSIS installer. `npm run build`, `npm run dev`, and `npm run dist:source` use `src/`. In particular, `npm run build` overwrites the current code in `out/`. Do not run it immediately before packaging the current version.

To bring the sources back into sync, port the Phase 1–3 changes to TypeScript and React, add appropriate tests, and verify that `npm run build` produces an app functionally equivalent to the current installed version. After that, `out/` can again be treated as a generated build output.
