/**
 * trivia-show.js — Trivia Night's "you are on a TV quiz show" layer.
 *
 *   • The stage   — spotlights, a chasing row of marquee bulbs and a glowing
 *                   floor behind every Trivia screen (body.ts-trivia).
 *   • Marquees    — any `.ts-bulbs` element gets a ring of lit bulbs around
 *                   its edge (the title sign on the home screen).
 *   • Confetti    — a burst when your team gets one right, a big one at the end.
 *   • Sound       — buzzer, chimes, a wrong-answer honk and a fanfare,
 *                   synthesised with WebAudio. No audio files to license.
 *
 * All art is original CSS and inline markup; fonts are OFL from Google Fonts.
 * Purely presentational: trivia.js tells it when, the server decides what.
 */
(function () {
  'use strict';

  // ── The stage ───────────────────────────────────────────────────────────
  function buildStage() {
    if (document.getElementById('ts-stage')) return;
    const stage = document.createElement('div');
    stage.id = 'ts-stage';
    stage.setAttribute('aria-hidden', 'true');
    stage.innerHTML = `
      <div class="ts-wall"></div>
      <div class="ts-beam l"></div><div class="ts-beam r"></div>
      <div class="ts-floor"></div>
      <div class="ts-calm"></div>
      <div class="ts-rail"></div>`;
    document.body.prepend(stage);
    const rail = stage.querySelector('.ts-rail');
    rail.innerHTML = Array.from({ length: 40 }, (_, i) => `<i class="${i % 2 ? 'b' : 'a'}"></i>`).join('');

    const c = document.createElement('canvas');
    c.id = 'ts-confetti';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
  }

  // A ring of bulbs around an element, spaced evenly along its edge.
  function bulbs(el) {
    if (el.querySelector(':scope > .ts-bulb-ring')) return;
    const across = +el.dataset.across || 11, down = +el.dataset.down || 4;
    const pts = [];
    for (let i = 0; i < across; i++) pts.push([i / (across - 1) * 100, 0]);
    for (let i = 1; i <= down; i++) pts.push([100, i / (down + 1) * 100]);
    for (let i = across - 1; i >= 0; i--) pts.push([i / (across - 1) * 100, 100]);
    for (let i = down; i >= 1; i--) pts.push([0, i / (down + 1) * 100]);
    const ring = document.createElement('span');
    ring.className = 'ts-bulb-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = pts.map(([x, y], i) => `<i class="${i % 2 ? 'b' : 'a'}" style="left:${x}%;top:${y}%"></i>`).join('');
    el.prepend(ring);
  }

  // ── Confetti ────────────────────────────────────────────────────────────
  const COLORS = ['#ffd23f', '#ff4f9a', '#3ee6f0', '#8c6cff', '#3ddc84', '#ffffff'];
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let pieces = [], running = false;

  function confetti(big = false) {
    if (reduceMotion()) return;
    const c = document.getElementById('ts-confetti');
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const n = big ? 180 : 80;
    for (let i = 0; i < n; i++) {
      const fromLeft = i % 2 === 0;
      pieces.push({
        x: (fromLeft ? 0.05 : 0.95) * c.width,
        y: c.height * (big ? 0.55 : 0.7),
        vx: (fromLeft ? 1 : -1) * (2 + Math.random() * 7) * dpr,
        vy: -(8 + Math.random() * (big ? 12 : 9)) * dpr,
        w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[(Math.random() * COLORS.length) | 0], life: 0,
      });
    }
    if (!running) { running = true; requestAnimationFrame(t => frame(c, dpr)); }
  }

  function frame(c, dpr) {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    pieces = pieces.filter(p => p.y < c.height + 40 && p.life < 360);
    for (const p of pieces) {
      p.life++; p.vy += 0.32 * dpr; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      g.scale(1, Math.abs(Math.cos(p.life * 0.12)) + 0.15);
      g.fillStyle = p.color; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (pieces.length) requestAnimationFrame(() => frame(c, dpr));
    else { running = false; g.clearRect(0, 0, c.width, c.height); }
  }

  // ── Sound ───────────────────────────────────────────────────────────────
  // Browsers only allow audio after a tap, so the context is made lazily.
  const Sound = (() => {
    let ctx = null;
    let on = true;
    try { on = localStorage.getItem('ts-sound') !== 'off'; } catch { /* storage blocked */ }

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
    function tone(c, freq, t, len, { type = 'sine', vol = 0.15, slide = 0 } = {}) {
      const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + len);
      const g = c.createGain(); env(g, t, 0.008, vol, len);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + len + 0.1);
    }
    // A bright game-show chime: a sine with a quiet octave on top.
    function chime(c, freq, t, len = 0.5, vol = 0.16) {
      tone(c, freq, t, len, { vol });
      tone(c, freq * 2, t, len * 0.6, { vol: vol * 0.3 });
    }

    const play = {
      // Buzzers open: two quick dings.
      open() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02; chime(c, 1047, t, .25, .12); chime(c, 1319, t + .12, .4, .12); },
      // Somebody buzzed: the classic flat buzzer.
      buzz() { const c = ac(); if (!c) return; const t = c.currentTime + 0.01;
        tone(c, 155, t, .42, { type: 'square', vol: .07 }); tone(c, 158, t, .42, { type: 'sawtooth', vol: .06 }); },
      // Your own tap on the buzzer: a short click.
      press() { const c = ac(); if (!c) return; tone(c, 880, c.currentTime + 0.005, .06, { type: 'triangle', vol: .12, slide: .6 }); },
      // Right: three rising dings.
      correct() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02;
        [784, 988, 1319].forEach((f, i) => chime(c, f, t + i * .1, i === 2 ? .7 : .3, .14)); },
      // Wrong: the sad trombone, two notes sliding down.
      wrong() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02;
        tone(c, 233, t, .28, { type: 'sawtooth', vol: .06, slide: .97 }); tone(c, 196, t + .3, .6, { type: 'sawtooth', vol: .06, slide: .9 }); },
      // The answer is shown and nobody (on your side) got it.
      reveal() { const c = ac(); if (!c) return; chime(c, 660, c.currentTime + 0.02, .5, .1); },
      // Round title card.
      round() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02;
        [[523, 0, .14], [659, .13, .14], [784, .26, .14], [1047, .4, .6]].forEach(([f, d, l]) => tone(c, f, t + d, l, { type: 'triangle', vol: .12 })); },
      // Last seconds on the clock.
      tick() { const c = ac(); if (!c) return; tone(c, 1500, c.currentTime + 0.005, .04, { type: 'square', vol: .03 }); },
      // Tapped before the buzzers opened.
      nope() { const c = ac(); if (!c) return; tone(c, 180, c.currentTime + 0.01, .18, { type: 'square', vol: .05 }); },
      // Final scores.
      fanfare() { const c = ac(); if (!c) return; const t = c.currentTime + 0.02;
        [[523, 0, .16], [523, .16, .1], [523, .28, .1], [698, .4, .5], [880, .9, .2], [784, 1.1, .2], [1047, 1.3, 1.1]]
          .forEach(([f, d, l]) => { tone(c, f, t + d, l, { type: 'triangle', vol: .13 }); tone(c, f / 2, t + d, l, { type: 'sine', vol: .08 }); }); },
    };

    return {
      play(name) { try { play[name]?.(); } catch { /* audio is never worth a crash */ } },
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem('ts-sound', on ? 'on' : 'off'); } catch { /* ignore */ }
        if (on) play.open();
        return on;
      },
    };
  })();

  // ── Follow the active screen ────────────────────────────────────────────
  function syncBodyClass() {
    const active = document.querySelector('.screen.active');
    const on = !!active && active.id.startsWith('screen-triv-');
    document.body.classList.toggle('ts-trivia', on);
    document.documentElement.classList.toggle('ts-trivia', on);
  }

  function init() {
    buildStage();
    document.querySelectorAll('.ts-bulbs').forEach(bulbs);
    syncBodyClass();
    const mo = new MutationObserver(syncBodyClass);
    document.querySelectorAll('.screen').forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['class'] }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TriviaShow = { play: name => Sound.play(name), sound: Sound, confetti, bulbs };
})();
