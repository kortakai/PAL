# Play Aethro Launcher Roadmap

## v0.1 — Branded launcher shell
- Hero-card login screen.
- Aethro login placeholder.
- Discord login placeholder.
- Remember-device placeholder.
- Dashboard with launcher-only news.
- Game cards for Shadows of Aethro and Aethro Online.
- Buttons to open website and Discord in browser.

## v0.2 — Backend wiring
- Real Aethro auth.
- Secure refresh-token storage.
- Real launcher home/news endpoint.
- Real Discord OAuth callback via deep link.
- Logout/device revocation.

## v0.3 — Aethro Online
- Character list from `/mud/characters`.
- Character picker.
- Request existing single-use character token.
- Embedded terminal using xterm.js.
- TCP/telnet bridge in Rust or WebSocket bridge from MUD backend.

## v0.4 — Shadows patcher
- Download manifest.
- Verify SHA-256 hashes.
- Download missing/changed files.
- Repair install.
- Remove unmanaged old mod jars under controlled paths.

## v0.5 — Minecraft launch
- Microsoft/Minecraft auth flow.
- Fabric instance setup.
- Java runtime detection.
- Launch Minecraft with server quick-play args.
- Log export button.

## v1.0 — Public launcher
- Windows signing.
- macOS signing/notarization.
- Auto-update.
- Stable/beta channels.
- Crash reports.
- Staff/tester entitlement channels.
