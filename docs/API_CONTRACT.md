# Play Aethro Launcher API Contract

Default API base used by the launcher:

```txt
https://aethro.net/api
```

Override for local development:

```bash
VITE_AETHRO_API_BASE=http://localhost:3000/api npm run tauri dev
```

## Aethro Login

`POST /auth/login`

Request:

```json
{
  "identifier": "username-or-email@example.com",
  "password": "plain-text-password-over-https-only",
  "client": "play-aethro-launcher",
  "remember": true
}
```

Response:

```json
{
  "accessToken": "short-lived-access-token",
  "refreshToken": "longer-lived-refresh-token-when-remember-is-true",
  "expiresAt": "2026-07-11T15:00:00.000Z",
  "user": {
    "id": "user_123",
    "username": "Paul",
    "displayName": "Paul",
    "email": "paul@example.com",
    "avatarUrl": "https://aethro.net/uploads/avatar.png"
  }
}
```

The launcher stores tokens, not passwords. Remembered Aethro sessions persist in browser `localStorage` between launcher sessions.

## Refresh Saved Session

`POST /auth/refresh`

Request:

```json
{
  "refreshToken": "refresh-token",
  "client": "play-aethro-launcher"
}
```

Response shape is the same as `/auth/login`.

## Current Account

`GET /account/me`

Headers:

```txt
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "id": "user_123",
  "username": "Paul",
  "displayName": "Paul",
  "email": "paul@example.com",
  "avatarUrl": "https://aethro.net/uploads/avatar.png"
}
```

## Logout

`POST /auth/logout`

Headers:

```txt
Authorization: Bearer <accessToken>
```

Request:

```json
{
  "refreshToken": "refresh-token-if-present",
  "client": "play-aethro-launcher"
}
```

## Discord Login Start

`POST /auth/discord/launcher-url`

Request:

```json
{
  "client": "play-aethro-launcher"
}
```

Response:

```json
{
  "url": "https://aethro.net/auth/discord/start?client=play-aethro-launcher&state=..."
}
```

Current starter opens this URL in the user's browser. The return-to-launcher callback/deep-link is intentionally still a TODO.

## RSS News Feeds

These are fetched by the Rust side of the launcher to avoid webview CORS problems:

```txt
https://playaethro.online/news/aethro-online.rss
https://playaethro.online/news/aethro-reforged.rss
https://playaethro.online/news/shadows-of-aethro.rss
https://playaethro.online/news/play-aethro-launcher.rss
```

The home page also requests the forum-announcement feed:

```txt
https://playaethro.online/forums/announcements.rss
```

It must contain only public, staff-approved announcements. Each item should use the
same RSS fields as the editorial feeds and include a category containing one of
`Shadows`, `Reforged`, `Aethro Online`, or `Launcher` when it belongs to a game.
The launcher labels these entries **Community Forums** instead of presenting them as
editorial news.

## Launcher game hub metadata

The launcher currently has safe local defaults, but the account/home endpoint may
return this optional metadata per game so website URLs, paid status, and music do not
need a launcher update to change:

```json
{
  "games": [{
    "id": "reforged",
    "feedId": "aethro-reforged",
    "accent": "reforged",
    "premium": { "status": "active", "label": "Premium", "url": "https://..." },
    "links": { "website": "https://...", "forum": "https://...", "vote": "https://...", "shop": "https://..." },
    "music": { "label": "Reforged Soundtrack", "tracks": [{ "title": "Track name", "src": "https://cdn.../track.mp3" }] }
  }]
}
```

`premium.status` is an account entitlement, never a client-side guess. Do not expose
payment history or private account details in this response. Music URLs must be public,
HTTPS, and licensed for launcher playback.

## Dominion launcher handoff

The launcher checks closed-beta eligibility using the existing bearer-authenticated
endpoint. `aethro_account_id` must match the account resolved from that bearer token;
the server must reject a mismatch.

```http
GET /api/account/games/dominion/beta-access?aethro_account_id={immutable_aethro_id}
Authorization: Bearer {aethro_access_token}
```

```json
{ "enabled": true, "access": "tester" }
```

When a player presses **Play Dominion**, the launcher calls:

```http
POST /api/account/games/dominion/launch
Authorization: Bearer {aethro_access_token}
```

