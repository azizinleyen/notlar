# Source code status

This repository contains two layers from different stages of development:

| Directory | Contents | Status |
| --- | --- | --- |
| `src/` | Original TypeScript and React development sources | Base version before the Phase 1–3 fixes |
| `out/` | Current JavaScript, CSS, and HTML extracted from the installed Notlar app | Includes the Phase 1–3 fixes |

The `out/` files are readable compiled code and are included in this repository under the MIT License. The corresponding updated TypeScript and React sources and source maps are not available, so the gap cannot be reversed automatically.

`npm run build` packages the existing `out/` output into an unpacked Windows app; `npm run dist` creates the installer and portable EXE. Neither command overwrites `out/`. `npm run dev`, `npm run build:source`, and `npm run dist:source` use the older `src/` code. The two explicit source build commands overwrite the current code in `out/`; avoid them when packaging the current version.

To bring the sources back into sync, port the Phase 1–3 changes to TypeScript and React, add appropriate tests, and verify that `npm run build:source` produces an app functionally equivalent to the current installed version. After that, `out/` can again be treated as a generated build output.
