# Aethro OAuth login for the launcher

The launcher uses the existing Aethro OAuth/account system. No new launcher-only API is required for login.

## Existing Aethro endpoints

```text
Authorize URL:      https://aethro.net/oauth/authorize/
Token URL:          https://aethro.net/oauth/token/
User Info URL:      https://aethro.net/api/account/userinfo/
Discord Guilds URL: https://aethro.net/api/account/discord-guilds/
Logout URL:         https://aethro.net/oauth/logout/
```

## Development callback URL

Register this callback URL for the launcher product/app while developing:

```text
http://127.0.0.1:38987/oauth/callback
```

When the user clicks **Log in with Aethro**, the launcher:

1. Starts a tiny local callback listener on port `38987`.
2. Opens the Aethro authorize URL in the browser.
3. Receives the OAuth callback locally.
4. Exchanges the code at the existing token URL.
5. Calls the existing user info URL.
6. Saves the returned launcher session locally when “Remember this device” is checked.

## Environment values

The launcher defaults are in `src/lib/api.ts`. You can override these when needed:

```bash
VITE_AETHRO_OAUTH_CLIENT_ID=play-aethro-launcher
VITE_AETHRO_OAUTH_REDIRECT_URI=http://127.0.0.1:38987/oauth/callback
VITE_AETHRO_OAUTH_SCOPE="profile email"
```

## Notes

The launcher uses PKCE. That is the desktop-app-safe OAuth flow because the launcher does not need to ship a private client secret.

If your OAuth product requires a client secret for token exchange, make a public/PKCE product for the launcher instead. Do not embed a secret inside a public desktop app.
