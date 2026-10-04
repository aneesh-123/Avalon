/**
 * round-table.js — Avalon's "you are in the hall" layer.
 *
 *   • Heraldry   — every player gets a coat of arms drawn from their name, so
 *                  the same name always carries the same shield.
 *   • The table  — renderRoundTable() seats the players around a carved round
 *                  table. client.js uses it for picking a team, voting, the
 *                  quest and the assassination; seats are `.pick-player` rows
 *                  inside `#player-pick-list`, so the existing tap handling
 *                  works unchanged.
 *   • The hall   — stone, a moonlit window, banners, torchlight and drifting
 *                  embers behind every Avalon screen (body.rt-avalon).
 *   • Sound      — horns, a bell, a breaking seal and a blade, synthesised with
 *                  WebAudio. No audio files, so nothing to license.
 *
 * All art here is original SVG drawn for this app. Nothing is taken from the
 * board game. Purely presentational: the server still decides everything.
 */
(function () {
  'use strict';

  // ── Heraldry ────────────────────────────────────────────────────────────
  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str).toLowerCase().trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Heraldry's rule of tincture: a metal sits on a colour, never metal on metal.
  const METALS  = ['#d9b45a', '#e8e2d0'];                                // or, argent
  const COLOURS = ['#9b1f1f', '#1f4b97', '#2d6a3a', '#5d2d73', '#221d1d']; // gules, azure, vert, purpure, sable

  const SHIELD = 'M3 3 H37 V20 C37 33 30 41 20 45.5 C10 41 3 33 3 20 Z';

  // Ordinaries / divisions, drawn in the second tincture over the field.
  const DIVISIONS = [
    () => '',                                                         // plain
    t => `<rect x="20" y="0" width="20" height="48" fill="${t}"/>`,   // per pale
    t => `<rect x="0" y="23" width="40" height="25" fill="${t}"/>`,   // per fess
    t => `<path d="M0 0 L40 48 L0 48 Z" fill="${t}"/>`,                // per bend
    t => `<rect x="20" y="0" width="20" height="23" fill="${t}"/><rect x="0" y="23" width="20" height="25" fill="${t}"/>`, // quarterly
    t => `<rect x="0" y="0" width="40" height="13" fill="${t}"/>`,    // chief
    t => `<path d="M0 34 L20 18 L40 34 L40 44 L20 28 L0 44 Z" fill="${t}"/>`, // chevron
    t => `<rect x="14" y="0" width="12" height="48" fill="${t}"/>`,   // pale
    t => `<path d="M-2 6 L6 -2 L42 40 L34 48 Z" fill="${t}"/>`,        // bend
    t => `<path d="M-2 4 L4 -2 L42 42 L36 48 Z M42 4 L36 -2 L-2 42 L4 48 Z" fill="${t}"/>`, // saltire
  ];

  // Charges, centred on (20, 23). Edged in the field's tincture (fimbriated) so
  // they still read where they cross a division of their own colour.
  const CHARGES = [
    c => `<polygon points="20,13 22.4,20 29.5,20 23.8,24.3 26,31.3 20,27 14,31.3 16.2,24.3 10.5,20 17.6,20" fill="${c}"/>`, // mullet
    c => `<path d="M17.5 13 h5 v7.5 h7.5 v5 h-7.5 v7.5 h-5 v-7.5 h-7.5 v-5 h7.5 Z" fill="${c}"/>`,                      // cross
    c => `<path d="M26 15 A9 9 0 1 0 26 31 A7 7 0 1 1 26 15 Z" fill="${c}"/>`,                                           // crescent
    c => `<path d="M20 12 L28 23 L20 34 L12 23 Z" fill="${c}"/>`,                                                        // lozenge
    c => `<circle cx="20" cy="23" r="7.5" fill="${c}"/>`,                                                               // roundel
    c => `<path d="M13 32 V18 h2.6 v2.6 h2.6 V18 h3.6 v2.6 h2.6 V18 H27 V32 Z M18.4 32 v-5 a1.6 1.6 0 0 1 3.2 0 v5 Z" fill="${c}"/>`, // tower
    c => `<path d="M12 30 L12 18 L16 23 L20 15 L24 23 L28 18 L28 30 Z" fill="${c}"/>`,                                   // crown
    c => `<path d="M19 11 h2 v15 h4 v2 h-4 v5 h-2 v-5 h-4 v-2 h4 Z" fill="${c}"/>`,                                       // sword
    c => `<path d="M14 14 h12 l-2 7 a4 4 0 0 1 -3 3 v5 h3 v2 h-8 v-2 h3 v-5 a4 4 0 0 1 -3 -3 Z" fill="${c}"/>`,             // chalice
    c => `<path d="M20 12 C23 16 27 16 27 21 C27 26 22 25 20 33 C18 25 13 26 13 21 C13 16 17 16 20 12 Z" fill="${c}"/>`,   // flame
  ];

  let clipSeq = 0;
  function heraldry(name, cls = '') {
    const h = hash(name);
    const metal  = METALS[h % 2];
    const colour = COLOURS[(h >>> 1) % COLOURS.length];
    const swap   = (h >>> 4) & 1;                       // which tincture is the field
    const field  = swap ? metal : colour;
    const other  = swap ? colour : metal;
    const div    = DIVISIONS[(h >>> 5) % DIVISIONS.length](other);
    // The charge always takes a metal, or a colour on a metal field.
    const chargeFill = swap ? colour : metal;
    const charge = CHARGES[(h >>> 9) % CHARGES.length](chargeFill);
    const id = `rtc${++clipSeq}`;
    return `<svg class="rt-arms ${cls}" viewBox="0 0 40 48" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="${SHIELD}"/></clipPath>
        <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>
      <g clip-path="url(#${id})">
        <rect width="40" height="48" fill="${field}"/>${div}
        <g stroke="${field}" stroke-width="2.2" paint-order="stroke" stroke-linejoin="round">${charge}</g>
        <rect width="40" height="48" fill="url(#${id}g)"/>
      </g>
      <path d="${SHIELD}" fill="none" stroke="#c9a96e" stroke-width="1.6"/>
    </svg>`;
  }

  // ── Small icons ─────────────────────────────────────────────────────────
  const ICON = {
    crown: `<svg viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 L2 4 L7 9 L12 1 L17 9 L22 4 L22 14 Z" fill="#e6c36a" stroke="#6b4d17" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="10" r="1.6" fill="#9b1f1f"/></svg>`,
    sword: `<svg viewBox="0 0 12 32" aria-hidden="true"><path d="M5 1 L7 1 L7 21 L5 21 Z" fill="#dfe3ea" stroke="#5b6270" stroke-width=".6"/><path d="M1 21 h10 v2 h-10 Z" fill="#c9a96e"/><path d="M5 23 h2 v6 h-2 Z" fill="#6b4422"/><circle cx="6" cy="30.5" r="1.6" fill="#c9a96e"/></svg>`,
    dagger: `<svg viewBox="0 0 12 32" aria-hidden="true" class="rt-dagger"><path d="M6 1 L8 18 L4 18 Z" fill="#c7ccd6" stroke="#4a4f5a" stroke-width=".6"/><path d="M1 18 h10 v2 h-10 Z" fill="#7a1a1a"/><path d="M5 20 h2 v7 h-2 Z" fill="#2a1a10"/><circle cx="6" cy="28.5" r="1.6" fill="#7a1a1a"/></svg>`,
    chalice: `<svg viewBox="0 0 40 46" aria-hidden="true"><path d="M8 4 h24 l-3 13 a9 9 0 0 1 -6 6 v10 h6 v4 h-18 v-4 h6 v-10 a9 9 0 0 1 -6 -6 Z" fill="#e2bf62" stroke="#6b4d17" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 8 h18" stroke="#fff3c4" stroke-width="1.2" opacity=".7"/><circle cx="20" cy="15" r="2.4" fill="#2a5aa8"/></svg>`,
    lady: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="#1d4e63" stroke="#8fd3e8" stroke-width="1.2"/><path d="M4 11 q3 -3 6 0 t6 0" fill="none" stroke="#bfeaf5" stroke-width="1.4"/></svg>`,
  };

  // ── The Round Table ─────────────────────────────────────────────────────
  // opts:
  //   players   [{id, name}] in seat order
  //   meId      this phone's player (seated at the bottom of the table)
  //   leaderId  gets the crown
  //   ladyId    holds the Lady of the Lake
  //   team      ids riding on the proposed quest (a sword before their seat)
  //   selected  ids currently picked by the leader
  //   marks     {id: 'voted'|'approve'|'reject'|'ready'|'played'}
  //   empty     number of empty chairs still to fill (lobby)
  //   pick      true → seats are tappable `.pick-player` rows
  //   dim       ids that cannot be picked
  //   center    HTML for the medallion in the middle
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderRoundTable(opts) {
    const players = opts.players || [];
    const empty   = opts.empty || 0;
    const total   = players.length + empty;
    const team    = new Set(opts.team || []);
    const sel     = new Set(opts.selected || []);
    const dim     = new Set(opts.dim || []);
    const marks   = opts.marks || {};
    if (!total) return '';

    // Rotate so this phone's own seat is at the bottom, nearest the player.
    const meIdx = Math.max(0, players.findIndex(p => p.id === opts.meId));
    const angleOf = i => Math.PI / 2 + ((i - meIdx) * 2 * Math.PI) / total; // 90° = bottom

    // Table wedges — one per chair, the riders' wedges gilded.
    const wedges = [];
    for (let i = 0; i < total; i++) {
      const a0 = angleOf(i) - Math.PI / total, a1 = angleOf(i) + Math.PI / total;
      const R = 39, r = 15;
      const p = (rad, a) => `${(50 + rad * Math.cos(a)).toFixed(2)} ${(50 + rad * Math.sin(a)).toFixed(2)}`;
      const pl = players[i];
      const cls = pl && (team.has(pl.id) || sel.has(pl.id)) ? 'rt-wedge on' : `rt-wedge ${i % 2 ? 'b' : 'a'}`;
      wedges.push(`<path class="${cls}" d="M${p(r, a0)} L${p(R, a0)} A${R} ${R} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 0 0 ${p(r, a0)} Z"/>`);
    }

    const seats = [];
    for (let i = 0; i < total; i++) {
      const a = angleOf(i);
      const x = (50 + 43 * Math.cos(a)).toFixed(2), y = (50 + 43 * Math.sin(a)).toFixed(2);
      const pl = players[i];
      if (!pl) {
        seats.push(`<div class="rt-seat rt-empty" style="left:${x}%;top:${y}%"><div class="rt-chair"></div><span class="rt-name">Empty seat</span></div>`);
        continue;
      }
      // Where the sword lies: on the table, in front of the chair.
      const sx = (50 + 30 * Math.cos(a)).toFixed(2), sy = (50 + 30 * Math.sin(a)).toFixed(2);
      const deg = (a * 180 / Math.PI + 90).toFixed(1);
      if (team.has(pl.id) || sel.has(pl.id)) {
        seats.push(`<div class="rt-blade" style="left:${sx}%;top:${sy}%;transform:translate(-50%,-50%) rotate(${deg}deg)">${ICON.sword}</div>`);
      }
      const mark = marks[pl.id];
      const cls = ['rt-seat',
        opts.pick && !dim.has(pl.id) ? 'pick-player' : '',
        sel.has(pl.id) ? 'selected' : '',
        team.has(pl.id) ? 'on-team' : '',
        pl.id === opts.meId ? 'is-me' : '',
        pl.id === opts.leaderId ? 'is-leader' : '',
        dim.has(pl.id) ? 'is-dim' : '',
        mark ? `mark-${mark}` : '',
      ].filter(Boolean).join(' ');
      const token = mark === 'approve' ? '<span class="rt-token approve">Aye</span>'
        : mark === 'reject' ? '<span class="rt-token reject">Nay</span>'
        : mark === 'voted' ? '<span class="rt-token voted" title="Voted">●</span>'
        : mark === 'ready' ? '<span class="rt-token ready">✓</span>'
        : '';
      seats.push(`<div class="${cls}" data-id="${esc(pl.id)}" style="left:${x}%;top:${y}%" ${opts.pick && !dim.has(pl.id) ? 'role="button" tabindex="0"' : ''}>
        ${pl.id === opts.leaderId ? `<span class="rt-crown">${ICON.crown}</span>` : ''}
        ${pl.id === opts.ladyId ? `<span class="rt-lady" title="Lady of the Lake">${ICON.lady}</span>` : ''}
        ${heraldry(pl.name)}
        ${token}
        <span class="pick-name rt-name">${esc(pl.id === opts.meId ? 'You' : pl.name)}</span>
      </div>`);
    }

    return `<div class="rt-table${total >= 9 ? ' rt-crowded' : ''}" ${opts.pick ? 'id="player-pick-list"' : ''}>
      <svg class="rt-board" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="rtWood" cx="50%" cy="45%" r="55%">
            <stop offset="0" stop-color="#6b4626"/><stop offset=".55" stop-color="#4a2e18"/><stop offset="1" stop-color="#2b190c"/>
          </radialGradient>
        </defs>
        <circle cx="50" cy="51.5" r="41" fill="#000" opacity=".55"/>
        <circle cx="50" cy="50" r="41" fill="url(#rtWood)" stroke="#1a0e05" stroke-width="1.2"/>
        <circle cx="50" cy="50" r="40" fill="none" stroke="#c9a96e" stroke-width=".35" opacity=".7"/>
        ${wedges.join('')}
        <circle cx="50" cy="50" r="39" fill="none" stroke="#c9a96e" stroke-width=".25" opacity=".55"/>
        <circle cx="50" cy="50" r="15" fill="#1a0f07" stroke="#c9a96e" stroke-width=".5"/>
        <circle cx="50" cy="50" r="13.4" fill="none" stroke="#c9a96e" stroke-width=".2" stroke-dasharray=".6 .8" opacity=".7"/>
      </svg>
      <div class="rt-center">${opts.center || ''}</div>
      ${seats.join('')}
    </div>`;
  }

  // Quest numbers read better as Roman numerals at a medieval table.
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const roman = n => ROMAN[n - 1] || String(n);

  // Five candles: each rejected proposal snuffs one. When all five are out,
  // Evil wins — the most important clock in the game, now one you can see.
  function candles(rejections) {
    let html = '';
    for (let i = 0; i < 5; i++) {
      const out = i >= 5 - rejections;
      html += `<span class="rt-candle${out ? ' out' : ''}"><span class="rt-flame"></span></span>`;
    }
    return `<div class="rt-candles" title="${rejections} of 5 proposals rejected in a row — at 5, Evil wins">${html}</div>`;
  }

  // ── Sound ───────────────────────────────────────────────────────────────
  // Synthesised on the fly. Browsers only allow audio after a tap, so the
  // context is created lazily and resumed on the first touch.
  const Sound = (() => {
    let ctx = null;
    let on = true;
    try { on = localStorage.getItem('rt-sound') !== 'off'; } catch { /* storage blocked */ }

    function ac() {
      if (!on) return null;
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        try { ctx = new C(); } catch { return null; }
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    document.addEventListener('pointerdown', () => { if (on) ac(); }, { once: true, capture: true });

    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }

    // A brass-ish voice: two detuned saws through a closing low-pass.
    function horn(c, freq, t, len, vol = 0.12) {
      const g = c.createGain(); env(g, t, 0.06, vol, len);
      const f = c.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(2200, t + 0.08); f.frequency.exponentialRampToValueAtTime(700, t + len);
      f.connect(g); g.connect(c.destination);
      [-6, 6].forEach(det => {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + len + 0.1);
      });
    }
    function noise(c, t, len, type, freq, vol) {
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource(); s.buffer = buf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); env(g, t, 0.004, vol, len);
      s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
    }
    function bellTone(c, freq, t, vol) {
      [[1, 1], [2.76, 0.45], [5.4, 0.2]].forEach(([m, v]) => {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
        const g = c.createGain(); env(g, t, 0.005, vol * v, 2.2 / m + 0.4);
        o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 3);
      });
    }

    const play = {
      // Rising call: the quest succeeded / Good wins.
      triumph() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02;
        [[262, 0, .22], [392, .2, .22], [523, .4, .3], [659, .66, .22], [784, .86, .9]].forEach(([f, d, l]) => horn(c, f, t + d, l)); },
      // Falling, slow and low: the quest failed / Evil wins.
      doom() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02;
        [[220, 0, .5], [175, .5, .5], [147, 1.0, 1.4]].forEach(([f, d, l]) => horn(c, f, t + d, l, 0.11)); },
      // Two short notes: a team was approved.
      aye() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02; horn(c, 392, t, .18, .09); horn(c, 523, t + .18, .45, .09); },
      // A dull knock: a team was rejected (a candle goes out).
      nay() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02; noise(c, t, .25, 'lowpass', 300, .5); horn(c, 147, t, .5, .06); },
      // The leader's bell.
      bell() { const c = ac(); if (!c) return; bellTone(c, 660, c.currentTime + 0.02, 0.18); },
      // Wax cracking.
      seal() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01; noise(c, t, .07, 'bandpass', 2200, .6); noise(c, t + .05, .12, 'lowpass', 500, .4); },
      // A card turned over.
      card() { const c = ac(); if (!c) return; noise(c, c.currentTime + 0.01, .06, 'highpass', 2500, .25); },
      // Steel.
      blade() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01; noise(c, t, .5, 'highpass', 4000, .35);
        [2100, 3150, 4400].forEach((f, i) => { const o = c.createOscillator(); o.frequency.value = f; const g = c.createGain(); env(g, t, .003, .05 / (i + 1), .7); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 1); }); },
    };

    return {
      play(name) { try { play[name]?.(); } catch { /* audio is never worth a crash */ } },
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem('rt-sound', on ? 'on' : 'off'); } catch { /* ignore */ }
        if (on) play.bell();
        return on;
      },
    };
  })();

  // ── The hall: backdrop + embers, only while an Avalon screen is up ──────
  const AVALON_SCREENS = new Set(['screen-home', 'screen-create', 'screen-join', 'screen-lobby',
    'screen-order-select', 'screen-placard', 'screen-game', 'screen-tutorial']);

  function banner(x, colour, chargeIdx) {
    const charge = CHARGES[chargeIdx]('#d9b45a');
    return `<g transform="translate(${x} 0)">
      <rect x="-1" y="0" width="2" height="6" fill="#3a2a14"/>
      <rect x="-13" y="5" width="26" height="2.4" rx="1" fill="#8a6a2e"/>
      <path d="M-11 7 H11 V62 L0 54 L-11 62 Z" fill="${colour}"/>
      <path d="M-11 7 H11 V62 L0 54 L-11 62 Z" fill="none" stroke="#c9a96e" stroke-width=".8" opacity=".8"/>
      <path d="M-8.5 7 V58.5 M8.5 7 V58.5" stroke="#c9a96e" stroke-width=".4" opacity=".5"/>
      <g transform="translate(-14 10) scale(.7)">${charge}</g>
    </g>`;
  }

  function buildHall() {
    if (document.getElementById('rt-hall')) return;
    const hall = document.createElement('div');
    hall.id = 'rt-hall';
    hall.setAttribute('aria-hidden', 'true');
    hall.innerHTML = `
      <svg class="rt-hall-art" viewBox="0 0 200 400" preserveAspectRatio="xMidYMin slice">
        <defs>
          <pattern id="rtStone" width="40" height="20" patternUnits="userSpaceOnUse">
            <rect width="40" height="20" fill="#15120e"/>
            <path d="M0 0.5 H40 M0 10.5 H40 M20 0 V10 M0 10 V20 M40 10 V20" stroke="#0a0806" stroke-width="1"/>
            <path d="M1 1.5 H19 M21 11.5 H39" stroke="#2a241b" stroke-width=".5" opacity=".6"/>
          </pattern>
          <radialGradient id="rtMoon" cx="50%" cy="40%" r="60%">
            <stop offset="0" stop-color="#9fb4d8" stop-opacity=".55"/><stop offset=".6" stop-color="#2a3a5c" stop-opacity=".35"/><stop offset="1" stop-color="#0b1020" stop-opacity=".9"/>
          </radialGradient>
          <radialGradient id="rtShaft" cx="50%" cy="0%" r="100%">
            <stop offset="0" stop-color="#9fb4d8" stop-opacity=".16"/><stop offset="1" stop-color="#9fb4d8" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="200" height="400" fill="url(#rtStone)"/>
        <!-- Moonlit window -->
        <path d="M70 120 V60 Q70 22 100 12 Q130 22 130 60 V120 Z" fill="#0a0806"/>
        <path d="M74 118 V61 Q74 27 100 17 Q126 27 126 61 V118 Z" fill="url(#rtMoon)"/>
        <circle cx="111" cy="48" r="9" fill="#dfe6f2" opacity=".55"/>
        <circle cx="114" cy="46" r="8.4" fill="#22304d" opacity=".75"/>
        <path d="M100 17 V118 M74 66 H126 M74 92 H126" stroke="#0a0806" stroke-width="2.4"/>
        <path d="M84 118 V64 Q84 40 100 30 Q116 40 116 64 V118" fill="none" stroke="#0a0806" stroke-width="1.4"/>
        <path d="M74 118 L40 400 H160 L126 118 Z" fill="url(#rtShaft)"/>
        <!-- Banners -->
        ${banner(26, '#6e1515', 6)}${banner(174, '#173a73', 7)}
        <!-- Torch sconces -->
        <g transform="translate(14 150)"><path d="M-3 0 h6 l-1 14 h-4 Z" fill="#3a2a14"/><path d="M-5 0 h10 v-2 h-10 Z" fill="#5a4220"/></g>
        <g transform="translate(186 150)"><path d="M-3 0 h6 l-1 14 h-4 Z" fill="#3a2a14"/><path d="M-5 0 h10 v-2 h-10 Z" fill="#5a4220"/></g>
      </svg>
      <div class="rt-torch l"><span></span></div>
      <div class="rt-torch r"><span></span></div>
      <canvas id="rt-embers"></canvas>
      <div class="rt-vignette"></div>`;
    document.body.prepend(hall);
    startEmbers(hall.querySelector('#rt-embers'));
  }

  function startEmbers(canvas) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !canvas.getContext) return;
    const g = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1;
    const sparks = [];
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.width = Math.round(innerWidth * dpr);
      h = canvas.height = Math.round(innerHeight * dpr);
    }
    size(); addEventListener('resize', size);
    function spawn(initial) {
      // Embers rise from the two torches, plus a few from the floor.
      const side = Math.random();
      const x = side < 0.35 ? w * 0.07 : side < 0.7 ? w * 0.93 : Math.random() * w;
      return { x: x + (Math.random() - 0.5) * 30 * dpr, y: initial ? Math.random() * h : (side < 0.7 ? h * 0.42 : h + 5),
        vx: (Math.random() - 0.5) * 0.25 * dpr, vy: -(0.25 + Math.random() * 0.55) * dpr,
        r: (0.6 + Math.random() * 1.3) * dpr, life: 0, max: 380 + Math.random() * 420, ph: Math.random() * 6.28 };
    }
    for (let i = 0; i < 26; i++) sparks.push(spawn(true));
    let last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (!document.body.classList.contains('rt-avalon') || document.hidden || t - last < 33) return;
      last = t;
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i];
        s.life++; s.ph += 0.03;
        s.x += s.vx + Math.sin(s.ph) * 0.18 * dpr; s.y += s.vy;
        const k = 1 - s.life / s.max;
        if (k <= 0 || s.y < -10) { sparks[i] = spawn(false); continue; }
        g.globalAlpha = Math.max(0, k) * 0.75;
        g.fillStyle = k > 0.5 ? '#ffcf7a' : '#ff8a3d';
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  // Follow whichever screen is active, without every game's own showScreen
  // having to know about the theme.
  function syncBodyClass() {
    const active = document.querySelector('.screen.active');
    const on = !!active && AVALON_SCREENS.has(active.id);
    document.body.classList.toggle('rt-avalon', on);
    document.documentElement.classList.toggle('rt-avalon', on);   // bigger base type, see round-table.css
  }

  function init() {
    buildHall();
    syncBodyClass();
    const mo = new MutationObserver(syncBodyClass);
    document.querySelectorAll('.screen').forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['class'] }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.RoundTable = { heraldry, renderRoundTable, candles, roman, icon: ICON, sound: Sound };
})();
