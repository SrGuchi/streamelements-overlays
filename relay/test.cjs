/* Unit tests for the Kick relay's pure parsers, using real-shaped Kick
   Pusher frames. Run: node relay/test.cjs  (exit 0 = pass) */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const {
  parseKickContent,
  toUnifiedKick,
  toUnifiedKickAlert,
  isAuthorizedSubscribe,
  detachClientFromRooms
} = require('./src/index.js');
const {
  pkceChallenge,
  createAuthorizeUrl,
  createPendingAuthStore,
  isExpired,
} = require('./src/kickAuth');
const {
  verifyKickSignature,
  normalizeFollow,
  normalizeSubNew,
  normalizeSubRenewal,
  normalizeSubGifts,
  normalizeKicksGifted,
  normalizeKickEvent,
} = require('./src/kickWebhook');

let n = 0;
const ok = (label) => { n++; console.log('  ✓ ' + label); };

// ---- emote parsing -------------------------------------------------
{
  const { text, emotes } = parseKickContent('hey [emote:37226:EZ] gg [emote:1730752:KEKW]');
  assert.strictEqual(text, 'hey EZ gg KEKW', 'emote names stay inline');
  assert.strictEqual(emotes.EZ, 'https://files.kick.com/emotes/37226/fullsize');
  assert.strictEqual(emotes.KEKW, 'https://files.kick.com/emotes/1730752/fullsize');
  ok('parseKickContent: [emote:id:name] → inline name + url map');
}
{
  const { text, emotes } = parseKickContent('plain text only');
  assert.strictEqual(text, 'plain text only');
  assert.deepStrictEqual(emotes, {});
  ok('parseKickContent: plain text → no emotes');
}

// ---- chat message --------------------------------------------------
{
  // Shape of App\Events\ChatMessageEvent data
  const data = {
    id: 'abc-123',
    content: 'hello world [emote:39000:catJAM]',
    sender: {
      id: 998877, username: 'KickPro', slug: 'kickpro',
      identity: { color: '#53fc18', badges: [{ type: 'moderator', text: 'Moderator' }, { type: 'subscriber', text: 'Subscriber', count: 6 }] }
    }
  };
  const u = toUnifiedKick(data);
  assert.strictEqual(u.msgId, 'abc-123');
  assert.strictEqual(u.userId, 998877);
  assert.strictEqual(u.displayName, 'KickPro');
  assert.strictEqual(u.color, '#53fc18');
  assert.strictEqual(u.text, 'hello world catJAM');
  assert.strictEqual(u.emotes.catJAM, 'https://files.kick.com/emotes/39000/fullsize');
  assert.strictEqual(u.badges.length, 2);
  assert.strictEqual(u.badges[0].type, 'moderator');
  assert.strictEqual(u.badges[0].text, 'Moderator');
  ok('toUnifiedKick: full chat message (color, emotes, badges with text)');
}
{
  // Minimal/anon message must not throw
  const u = toUnifiedKick({ id: 'x', content: 'hi', sender: {} });
  assert.strictEqual(u.displayName, 'anon');
  assert.deepStrictEqual(u.emotes, {});
  ok('toUnifiedKick: minimal message → safe defaults');
}

