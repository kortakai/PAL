# Play Aethro Launcher Roadmap

## v2.5 — Game launch and operations foundation

### Reforged on macOS
- Keep the Reforged manifest checker, updater, realm setup, and short-lived launch authorization as the launch gate on every platform.
- Add an Apple Silicon macOS launch path through a WoWSilicon-created profile shortcut; the launcher never guesses at private WoWSilicon command-line interfaces.
- Detect the installed WoWSilicon app, open it for runtime management, and save the selected Reforged shortcut.
- Package the upstream WoWSilicon app in the Apple Silicon installer with its matching GPL-3.0 source archive and license; the exact upstream release and source commit are SHA-256 pinned by the packaging step.
- Treat the combined macOS artifact as unsigned for now. Require the user to approve first open in Gatekeeper; never remove quarantine attributes automatically. A signed/notarized release remains a separate follow-up.
- Preserve WoWSilicon's Direct3D 9 runtime files on macOS. Keep WoWSilicon runtime updates separate from Reforged client updates and manifest verification.
- First-run flow: the launcher installs/verifies Reforged first; then it opens the WoWSilicon setup controls, where the user creates and patches its Reforged 3.3.5a profile and creates a launch shortcut; the user imports that shortcut in the launcher, after which Play runs Reforged through WoWSilicon.

### Player game blades
- Reforged: launch readiness, client/runtime state, character roster, account setup, and Reforged news.
- Kalismor: existing character list and selection, character creation, login handoff, terminal, live world status, and news.
- Dominion: existing Aethro access check and one-time launch handoff, plus links/news only where a real player API provides the data.
- Keep game-specific capabilities honest; do not invent House, reward, character, or status data when an API is unavailable.

### Staff game blades
- A launcher Staff area appears only when the authenticated account endpoint grants game-specific staff access.
- Reforged, Kalismor, and Dominion each get a separate, compact control view matching the game-specific launcher design.
- The launcher calls authenticated PlayAethro staff APIs. SOAP/worldserver credentials stay server-side; only allowlisted actions are exposed, with reasons and audit records for mutations.
- Existing Discord bot report handling and forum/RSS announcements remain in their current systems.
- Roll out one game at a time after each backend permission, audit, and live integration path is available.

### AAA launcher foundation
- Carry the game art, compact navigation, live game status, readable patch progress, and clear recovery actions across the game pages.
- Library is the full game catalog, not a selected game's character list. Downloads shows only real per-game client install/check progress and actions; do not present setup forms as downloads or imply unsupported game downloads.
- Maintain signed launcher updates and platform-specific install/repair behavior.

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
