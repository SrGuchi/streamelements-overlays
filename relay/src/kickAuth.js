/* ================================================================
   Kick official API — OAuth 2.1 (PKCE) + token persistence
   ----------------------------------------------------------------
   One-time setup: the streamer visits GET /kick/authorize (see
   index.js), which redirects here through Kick's consent screen and
   back to GET /callback. That callback exchanges the code for an
   access/refresh token pair, persists them to disk, and subscribes
   the app to the follow/sub/gift/Kicks webhook events.

   Everything network-touching here is a thin wrapper so the pure
   parts (PKCE generation, URL building, the pending-auth store,
   expiry math) can be unit-tested without a socket — see
   relay/test.cjs.
   ================================================================ */
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const KICK_ID_BASE = 'https://id.kick.com';
const KICK_API_BASE = 'https://api.kick.com/public/v1';
const KICK_SCOPES = 'user:read channel:read events:subscribe kicks:read';
const TOKEN_REFRESH_SKEW_MS = 60_000; // refresh 60s before actual expiry

// Events this app subscribes to once OAuth completes (see subscribeToEvents).
const KICK_EVENT_SUBS = [
  { name: 'channel.followed', version: 1 },
  { name: 'channel.subscription.new', version: 1 },
  { name: 'channel.subscription.renewal', version: 1 },
  { name: 'channel.subscription.gifts', version: 1 },
  { name: 'kicks.gifted', version: 1 },
];

// ---------------------------------------------------------------
//  PKCE
// ---------------------------------------------------------------
function pkceChallenge() {
  const verifier = crypto.randomBytes(32).toString('base64url'); // 43 chars
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function createAuthorizeUrl({ clientId, redirectUri, scope, state, challenge }) {
  const u = new URL(KICK_ID_BASE + '/oauth/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', scope || KICK_SCOPES);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

// One-time state store for in-flight PKCE verifiers: a `state` can only be
// redeemed once (take() deletes it), and stale in-flight attempts expire so
// an abandoned auth flow doesn't leak memory.
function createPendingAuthStore(ttlMs = 10 * 60 * 1000) {
  const map = new Map(); // state -> { verifier, expiresAt }
  function sweep() {
    const now = Date.now();
    for (const [k, v] of map) if (v.expiresAt < now) map.delete(k);
  }
  return {
    put(state, verifier) {
      sweep();
      map.set(state, { verifier, expiresAt: Date.now() + ttlMs });
    },
    take(state) {
      sweep();
      const entry = map.get(state);
      if (!entry) return null;
      map.delete(state);
      return entry.verifier;
    },
    size() { return map.size; },
  };
}

// ---------------------------------------------------------------
//  Token exchange / refresh (network)
// ---------------------------------------------------------------
async function postToken(bodyObj) {
  const body = new URLSearchParams(bodyObj);
  const res = await fetch(KICK_ID_BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`kick token endpoint ${res.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, refresh_token, token_type, expires_in, scope }
}

function exchangeCodeForToken({ code, verifier, redirectUri, clientId, clientSecret }) {
  return postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: verifier,
  });
}

function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  return postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

// ---------------------------------------------------------------
//  Token file persistence
// ---------------------------------------------------------------
async function loadTokens(tokenPath) {
  try {
    return JSON.parse(await fs.readFile(tokenPath, 'utf8'));
  } catch {
    return null;
  }
}

async function saveTokens(tokenPath, tokens) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));
}

function isExpired(tokens) {
  if (!tokens || !tokens.obtained_at || !tokens.expires_in) return true;
  return Date.now() >= tokens.obtained_at + tokens.expires_in * 1000 - TOKEN_REFRESH_SKEW_MS;
}

// Returns a valid access token, refreshing + persisting if the stored one is
// stale. Throws if no token file exists yet (streamer hasn't run /kick/authorize).
async function getValidAccessToken(tokenPath, { clientId, clientSecret }) {
  let tokens = await loadTokens(tokenPath);
  if (!tokens) throw new Error('no kick tokens on disk — visit /kick/authorize once');
  if (isExpired(tokens)) {
    const fresh = await refreshAccessToken({ refreshToken: tokens.refresh_token, clientId, clientSecret });
    tokens = Object.assign({}, tokens, fresh, { obtained_at: Date.now() });
    await saveTokens(tokenPath, tokens);
  }
  return tokens.access_token;
}

// ---------------------------------------------------------------
//  Broadcaster id + event subscription (network)
// ---------------------------------------------------------------
async function fetchBroadcasterUserId(accessToken) {
  const res = await fetch(KICK_API_BASE + '/users', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => null);
  const row = json && Array.isArray(json.data) && json.data[0];
  return row ? String(row.user_id) : null;
}

async function subscribeToEvents({ accessToken, broadcasterUserId }) {
  const body = { events: KICK_EVENT_SUBS, method: 'webhook' };
  if (broadcasterUserId) body.broadcaster_user_id = Number(broadcasterUserId);
  const res = await fetch(KICK_API_BASE + '/events/subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`kick subscribe ${res.status}: ${JSON.stringify(json)}`);
  return json; // { data: [{name,version,subscription_id,error}], message }
}

module.exports = {
  KICK_SCOPES,
  KICK_EVENT_SUBS,
  pkceChallenge,
  createAuthorizeUrl,
  createPendingAuthStore,
  exchangeCodeForToken,
  refreshAccessToken,
  loadTokens,
  saveTokens,
  isExpired,
  getValidAccessToken,
  fetchBroadcasterUserId,
  subscribeToEvents,
};
