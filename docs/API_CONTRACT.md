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

The launcher stores tokens, not passwords. The current starter uses `localStorage` for development speed. Before public release, move saved refresh tokens to OS-backed secure storage/keychain.

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
https://aethro.net/rss.php?division=play-aethro
https://aethro.net/rss.php?division=aethro-online
https://aethro.net/rss.php?division=minecraft-survival
```

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
