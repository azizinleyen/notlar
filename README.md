# Notlar

**A Windows desktop app for recording meetings, turning speech into text, and keeping meeting notes organized.**

Notlar uses your computer's microphone and system audio without adding a bot to the meeting. It transcribes speech and keeps the transcript alongside your own notes. With an AI provider configured, it can enrich those notes, prepare a meeting summary, and export the content to PDF or Word.

| Platform | Interface | Database | License |
| --- | --- | --- | --- |
| Windows x64 | Electron, React, TypeScript | Local SQLite | MIT |

## Contents

- [Purpose](#purpose)
- [Installation](#installation)
- [User guide](#user-guide)
- [Data and privacy](#data-and-privacy)
- [Development approach](#development-approach)
- [Source code and development](#source-code-and-development)
- [Limitations](#limitations)
- [Contributing and license](#contributing-and-license)

## Purpose

Notlar brings meeting conversations, notes written during the meeting, and the resulting summary into one place. It is designed for a single user and does not require an account, a team workspace, or cloud synchronization.

| Feature | Description |
| --- | --- |
| Live transcription | Captures microphone and computer audio as separate channels and converts speech to text. |
| Note editing | Keeps raw notes with each meeting and supports selecting and copying text. |
| AI assistance | Produces structured notes and meeting summaries. |
| People | Lets you add people manually and associate them with notes. |
| Calendar | Reads an iCal calendar and, with separate Google OAuth authorization, can add follow-up meetings mentioned in a conversation to Google Calendar. |
| Export | Saves raw notes, enriched notes, summaries, and transcripts separately or in one PDF or Word document. |

## Installation

If a Windows installer has been published, download `Notlar-Setup-...exe` from the repository's **Releases** page and run it. A portable `Notlar-Tasinabilir-...exe` build can also be produced. Installer binaries are kept out of the source repository.

To build an installer from this repository, use Node.js and npm on Windows:

```powershell
npm ci
npm run dist
```

The installers are written to `release/`. See the [setup guide](docs/SETUP.md) for build details. The current binaries are not digitally signed.

## User guide

The current app interface is in Turkish. The menu names below include their Turkish labels to make the steps easier to follow.

### 1. Configure the app

Open **Settings (Ayarlar)** and configure a speech-to-text provider. To use the default Groq service, enter your own API key. Configure an AI provider as well if you want note enrichment and summaries. Do not add API keys to GitHub or to files shared with others.

### 2. Record a meeting

Start a new note or recording and grant the required microphone and system audio permissions. You can follow the live transcript and write raw notes during the meeting. Stop the recording when the meeting ends; the transcript and notes remain together in the meeting record. You can also import an existing audio file.

The microphone channel represents your voice, while the system channel represents audio played by your computer. Automatic identification of individual remote participants is not available.

### 3. Review and edit notes

Open the meeting record and review your raw notes and transcript. Text in the app can be selected and copied. If an AI provider is configured, enrich the notes and generate a meeting summary. Check generated content before sharing it.

Add people manually in the **People (Kişiler)** section and associate them with relevant meetings. The app does not automatically save people from your calendar or other sources.

### 4. Export content

In the meeting's **Export (Dışa aktar)** area, choose from raw notes, AI-enriched notes, the meeting summary, and the transcript. Save selected sections as separate files or combine them into one document. Choose **PDF** or **Word (.docx)** as the format.

### 5. Connect a calendar

An iCal (`.ics`) link can read existing calendar events; it cannot write to the calendar. To let Notlar add follow-up meetings discussed in a conversation to Google Calendar, create a **Desktop app OAuth** client in Google Cloud and connect it in Settings. Follow the [Google Calendar setup guide](docs/GOOGLE_CALENDAR.md). Review automatically created dates and times in your calendar.

## Data and privacy

Notlar stores its data in a local SQLite database. Database encryption is optional; check your settings to see whether it is enabled. When you choose an external transcription or AI provider, the relevant content is sent to that service. Review the provider's data handling terms.

This repository should not contain a real `.env` file, API keys, a Google OAuth client file, a private iCal URL, recordings, transcripts, or a personal database. `.env.example` contains empty example fields only. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Development approach

Notlar is an AI-assisted **vibe coding** project. The creator developed the concept and interface design and made minor bug fixes personally. Most of the implementation was produced through an iterative workflow with AI tools. This development history is disclosed so that contributors and users can assess the project with clear expectations.

## Source code and development

**Repository status:** The original TypeScript and React files in `src/` predate the Phase 1–3 fixes made to the installed app. The current app's runnable JavaScript, CSS, and HTML are in `out/`. `npm run dist` packages the current `out/` files. Running `npm run build` compiles the older `src/` files and overwrites the current fixes in `out/`. Bringing the two into sync is the project's main technical priority. Read the [source status](docs/SOURCE_STATUS.md) for details.

```text
src/       TypeScript and React development sources
out/       Packageable code for the current installed version
db/        Database schema
scripts/   Tests and development utilities
docs/      Setup and source status documentation
```

Development commands:

```powershell
npm run dev        # development app based on src/
npm run typecheck  # TypeScript checks
npm test           # tests based on src/
npm run dist       # Windows package from the current out/ files
```

`npm run dev` and `npm test` do not verify every behavior in the current `out/` version. Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.

## Limitations

- The current fixes have not yet been ported back to the TypeScript and React sources.
- Audio from remote participants is not automatically separated into individual speakers.
- Writing to Google Calendar requires your own Google OAuth configuration.
- The Windows installer is not digitally signed.

## Contributing and license

Bug reports and contributions are welcome. When proposing a change, state whether it affects `src/`, `out/`, or both. Notlar is released under the [MIT License](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency information.
