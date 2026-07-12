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

This starter stores session tokens in `localStorage` for fast development. Do **not** ship public builds that save long-lived refresh tokens there. Before public release, move saved sessions to OS-backed secure storage/keychain.

Do not save raw passwords. Ever.

## Backend endpoints expected

See `docs/API_CONTRACT.md`.

## Build installers later

```bash
npm run tauri build
```

Public releases should be signed/notarized for Windows/macOS.


## Aethro OAuth login

This starter now uses the existing Aethro OAuth endpoints from `aethro.net`. Register the dev callback URL below in the Aethro product config before testing real login:

```text
http://127.0.0.1:38987/oauth/callback
```

See `docs/AETHRO_OAUTH.md` for the details.
