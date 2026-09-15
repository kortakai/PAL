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

## Reforged Client

The launcher links players to the official uploaded Reforged client folder:

```txt
https://aethro.net/downloads/ar-launcher-stuff/Aethro_Reforged
```

After the player selects the downloaded client folder, the launcher verifies `Wow.exe` and `Data`, writes the Aethro realm list, and opens the configured client executable.

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
