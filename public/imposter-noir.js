/**
 * imposter-noir.js — Imposter's "after hours at the precinct" look.
 *
 *   • Fingerprints — every player gets a fingerprint drawn from their name,
 *                    so the same name always leaves the same print. Used in
 *                    the lobby, on clues, in the vote lineup and the reveal.
 *   • The office   — night sky, a city skyline, a hanging lamp and rain on
 *                    the glass behind every Imposter screen (body.imp-noir).
 *   • Stamps       — CONFIDENTIAL / IMPOSTER / CASE CLOSED, in plain CSS.
 *   • Sound        — typewriter keys, a rubber stamp, paper and a short sting,
 *                    synthesised with WebAudio. No audio files to license.
 *
 * All art is original SVG/CSS drawn for this app. Purely presentational: the
 * server still decides everything.
 */
(function () {
  'use strict';

  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str).toLowerCase().trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ── Fingerprints ───────────────────────────────────────────────────────
  // Bright inks, all readable on the dark office and distinct from each other.
  const INKS = ['#ff7a6b', '#5ec8ff', '#ffc94d', '#8ef08a', '#d79bff', '#ff9fd0', '#7ff0e0', '#ffa25c'];
  const TIP = 'M20 2 C31 2 37 11 37 24 C37 37 30 46 20 46 C10 46 3 37 3 24 C3 11 9 2 20 2 Z';

  function ink(name) { return INKS[hash(name) % INKS.length]; }

  let clipSeq = 0;
  function fingerprint(name, cls = '') {
    const h = hash(name);
    const colour = INKS[h % INKS.length];
    const kind = (h >>> 3) % 3;                       // whorl, loop, arch
    const cx = 20 + (((h >>> 6) % 7) - 3);
    const cy = 23 + (((h >>> 9) % 7) - 3);
    const tilt = (((h >>> 12) % 41) - 20);
    let ridges = '';
    if (kind === 0) {
      // Whorl: rings, each broken once where the ridge splits.
      for (let i = 0, r = 2.6; r < 24; i++, r += 2.7) {
        const circ = 2 * Math.PI * r * 1.15;
        const gap = 2 + ((h >>> (i % 24)) % 5);
        const off = ((h >>> ((i * 5) % 27)) % 100) / 100 * circ;
        ridges += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${(r * 1.3).toFixed(2)}" stroke-dasharray="${(circ - gap).toFixed(1)} ${gap}" stroke-dashoffset="${off.toFixed(1)}"/>`;
      }
    } else if (kind === 1) {
      // Loop: nested U shapes opening downwards.
      for (let i = 0, r = 2.2; r < 22; i++, r += 2.7) {
        ridges += `<path d="M${cx - r} 52 V${cy} A${r} ${r * 1.15} 0 0 1 ${cx + r} ${cy} V52"/>`;
      }
      ridges += `<path d="M-2 ${cy + 26} Q20 ${cy + 14} 42 ${cy + 26}"/>`;
    } else {
      // Arch: ridges flowing side to side, rising in the middle.
      for (let i = 0, y = 4; y < 54; i++, y += 2.8) {
        const lift = Math.max(0, 9 - Math.abs(y - cy) * 0.35);
        ridges += `<path d="M-2 ${y + 2} Q${cx} ${(y - lift).toFixed(1)} 42 ${y + 2}"/>`;
      }
    }
    const id = `inf${++clipSeq}`;
    return `<svg class="imp-print ${cls}" viewBox="0 0 40 48" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="${TIP}"/></clipPath></defs>
      <g clip-path="url(#${id})" fill="none" stroke="${colour}" stroke-width="1.35" stroke-linecap="round">
        <g transform="rotate(${tilt} 20 24)">${ridges}</g>
      </g>
    </svg>`;
  }

  // A plain head-and-shoulders figure for the lineup, tinted with the
  // player's ink so the print and the suspect match.
  function suspect(name) {
    const c = ink(name);
    return `<svg class="imp-suspect" viewBox="0 0 60 64" aria-hidden="true">
      <circle cx="30" cy="22" r="12" fill="${c}"/>
      <path d="M6 64 C6 46 16 38 30 38 C44 38 54 46 54 64 Z" fill="${c}"/>
    </svg>`;
  }

  function stamp(text, cls = '') {
    return `<div class="imp-stamp ${cls}"><span>${text}</span></div>`;
  }

  // ── Sound ──────────────────────────────────────────────────────────────
  const Sound = (function () {
    let ctx = null;
    let on = true;
    try { on = localStorage.getItem('imp-sound') !== 'off'; } catch { /* storage blocked */ }
    function ac() {
      if (!on) return null;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch { return null; }
    }
    function env(g, t, a, v, len) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    }
    function noise(c, t, len, type, freq, vol) {
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource(); s.buffer = buf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); env(g, t, 0.003, vol, len);
      s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
    }
    function tone(c, type, freq, t, len, vol, cutoff = 3000) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = c.createGain(); env(g, t, 0.01, vol, len);
      o.connect(f); f.connect(g); g.connect(c.destination); o.start(t); o.stop(t + len + 0.1);
    }
    // A soft vibraphone voice for the jazz stings.
    function vibe(c, freq, t, len, vol) {
      tone(c, 'sine', freq, t, len, vol);
      tone(c, 'sine', freq * 4, t, len * 0.3, vol * 0.15);
    }
    const play = {
      // A few typewriter strikes and the carriage bell.
      type() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01;
        [0, .07, .13, .22].forEach(d => { noise(c, t + d, .035, 'bandpass', 1800 + Math.random() * 900, .5); noise(c, t + d, .05, 'lowpass', 260, .35); });
        tone(c, 'sine', 2350, t + .32, .5, .06); },
      // Rubber stamp hitting a desk.
      stamp() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01;
        tone(c, 'sine', 95, t, .22, .5, 400); noise(c, t, .09, 'lowpass', 900, .55); noise(c, t + .01, .03, 'highpass', 3000, .15); },
      // A folder flipped open.
      paper() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01;
        noise(c, t, .16, 'bandpass', 3200, .22); noise(c, t + .1, .1, 'highpass', 5000, .1); },
      // Case closed, the good guys got them: a bright jazz chord rolled upward.
      solved() { const c = ac(); if (!c) return; const t = c.currentTime + 0.05;
        [261.6, 329.6, 392, 493.9, 587.3].forEach((f, i) => vibe(c, f, t + i * .09, 1.8, .09)); },
      // The liar got away: a low walking bass that sinks.
      escaped() { const c = ac(); if (!c) return; const t = c.currentTime + 0.05;
        [[146.8, 0], [138.6, .32], [130.8, .64], [98, .98]].forEach(([f, d], i) => tone(c, 'triangle', f, t + d, i === 3 ? 1.4 : .34, .22, 900));
        vibe(c, 311.1, t + .98, 1.6, .06); },
      // Someone's name came up: a single low note.
      knock() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01; noise(c, t, .08, 'lowpass', 500, .5); noise(c, t + .16, .08, 'lowpass', 500, .45); },
    };
    return {
      play(name) { try { play[name]?.(); } catch { /* audio is never worth a crash */ } },
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem('imp-sound', on ? 'on' : 'off'); } catch { /* ignore */ }
        if (on) play.type();
        return on;
      },
    };
  })();

  // ── The office behind every Imposter screen ────────────────────────────
  function skyline() {
    // Fixed buildings (not random) so the city is the same on every phone.
    const blocks = [[0, 300, 22], [20, 270, 18], [36, 318, 14], [48, 252, 20], [66, 292, 16], [80, 236, 24],
      [102, 280, 14], [114, 262, 22], [134, 300, 18], [150, 244, 20], [168, 286, 16], [182, 266, 20]];
    let out = '', lit = '';
    blocks.forEach(([x, y, w], b) => {
      out += `<rect x="${x}" y="${y}" width="${w}" height="${400 - y}" fill="#06080c"/>`;
      for (let wy = y + 6; wy < 392; wy += 9) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) {
          if (hash(`${b}:${wx}:${wy}`) % 9 === 0) lit += `<rect x="${wx}" y="${wy}" width="2" height="3" fill="#ffcf73" opacity=".7"/>`;
        }
      }
    });
    return out + lit;
  }

  function buildScene() {
    if (document.getElementById('imp-noir-scene')) return;
    const scene = document.createElement('div');
    scene.id = 'imp-noir-scene';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML = `
      <svg class="imp-noir-art" viewBox="0 0 200 400" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="impSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#070a10"/><stop offset=".55" stop-color="#101a2a"/><stop offset="1" stop-color="#1c2236"/>
          </linearGradient>
        </defs>
        <rect width="200" height="400" fill="url(#impSky)"/>
        <g opacity=".95">${skyline()}</g>
        <!-- Window frame: the city is seen through the office glass -->
        <path d="M0 0 H200 V400 H0 Z M8 8 V392 H192 V8 Z" fill="#05070a" fill-rule="evenodd"/>
        <path d="M100 8 V392 M8 200 H192" stroke="#05070a" stroke-width="5"/>
      </svg>
      <div class="imp-blinds"></div>
      <canvas id="imp-rain"></canvas>
      <div class="imp-lamp-glow"></div>
      <div class="imp-noir-shade"></div>`;
    document.body.prepend(scene);
    startRain(scene.querySelector('#imp-rain'));
  }

  function startRain(canvas) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !canvas.getContext) return;
    const g = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1;
    const drops = [];
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.width = Math.round(innerWidth * dpr);
      h = canvas.height = Math.round(innerHeight * dpr);
    }
    size(); addEventListener('resize', size);
    function spawn(initial) {
      return { x: Math.random() * w * 1.1, y: initial ? Math.random() * h : -20 * dpr,
        v: (7 + Math.random() * 6) * dpr, len: (10 + Math.random() * 14) * dpr, a: .12 + Math.random() * .22 };
    }
    for (let i = 0; i < 70; i++) drops.push(spawn(true));
    let last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (!document.body.classList.contains('imp-noir') || document.hidden || t - last < 33) return;
      last = t;
      g.clearRect(0, 0, w, h);
      g.lineWidth = 1 * dpr; g.strokeStyle = '#9fb8d8';
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.y += d.v; d.x -= d.v * 0.18;
        if (d.y > h + 20) { drops[i] = spawn(false); continue; }
        g.globalAlpha = d.a;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x + d.len * 0.18, d.y - d.len); g.stroke();
      }
      g.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  // Follow whichever screen is active, like round-table.js does for Avalon.
  function syncBodyClass() {
    const active = document.querySelector('.screen.active');
    const on = !!active && active.id.startsWith('screen-imp-');
    document.body.classList.toggle('imp-noir', on);
    document.documentElement.classList.toggle('imp-noir', on);
  }

  function init() {
    buildScene();
    syncBodyClass();
    const mo = new MutationObserver(syncBodyClass);
    document.querySelectorAll('.screen').forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['class'] }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ImpNoir = { fingerprint, suspect, stamp, ink, sound: Sound };
})();
