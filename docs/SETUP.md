# Building a Windows installer

The project already has `electron-builder` and NSIS configuration. In this repository, `npm run dist` creates an x64 Windows installer and a portable EXE from the current code in `out/`.

## Requirements

- Windows 10/11 x64
- Node.js and npm; this package was checked with Node.js 24
- Internet access for the first `npm ci`
- Windows C++ build tools if a native dependency needs local compilation

## Commands

```powershell
npm ci
npm run dist
```

The outputs are written to `release/`: `Notlar-Setup-0.1.0-x64.exe` and `Notlar-Tasinabilir-0.1.0-x64.exe`. The `release/` directory is excluded from the source repository. Binaries can be published separately under GitHub Releases.

`npm run build` and `npm run dist:source` compile the older TypeScript sources. To package the current app features, use `npm run dist` until the gap described in [source status](SOURCE_STATUS.md) is resolved.

Before distributing an installer, test installation, first launch, local database creation, audio recording, PDF/Word export, and uninstalling in a clean Windows user profile. Without a code-signing certificate, Windows SmartScreen may display a warning.
