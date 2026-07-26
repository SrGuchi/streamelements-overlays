# Kick Relay

Bridges **Kick chat → WebSocket** so the StreamElements overlay can show Kick
messages in the same unified stream as Twitch/YouTube.

```
Kick (Pusher WS) ──ingest──► relay ──push──► widget (WS)
```

Twitch + YouTube + all alerts arrive natively in StreamElements, so this relay
is **only needed for Kick**. If you don't stream on Kick, skip it.

## Run locally

```bash
cd relay
npm install
npm start          # listens on :8080 (or $PORT)
# health check:    curl localhost:8080/health
```

## Deploy to Railway

1. New project → Deploy from this repo, **root directory = `relay/`**.
2. Railway auto-detects Node (Nixpacks) and runs `npm start`. `PORT` is provided
   by Railway. For public deployments, set `RELAY_TOKEN` to a long random value.
3. Generate a public domain. Your widget's **Relay WebSocket URL** is then:
   `wss://<your-app>.up.railway.app`

## Connecting the widget

In the overlay settings → **Multistream** group:
- **Relay WebSocket URL**: `wss://<your-app>.up.railway.app`
- **Kick channel**: your channel **slug** (e.g. `xqc`) **or** the numeric
  **chatroom id**.
- **Relay access token**: only required when the relay has `RELAY_TOKEN` set.
  Leave it empty for local/dev relays without a token.

### ⚠️ Cloudflare note (important)
Resolving a slug → chatroom id calls `kick.com/api/v2/channels/<slug>`, which
**Cloudflare often blocks from datacenter IPs** (Railway included) → returns 403.
If your slug doesn't connect, pass the **numeric chatroom id** directly instead:

1. Open `https://kick.com/<your-channel>` in a browser.
2. DevTools → Network → filter `pusher` (or `chatrooms`).
3. Find the subscription to `chatrooms.<ID>.v2` → use that `<ID>`.

The relay accepts a numeric id as the channel value and skips the lookup entirely.

## Notes
- Kick's chat connection is **unofficial** (reverse-engineered Pusher channel).
  It's isolated in `src/index.js` with reconnect/backoff; if Kick changes the
  Pusher app key or URL, only that file needs updating.
- One Kick connection is shared per chatroom across all connected widgets.
- Empty chatrooms are closed immediately when the last widget disconnects.

## Official Kick alerts (OAuth + webhooks)

Follow / subscription / gift-sub / Kicks-tip alerts use Kick's **official**
public API (OAuth 2.1 + PKCE, signed webhooks) instead of the unofficial
Pusher bridge above — see `src/kickAuth.js` and `src/kickWebhook.js`. These
feed a separate widget, [`widget-kick-alerts/`](../widget-kick-alerts/), over
a distinct relay WebSocket channel (`platform: 'kick-alerts'`).

### Env vars

| Var | Required | Default |
|---|---|---|
| `KICK_CLIENT_ID` | yes | — (set on Railway) |
| `KICK_CLIENT_SECRET` | yes | — (set on Railway) |
| `KICK_REDIRECT_URI` | no | `https://streamelements-overlays-production.up.railway.app/callback` |
| `KICK_TOKEN_PATH` | no | `relay/data/kick-tokens.json` |

### One-time setup

1. Make sure a Kick app exists in the [Kick Developer Portal](https://kick.com/settings/developer)
   with its **redirect URL** set to `<your-domain>/callback` and **webhook URL**
   set to `<your-domain>/kick/webhook`, with the `user:read`, `channel:read`,
   `events:subscribe`, and `kicks:read` scopes enabled.
2. **As the streamer**, logged into your Kick account in a browser, visit:
   `https://<your-app>.up.railway.app/kick/authorize?token=<RELAY_TOKEN>`
   (the `?token=` query param is only required if `RELAY_TOKEN` is set).
3. You'll be redirected to Kick to authorize the app, then bounced back to a
   confirmation page ("✅ Kick conectado"). This persists the access/refresh
   tokens and automatically subscribes to the follow/sub/gift/Kicks webhook
   events — no further action needed.
4. Repeat this step only if the token file is lost (see below) or you need to
   re-authorize after revoking access on Kick's side.

### ⚠️ Railway Volume required

Railway's container filesystem is **ephemeral** — a redeploy wipes anything
not on a mounted Volume. Without one, `relay/data/kick-tokens.json` (or your
`KICK_TOKEN_PATH`) is lost on every redeploy and you'll have to redo step 2
above each time. To avoid that:

1. In the Railway dashboard, open the relay service → **Volumes** → **New
   Volume**.
2. Mount it at the **directory** containing `KICK_TOKEN_PATH` (default:
   `/app/data`, since the service runs from `relay/` and the default token
   path is `relay/data/kick-tokens.json`).
3. Redeploy. Tokens now survive future redeploys and restarts.

### Webhook delivery

`/kick/webhook` is called directly by Kick (already configured in the
Developer Portal) — no manual action needed. Every request's signature is
verified (`RSA-SHA256` against Kick's public key) before any event is
broadcast; unsigned or tampered requests are rejected with a non-200 so Kick
doesn't mistake a forged request for success.
