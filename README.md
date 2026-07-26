# Multistream Chat Overlay (StreamElements)

![CI](https://github.com/ahmetenesdur/streamelements-overlays/actions/workflows/ci.yml/badge.svg)

A fully customizable **multistream chat overlay** for StreamElements that shows
**Twitch + YouTube + Kick** chat in one unified feed. Ships with **6 genuinely
distinct style presets** plus a full override layer — pick a preset or build your
own look — with inline alerts, custom emotes (7TV / BTTV / FFZ), pronouns, roles,
sounds, and visual effects. Self-contained: **no external CSS/JS**, only the
webfont you choose.

```
Twitch + YouTube + SE alerts ─┐
   (native onEventReceived)    │
Kick (Railway relay → WS) ─────┼─► normalize*() ─► UnifiedMessage ─► render()
7TV/BTTV/FFZ + pronouns ───────┘                                     (applyTheme → CSS vars)
```

Every source is reduced to one `UnifiedMessage`; the renderer only sees that.
The look is driven entirely by **CSS custom properties** that `widget.js` writes
on top of a preset token bundle — so it renders **identically in StreamElements
and in the local preview**.

## Features

**Platforms** — Twitch + YouTube arrive natively through StreamElements (no
backend). Kick is bridged by the bundled **Railway relay** (`relay/`). Per-platform
show/hide lets you run one platform or combine any subset. The relay supports an
optional shared access token for public deployments.

**Presets & layout**
- **6 style presets**, each a committed identity with its own accent, font, and one
  signature detail: **Caption** (type on video) · **Onyx** (solid readable chip) ·
  **Capsule** (rounded multistream look, dots + avatars) · **Rolecard** (role-rich
  cards) · **Daylight** (light editorial print, serif usernames) · **Terminal**
  (dev monospace with a `›` prompt caret).
- **Build your own** — every surface / colour / font is overridable and **beats the
  active preset**; leave a field empty to inherit the preset's value.
- **7 quick-start scenes** apply a preset + layout + behaviour in one click, then
  release back to *Manual* so your later edits are never locked.
- **3 layouts**: Vertical (column) · Horizontal (side-by-side ticker — newest enters
  from the right/left, older clipped, never piles up) · Fullscreen (wide column).
- Left/right align, top/bottom origin, comfortable/compact density, max messages,
  hide-after, message width/gap, edge-fade mask.
- Distinctive per-preset fonts (Hanken Grotesk · Bricolage Grotesque · Instrument
  Serif · Space Mono) or any Google font; full colour/size control.

**Messages**
- **Second-message grouping** — legacy inline merge or a stacked follow-up that drops
  the repeated header.
- **Dynamic opacity** — older visible rows fade by age (newest stays fully opaque).
- **Shared Chat** (Twitch Stream Together) detection + origin marker, optional
  `roomId:name` labels (auto-coloured per channel), and an opt-in **participants
  panel** — a live corner roster of the channels in the session (host auto-named,
  guests labelled, running count).

**Identity & roles**
- Roles: broadcaster · lead mod · moderator · artist · vip · subscriber · fav · regular,
  each with its own colour (lead mod / fav are user-defined username lists).
- **Per-role visual matrix** — each role can colour the message text, wear a tinted
  username chip, and tint the whole bubble, all derived from that role's own colour.
- **Pronouns** (opt-in) for Twitch users via `api.pronouns.alejo.io`.
- Platform logo and/or coloured platform dot (per-platform enable + colour); badges;
  a **53-glyph icon library** or user avatar, with **per-role icon overrides** for all
  8 roles.
- Username colour modes (platform / text / custom / hidden), native colour placement
  (on the text or as a username-background chip), and highlighted keywords.
- **7TV / BTTV / FFZ** custom emotes (global + channel, fetched client-side) including
  **zero-width overlay** emotes, with an optional cache-refresh interval.

**Alerts** — inline follow / sub / resub / gift / community-gift / tip / cheer / raid /
host as refined accent lines: per-type enable, custom label format with tokens
(`{name}`, `{amount}`, `{count}`, `{sender}`, `{reward}`…), minimum display time, and
a sound per event (cheer/raid/gift/etc. map to the nearest configured sound slot).
**YouTube-aware subtypes** — Super Chat and membership alerts get their own labels when
StreamElements provides the platform hints (tolerant detection, falls back to tip/sub).
Channel-point / Store **reward** alerts are supported when StreamElements delivers the
matching payload.

**Effects** — edge-fade mask, perspective tilt (X/Y/Z) with zoom + field-of-view,
and crayon (hand-drawn) texture. Signature liquid entrance/exit with
**reduced-motion** support. No decorative gradients, glows, or backdrop blur — each
preset earns its depth from one intentional detail.

> **Deferred:** TikTok and Ko-fi ingestion are intentionally out of scope for now —
> they need separate platform/webhook integration beyond the native StreamElements
> event surface, so they are planned as their own phase.

## Architecture (hybrid)

| Source | Path |
|---|---|
| Twitch + YouTube + SE alerts | **native** via SE `onEventReceived` — no backend |
| Kick chat | **Railway relay** (unofficial Pusher bridge) → WebSocket → widget (`relay/`) |
| Kick alerts (follow/sub/gift/Kicks) | **Railway relay** (official Kick OAuth + signed webhooks) → WebSocket → `widget-kick-alerts/` |
| 7TV / BTTV / FFZ + pronouns | public CORS APIs, fetched **client-side** |

## Repo layout

```
widget/             widget.html · widget.css · widget.json (Fields) · widget.js  ← deploy to SE (chat overlay)
widget-kick-alerts/ widget.html · widget.css · widget.json (Fields) · widget.js  ← deploy to SE (official Kick video alerts)
preview/            index.html + mock-se.js   ← local SE event simulator
relay/              Railway Node.js service (Kick chat + official Kick alerts) — see relay/README.md
test/               widget.test.cjs + harness.cjs (pure-Node unit tests, no jsdom)
scripts/            serve.mjs (preview server) · build.mjs (validate + version stamp)
.github/            CI (Node 18/20/22) + tag-triggered GitHub Releases
```

## Install in StreamElements

1. **Create a Custom Widget** — StreamElements dashboard → **Streaming Tools → My
   Overlays** → open or create an overlay → **+ Add Widget → Static / Custom → Custom
   Widget** → **⚙ → Open Editor** (the `</>` editor).
2. **Paste the four files** into the matching editor tabs, then click **Done**:

   | Tab | File |
   |---|---|
   | HTML | [`widget/widget.html`](widget/widget.html) |
   | CSS | [`widget/widget.css`](widget/widget.css) |
   | JS | [`widget/widget.js`](widget/widget.js) |
   | FIELDS | [`widget/widget.json`](widget/widget.json) |

3. **Configure** from the Fields panel (**13 grouped sections, 128 settings**). Start at
   **Style → Preset**: pick a quick-start scene for a one-click look, or keep *Manual*
   and tune individual fields. Most colour/font fields are **empty = preset** — set one
   and your value wins on every preset.
4. **Connect platforms** (all in the **Multistream** group):
   - **Twitch** — works once the overlay runs on your Twitch-connected SE account.
   - **YouTube** — connect YouTube in SE (*Account → Channels*) and go live; SE then
     forwards YouTube chat to the same `message` event.
   - **Kick** — deploy the relay (see [`relay/README.md`](relay/README.md)), then set
     **Relay WebSocket URL** + **Kick channel** (slug, or numeric chatroom id if the
     slug is blocked). Leave blank if you don't stream on Kick.
5. **Use in OBS** — copy the overlay URL (**… → Copy URL**) into an OBS **Browser
   Source** at your canvas size.
6. **(Optional) Official Kick alerts** — for a big video+sound alert box (follow /
   sub / resub / gift subs / Kicks tips), driven by Kick's official OAuth + webhook
   API rather than chat, install
   [`widget-kick-alerts/`](widget-kick-alerts/) as a **second** Custom Widget (its
   own OBS Browser Source), pointed at the **same** Relay WebSocket URL/token as the
   chat widget. One-time setup on the relay side is documented in
   [`relay/README.md`](relay/README.md#official-kick-alerts-oauth--webhooks).

Field groups: Style · Layout · Typography · Username & Colors · Badges & Platform ·
Roles & Highlights · Messages · Animations · Alerts · Sound · Effects · Advanced ·
Multistream.

## Local development

```bash
npm run preview     # http://localhost:5173/preview/index.html  (widen the window!)
npm run validate    # validate widget.json + required files
npm run build       # stamp widgetVersion from package.json (for auto-update)
npm test            # validate + relay tests + 86 widget unit tests
```

The preview is a small **studio**: a top bar (scene · device frame · motion freeze), a
device-framed stage (Desktop / OBS 16:9 / Mobile), a **searchable** inspector that
live-toggles every Fields setting, and **Simulate / Feature demo** buttons that fire
Twitch/YouTube/Kick messages, alerts, message grouping, shared chat + participants
panel, age fade, and per-role colours — no StreamElements account
needed. It runs the real `widget.js`, so what you see is what SE renders.

## Auto-update

The widget carries hidden `widgetVersion` + `widgetUpdateUrl` fields (pointing at this
repo's `widget/` folder) — the convention StreamElements' own widgets use. To cut a
release: bump `package.json` version → `npm run build` (stamps `widgetVersion`) →
commit → push to `main`. Optionally push a `v*` tag — the **Release** workflow
validates, tests, and attaches the four widget files to a GitHub Release.

The most reliable way for others to receive an update is to re-add the overlay via a
**share link** or re-paste the four files; an automatic in-editor "update available"
prompt is not an officially documented StreamElements feature, so don't rely on it.

## Status

**Current: v1.3.0** · 128 fields · 13 setting groups · 86 widget tests + 22 relay
assertions · CI on push/PR (Node 18 / 20 / 22).

**Roadmap:** public StreamElements library listing · TikTok + Ko-fi ingestion
(separate integration phase, intentionally deferred).

## Contributing

This is plain, dependency-free vanilla JS by design (the only runtime dependency is
`ws`, in the relay). To work on it:

```bash
npm run preview     # iterate visually against the local simulator
npm test            # must stay green before a PR
```

Keep the widget self-contained (no new front-end dependencies, no external CSS/JS),
add or update tests in `test/widget.test.cjs` for behaviour changes, and run
`npm run build` if you bump the version.

## License

MIT
