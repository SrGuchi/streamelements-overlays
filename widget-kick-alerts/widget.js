/* ================================================================
   StreamElements · Kick Alerts (Official)
   ----------------------------------------------------------------
   Connects to the same Railway relay used by the chat overlay
   (see /Users/.../relay/src/index.js), but on a separate WS channel:
     { type:'subscribe', platform:'kick-alerts', token? }
   The relay pushes official Kick webhook events (follow/sub/resub/
   gift/community-gift/Kicks-tip), already verified + normalized, as
     { type:'kick-alert', payload:{ type, name, sender?, amount?, count? } }

   This widget plays a per-event-type video + sound with a message
   overlay, holding each alert on screen for at least its configured
   duration (and never cutting a video short), then advances a FIFO
   queue so back-to-back events don't clash.
   ================================================================ */
(function () {
  'use strict';

  let F = {};
  let relaySocket = null;
  let relayRetry = 0;
  const queue = [];
  let playing = false;

  window.addEventListener('onWidgetLoad', function (obj) {
    F = (obj.detail && obj.detail.fieldData) || {};
    applyAnimationClasses();
    connectRelay();
  });

  window.addEventListener('onEventReceived', function (obj) {
    const d = obj.detail || {};
    if (d.listener !== 'widget-button') return;
    const field = (d.event && d.event.field) || '';
    const sample = {
      testFollow: { type: 'follow', name: 'TestUser' },
      testSub: { type: 'sub', name: 'TestUser', amount: 1 },
      testGift: { type: 'communitygift', sender: 'TestUser', count: 5, name: 'Lucky' },
      testKicks: { type: 'kicks', name: 'TestUser', amount: 500 },
    }[field];
    if (sample) enqueue(sample);
  });

  // ---------------------------------------------------------------
  //  Relay WebSocket (same reconnect-with-backoff pattern as the
  //  chat widget's connectRelay()).
  // ---------------------------------------------------------------
  function connectRelay() {
    const url = (F.relayUrl || '').trim();
    if (!url || !/^wss?:\/\//.test(url)) return;
    if (relaySocket) {
      try { relaySocket.onclose = null; relaySocket.close(); } catch (_) {}
      relaySocket = null;
    }
    try {
      relaySocket = new WebSocket(url);
    } catch (_) {
      scheduleReconnect();
      return;
    }
    relaySocket.onopen = () => {
      relayRetry = 0;
      const msg = { type: 'subscribe', platform: 'kick-alerts' };
      if (F.relayToken) msg.token = F.relayToken;
      try { relaySocket.send(JSON.stringify(msg)); } catch (_) {}
    };
    relaySocket.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (!m) return;
      if (m.type === 'kick-alert' && m.payload) {
        enqueue(m.payload);
      } else if (m.type === 'error') {
        if (yes(F.debugMode)) console.warn('[kick-alerts] relay error:', m.error);
      } else if (m.type === 'subscribed') {
        if (yes(F.debugMode)) console.log('[kick-alerts] subscribed to relay');
      }
    };
    relaySocket.onclose = scheduleReconnect;
    relaySocket.onerror = () => { try { relaySocket.close(); } catch (_) {} };
  }

  function scheduleReconnect() {
    relayRetry = Math.min(relayRetry + 1, 8);
    const base = Math.min(1000 * Math.pow(2, relayRetry), 30000);
    setTimeout(connectRelay, base + Math.random() * base * 0.3);
  }

  function yes(v) { return String(v) === 'yes'; }

  // ---------------------------------------------------------------
  //  Event-type → field config lookup.
  // ---------------------------------------------------------------
  function configFor(type) {
    const map = {
      follow: {
        enabled: F.enableFollow, video: F.videoFollow, sound: F.soundFollow,
        label: F.labelFollow, duration: F.durationFollow,
      },
      sub: {
        enabled: F.enableSub, video: F.videoSub, sound: F.soundSub,
        label: F.labelSub, duration: F.durationSub,
      },
      resub: {
        enabled: F.enableSub, video: F.videoSub, sound: F.soundSub,
        label: F.labelResub, duration: F.durationSub,
      },
      gift: {
        enabled: F.enableGift, video: F.videoGift, sound: F.soundGift,
        label: F.labelGift, duration: F.durationGift,
      },
      communitygift: {
        enabled: F.enableGift, video: F.videoCommunityGift || F.videoGift, sound: F.soundGift,
        label: F.labelCommunityGift, duration: F.durationGift,
      },
      kicks: {
        enabled: F.enableKicks, video: F.videoKicks, sound: F.soundKicks,
        label: F.labelKicks, duration: F.durationKicks,
      },
    };
    return map[type] || null;
  }

  function fillTemplate(tmpl, p) {
    return String(tmpl || '')
      .replace(/{name}/g, p.name || '')
      .replace(/{sender}/g, p.sender || p.name || '')
      .replace(/{amount}/g, p.amount != null ? p.amount : '')
      .replace(/{count}/g, p.count != null ? p.count : '');
  }

  // ---------------------------------------------------------------
  //  Playback queue.
  // ---------------------------------------------------------------
  function enqueue(payload) {
    const cfg = configFor(payload && payload.type);
    if (!cfg || !yes(cfg.enabled)) return;
    queue.push({ payload, cfg });
    if (!playing) playNext();
  }

  function playNext() {
    const item = queue.shift();
    if (!item) { playing = false; return; }
    playing = true;

    const { payload, cfg } = item;
    const box = document.getElementById('kaBox');
    const video = document.getElementById('kaVideo');
    const text = document.getElementById('kaText');
    text.textContent = fillTemplate(cfg.label, payload);

    const vol = Math.max(0, Math.min(1, Number(F.globalVolume != null ? F.globalVolume : 80) / 100));
    const holdMs = Math.max(1000, Number(cfg.duration || 6) * 1000);
    let videoDone = false;
    let timerDone = false;

    function finishOnce() {
      if (!videoDone || !timerDone) return;
      box.classList.remove('is-active');
      setTimeout(playNext, Number(F.queueGapMs != null ? F.queueGapMs : 300));
    }

    if (cfg.video) {
      video.src = cfg.video;
      video.muted = false;
      video.volume = vol;
      video.onended = () => { videoDone = true; finishOnce(); };
      video.play().catch(() => { videoDone = true; finishOnce(); });
    } else {
      video.removeAttribute('src');
      videoDone = true;
    }

    if (cfg.sound) {
      try {
        const a = new Audio(cfg.sound);
        a.volume = vol;
        a.play().catch(() => {});
      } catch (_) {}
    }

    box.classList.add('is-active');
    setTimeout(() => { timerDone = true; finishOnce(); }, holdMs);
  }

  function applyAnimationClasses() {
    const box = document.getElementById('kaBox');
    if (!box) return;
    box.classList.remove('anim-fadeIn', 'anim-fadeOut', 'anim-scaleIn', 'anim-scaleOut');
    const inAnim = F.animationIn || 'fadeIn';
    const outAnim = F.animationOut || 'fadeOut';
    if (inAnim !== 'none') box.classList.add('anim-' + inAnim);
    if (outAnim !== 'none') box.classList.add('anim-' + outAnim);
  }

  // Test hook, mirrors the chat widget's __seChat convention — lets
  // relay/widget tests drive the queue without opening a real socket.
  window.__kickAlerts = {
    setFields: (f) => { F = Object.assign({}, F, f); applyAnimationClasses(); },
    enqueue,
    getFields: () => F,
  };
})();
