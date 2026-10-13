# Play Aethro Launcher Starter

Tauri v2 + React starter for the Play Aethro desktop launcher.

Current features:

- Hero/login screen
- Aethro username/email + password login flow
- Discord browser-login start flow placeholder
- Saved launcher session token
- Auto-refresh shape for saved sessions
- Logout
- RSS news tabs for Play Aethro, Aethro Online, and Shadows of Aethro
- Game cards for Shadows of Aethro and Aethro Online
- Website/Discord external buttons
- Rust-side RSS/API requests to reduce webview CORS pain

## Run locally

```bash
npm install
npm run tauri dev
```

## Local API override

By default the launcher calls:

```txt
https://aethro.net/api
```

For a local backend:

```bash
VITE_AETHRO_API_BASE=http://localhost:3000/api npm run tauri dev
```

## Important security note

The launcher stores remembered Aethro sessions in browser `localStorage` so players remain signed in between launches.

Do not save raw passwords. Ever.

## Backend endpoints expected

See `docs/API_CONTRACT.md`.

## Build installers

```bash
npm run tauri build
```

For an Apple Silicon macOS package that includes WoWSilicon, prepare the pinned upstream app and matching GPL-3.0 source before building:

```bash
npm run prepare:wowsilicon:macos
npm run tauri build -- --target aarch64-apple-darwin --config src-tauri/tauri.wowsilicon.conf.json
```

This test package is unsigned. macOS will require users to approve its first open; the launcher does not bypass Gatekeeper or remove quarantine. First-time Reforged setup still includes creating and importing the WoWSilicon profile shortcut. Public releases should be signed and notarized once Apple Developer ID access is available.


## Aethro OAuth login

This starter now uses the existing Aethro OAuth endpoints from `aethro.net`. Register the dev callback URL below in the Aethro product config before testing real login:

```text
http://127.0.0.1:38987/oauth/callback
```

See `docs/AETHRO_OAUTH.md` for the details.