// ---- alerts (channel events) --------------------------------------
{
  const a = toUnifiedKickAlert('SubscriptionEvent', { username: 'Ayla', months: 3 });
  assert.strictEqual(a.type, 'sub'); assert.strictEqual(a.name, 'Ayla'); assert.strictEqual(a.amount, 3);
  ok('toUnifiedKickAlert: SubscriptionEvent → sub');
}
{
  const a = toUnifiedKickAlert('GiftedSubscriptionsEvent', { gifter_username: 'Boss', gifted_usernames: ['x', 'y', 'z'], gifted_amount: 3 });
  assert.strictEqual(a.type, 'communitygift'); assert.strictEqual(a.sender, 'Boss'); assert.strictEqual(a.count, 3);
  ok('toUnifiedKickAlert: GiftedSubscriptionsEvent (multi) → communitygift');
}
{
  const a = toUnifiedKickAlert('GiftedSubscriptionsEvent', { gifter_username: 'Boss', gifted_usernames: ['solo'], gifted_amount: 1 });
  assert.strictEqual(a.type, 'gift'); assert.strictEqual(a.name, 'solo');
  ok('toUnifiedKickAlert: GiftedSubscriptionsEvent (single) → gift');
}
{
  const a = toUnifiedKickAlert('StreamHostEvent', { host_username: 'Raider', number_viewers: 120 });
  assert.strictEqual(a.type, 'host'); assert.strictEqual(a.amount, 120);
  ok('toUnifiedKickAlert: StreamHostEvent → host');
}
{
  assert.strictEqual(toUnifiedKickAlert('SomeUnknownEvent', {}), null);
  assert.strictEqual(toUnifiedKickAlert('ChatMessageEvent', {}), null);
  ok('toUnifiedKickAlert: unknown event → null (ignored)');
}

// ---- relay security / lifecycle -------------------------------------
{
  assert.strictEqual(isAuthorizedSubscribe({ token: 'abc' }, ''), true);
  assert.strictEqual(isAuthorizedSubscribe({ token: 'abc' }, 'abc'), true);
  assert.strictEqual(isAuthorizedSubscribe({ token: 'wrong' }, 'abc'), false);
  assert.strictEqual(isAuthorizedSubscribe({}, 'abc'), false);
  ok('isAuthorizedSubscribe: optional shared token gates subscriptions');
}
{
  let closed = false;
  const client = { _rooms: new Set(['1']) };
  const rooms = new Map([['1', {
    ws: { close: () => { closed = true; } },
    subscribers: new Set([client])
  }]]);
  detachClientFromRooms(client, rooms);
  assert.strictEqual(closed, true, 'upstream Kick socket is closed when last subscriber leaves');
  assert.strictEqual(rooms.has('1'), false, 'empty room is removed immediately');
  ok('detachClientFromRooms: empty rooms close upstream socket and are deleted');
}

// ---- Kick official API: OAuth PKCE / auth-url / pending-state store -----
{
  const { verifier, challenge } = pkceChallenge();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, 'verifier length in spec range');
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.strictEqual(challenge, expected, 'challenge = base64url(sha256(verifier))');
  ok('pkceChallenge: verifier/challenge pair is spec-shaped and consistent');
}
{
  const url = createAuthorizeUrl({
    clientId: 'cid', redirectUri: 'https://x/callback', state: 's1', challenge: 'ch1',
  });
  const u = new URL(url);
  assert.strictEqual(u.origin, 'https://id.kick.com');
  assert.strictEqual(u.pathname, '/oauth/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'cid');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://x/callback');
  assert.strictEqual(u.searchParams.get('state'), 's1');
  assert.strictEqual(u.searchParams.get('code_challenge'), 'ch1');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  ok('createAuthorizeUrl: builds correct id.kick.com authorize URL');
}
{
  const store = createPendingAuthStore();
  store.put('s1', 'verifier1');
  assert.strictEqual(store.take('s1'), 'verifier1');
  assert.strictEqual(store.take('s1'), null, 'one-time use: second take() is null');
  assert.strictEqual(store.take('never-put'), null);
  ok('createPendingAuthStore: put/take is single-use');
}
{
  assert.strictEqual(isExpired(null), true);
  assert.strictEqual(isExpired({ obtained_at: Date.now(), expires_in: 3600 }), false);
  assert.strictEqual(isExpired({ obtained_at: Date.now() - 3600_000 * 2, expires_in: 3600 }), true);
  ok('isExpired: token freshness math');
}

