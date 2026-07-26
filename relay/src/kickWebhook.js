/* ================================================================
   Kick official API — webhook signature verification + event
   normalization.
   ----------------------------------------------------------------
   Kick signs every webhook POST: RSA-SHA256 over
     "{Kick-Event-Message-Id}.{Kick-Event-Message-Timestamp}.{raw body}"
   verified against Kick's public key (fetched once, cached).
   See https://docs.kick.com/events/webhook-security

   The normalize* functions map each event's payload shape to a
   small unified alert object the widget understands — same idea as
   the existing toUnifiedKick()/toUnifiedKickAlert() in index.js,
   but for the *official* API's payload shapes, which are distinct
   from the unofficial Pusher ones.
   ================================================================ */
'use strict';

const crypto = require('crypto');

const KICK_PUBLIC_KEY_URL = 'https://api.kick.com/public/v1/public-key';
const KEY_CACHE_MS = 60 * 60 * 1000;

let _cachedKey = null; // { pem, fetchedAt }

async function getPublicKey() {
  if (_cachedKey && Date.now() - _cachedKey.fetchedAt < KEY_CACHE_MS) return _cachedKey.pem;
  const res = await fetch(KICK_PUBLIC_KEY_URL);
  const json = await res.json().catch(() => null);
  const pem = json && json.data && json.data.public_key;
  if (!pem) throw new Error('kick public key fetch failed');
  _cachedKey = { pem, fetchedAt: Date.now() };
  return pem;
}

// Test-only hook so unit tests don't have to wait out the 1h cache.
function _clearPublicKeyCache() { _cachedKey = null; }

// Pure — testable against a locally generated RSA keypair (see relay/test.cjs).
function verifyKickSignature({ messageId, timestamp, rawBody, signatureB64, publicKeyPem }) {
  try {
    const signed = `${messageId}.${timestamp}.${rawBody}`;
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(signed, 'utf8'),
      publicKeyPem,
      Buffer.from(signatureB64, 'base64')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------
//  Event normalization — all pure, one per Kick webhook event type.
// ---------------------------------------------------------------
function normalizeFollow(data) {
  const follower = (data && data.follower) || {};
  return { type: 'follow', name: follower.username || 'Someone', userId: follower.user_id };
}

function normalizeSubNew(data) {
  const subscriber = (data && data.subscriber) || {};
  return {
    type: 'sub',
    name: subscriber.username || 'Someone',
    amount: (data && data.duration) || 1,
    expiresAt: data && data.expires_at,
  };
}

function normalizeSubRenewal(data) {
  const subscriber = (data && data.subscriber) || {};
  return {
    type: 'resub',
    name: subscriber.username || 'Someone',
    amount: (data && data.duration) || 1,
    expiresAt: data && data.expires_at,
  };
}

function normalizeSubGifts(data) {
  const gifter = (data && data.gifter) || {};
  const giftees = (data && data.giftees) || [];
  const names = giftees.map((g) => g && g.username).filter(Boolean);
  const count = names.length || 1;
  return {
    type: count > 1 ? 'communitygift' : 'gift',
    sender: gifter.username || 'Someone',
    name: names[0] || '',
    count,
    giftees: names,
  };
}

function normalizeKicksGifted(data) {
  const sender = (data && data.sender) || {};
  const gift = (data && data.gift) || {};
  return {
    type: 'kicks',
    name: sender.username || 'Someone',
    amount: gift.amount || 0,
    giftName: gift.name || '',
    tier: gift.tier || '',
    message: gift.message || '',
  };
}

// Dispatch by Kick's event-type string (see the Kick-Event-Type header
// handling in index.js). Returns null for anything we don't recognise —
// callers should silently drop those rather than broadcast garbage.
function normalizeKickEvent(eventType, data) {
  switch (eventType) {
    case 'channel.followed': return normalizeFollow(data);
    case 'channel.subscription.new': return normalizeSubNew(data);
    case 'channel.subscription.renewal': return normalizeSubRenewal(data);
    case 'channel.subscription.gifts': return normalizeSubGifts(data);
    case 'kicks.gifted': return normalizeKicksGifted(data);
    default: return null;
  }
}

module.exports = {
  KICK_PUBLIC_KEY_URL,
  getPublicKey,
  _clearPublicKeyCache,
  verifyKickSignature,
  normalizeFollow,
  normalizeSubNew,
  normalizeSubRenewal,
  normalizeSubGifts,
  normalizeKicksGifted,
  normalizeKickEvent,
};