The Play Aethro API verifies the bearer token and Dominion eligibility, then creates
a short-lived, single-use handoff and responds with the Dominion-origin URL only:

```json
{
  "launch_url": "https://dominion.playaethro.online/auth/launcher/consume?code={single_use_code}",
  "expires_at": "2026-09-18T18:00:00Z"
}
```

Dominion consumes the code once, creates its own secure HttpOnly browser session, and
redirects to the game. Never put Aethro access tokens, refresh tokens, passwords, or
profile data in this URL.

## Reforged Client

The launcher links players to the official uploaded Reforged client folder:

```txt
https://aethro.net/downloads/ar-launcher-stuff/Aethro_Reforged
```

After the player selects the downloaded client folder, the launcher verifies `Wow.exe` and `Data`, writes the Aethro realm list, and checks every managed file against the HTTPS-delivered manifest hashes before launch.

On Windows, the launcher opens the verified client executable. On Apple Silicon macOS, the launcher keeps Reforged installation, repair, file verification, realm setup, and launch authorization in its own flow, then runs the imported WoWSilicon `.shortcut` by its workflow name using Apple's `shortcuts://run-shortcut` URL scheme. The Apple Silicon installer bundles the official WoWSilicon 3.2.2 app plus its matching GPL-3.0 source archive and license. WoWSilicon owns its Wine/graphics runtime and runtime updates; the launcher owns the Reforged client files and their manifest checks. Do not remove or rename WoWSilicon's installed Direct3D 9 runtime file during macOS launch preparation. Exclude files WoWSilicon mutates or supplies (`mods/winerosetta.dll`, `mods/libSiliconPatch.dll`, `DivxDecoder.dll`, `DivxDecoder.dll.bak`, `dlls.txt`, and WoWSilicon DLL loader files) from macOS integrity checks and repairs. Users must approve first open in Gatekeeper; launcher code must never clear the macOS quarantine attribute.

The launcher stores the user-selected WoWSilicon `.shortcut` file path and workflow name in local launcher configuration only; neither value is sent to Aethro APIs. The selected shortcut must be imported into Apple Shortcuts. macOS may request shortcut permissions on first run. First-time Reforged setup still requires choosing/patching the game profile in WoWSilicon and importing its exported shortcut; subsequent updates and launches are handled from the Aethro launcher.

## Shadows Launch Proof

`POST https://playaethro.online/api/account/game-launches`

Headers:

```txt
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "game": "shadows-of-aethro",
  "minecraft_uuid": "player-minecraft-uuid",
  "minecraft_username": "PlayerName",
  "launched_at": "2026-07-25T12:00:00.000Z"
}
```

The launcher must not send install paths, device details, launcher state, hardware data, or local file paths.

## MUD Login Later

Aethro Online should use your existing flow:

```txt
account login -> character list -> user selects character -> request existing single-use character token -> terminal connects
```

Recommended endpoint shape:

```txt
GET  /mud/characters
POST /mud/characters/{characterId}/token
```

## Launcher Staff Blades

All staff requests are Bearer-authenticated with the signed-in Aethro account. The
server resolves the account with Aethro OAuth, then checks the account's per-game
staff role for every read and mutation; launcher-supplied role claims are never trusted.

```txt
GET  https://playaethro.online/api/launcher/staff/access
GET  https://playaethro.online/api/launcher/staff/reforged/players?q={name}
GET  https://playaethro.online/api/launcher/staff/reforged/audit
POST https://playaethro.online/api/launcher/staff/reforged/actions
```

The access response includes a `games` map keyed by `shadows-of-aethro`,
`aethro-online`, `aethro-reforged`, and `dominion`. The launcher only renders a game's
Staff rail when its `access` value is true. The current non-Reforged rails link to the
existing protected game control centers; Reforged quick actions are executed by the
server through its configured SOAP/RA relay and recorded in `launcher_staff_audits`.
Allowlisted Reforged actions are `broadcast`, `kick`, and `mute`; each request is
permission-checked server-side and player actions require a reason. SOAP credentials
must remain server-side. Maintenance notices are forum posts surfaced by the existing
forum RSS feed; there is no launcher maintenance scheduler.