// ---- Kick official API: webhook signature verification -------------------
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const messageId = '01HZZZTESTMESSAGEID000000';
  const timestamp = '2026-07-26T00:00:00Z';
  const rawBody = '{"hello":"world"}';
  const signed = `${messageId}.${timestamp}.${rawBody}`;
  const signatureB64 = crypto.sign('RSA-SHA256', Buffer.from(signed), privateKeyPem).toString('base64');

  assert.strictEqual(
    verifyKickSignature({ messageId, timestamp, rawBody, signatureB64, publicKeyPem }),
    true
  );
  assert.strictEqual(
    verifyKickSignature({ messageId, timestamp, rawBody: rawBody + 'tampered', signatureB64, publicKeyPem }),
    false
  );
  assert.strictEqual(
    verifyKickSignature({ messageId, timestamp, rawBody, signatureB64: 'bm90YXNpZ25hdHVyZQ==', publicKeyPem }),
    false
  );
  ok('verifyKickSignature: valid / tampered-body / bad-signature cases');
}

// ---- Kick official API: event normalization ------------------------------
{
  const a = normalizeFollow({ follower: { username: 'Ayla', user_id: 1 } });
  assert.deepStrictEqual(a, { type: 'follow', name: 'Ayla', userId: 1 });
  ok('normalizeFollow: channel.followed');
}
{
  const a = normalizeSubNew({ subscriber: { username: 'Bo' }, duration: 1, expires_at: '2026-08-26T00:00:00Z' });
  assert.strictEqual(a.type, 'sub');
  assert.strictEqual(a.name, 'Bo');
  assert.strictEqual(a.amount, 1);
  ok('normalizeSubNew: channel.subscription.new');
}
{
  const a = normalizeSubRenewal({ subscriber: { username: 'Bo' }, duration: 4 });
  assert.strictEqual(a.type, 'resub');
  assert.strictEqual(a.amount, 4);
  ok('normalizeSubRenewal: channel.subscription.renewal');
}
{
  const single = normalizeSubGifts({ gifter: { username: 'Boss' }, giftees: [{ username: 'x' }] });
  assert.strictEqual(single.type, 'gift');
  assert.strictEqual(single.name, 'x');
  assert.strictEqual(single.sender, 'Boss');
  const multi = normalizeSubGifts({ gifter: { username: 'Boss' }, giftees: [{ username: 'x' }, { username: 'y' }] });
  assert.strictEqual(multi.type, 'communitygift');
  assert.strictEqual(multi.count, 2);
  ok('normalizeSubGifts: channel.subscription.gifts (single + community)');
}
{
  const a = normalizeKicksGifted({
    sender: { username: 'Fan' },
    gift: { amount: 500, name: 'Kicks', tier: '', message: 'gg' },
  });
  assert.strictEqual(a.type, 'kicks');
  assert.strictEqual(a.amount, 500);
  assert.strictEqual(a.message, 'gg');
  ok('normalizeKicksGifted: kicks.gifted');
}
{
  assert.strictEqual(normalizeKickEvent('channel.followed', { follower: { username: 'X' } }).type, 'follow');
  assert.strictEqual(normalizeKickEvent('unknown.event', {}), null);
  ok('normalizeKickEvent: dispatches by event type, unknown → null');
}

console.log(`\n${n} assertions passed.`);

// Guard against regressions of the "test hangs" bug: requiring index.js must
// not leave open handles (servers/timers). If anything keeps the loop alive,
// fail loudly instead of hanging.
const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
const reqs = (process._getActiveRequests && process._getActiveRequests()) || [];
// stdout/stdin/tty handles are expected; anything socket/timer-like is not.
const leaked = handles.filter(h => {
  const t = h && h.constructor && h.constructor.name;
  return t && !/WriteStream|ReadStream|TTY|Socket$/.test(t) === false ? false : /Server|Timer|Timeout/i.test(t || '');
});
if (leaked.length || reqs.length) {
  console.error(`✗ open handles after tests: ${leaked.map(h => h.constructor.name).join(', ')} (require should open none)`);
  process.exit(1);
}
console.log('No open handles — process exits cleanly.');
