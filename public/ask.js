// ask.js — "Ask a question" helper, shared by any game that wants one.
//
// Works offline with no AI service: each game hands in a small curated list of
// questions and answers, and this file matches whatever the player types (or
// dictates) against it. Matching is forgiving on purpose — keyword phrases,
// light stemming, and one- or two-letter typos — because players ask in their
// own words and phone dictation mangles names ("marlin" for Merlin).
//
// Answers may be functions of a context object the game supplies, so "what
// should I do now?" can speak to the phase the player is actually in. They
// only ever see what that player's own client already knows.
//
// Usage:
//   const ask = AskSheet.create({ title, entries, context, suggest, intro });
//   ask.open();               // or ask.open('how do I win')
//
// entry: { id, q, keys: [phrases], a: string | ctx => string|null,
//          related?: [ids], hidden?: bool }
// A function answer also gets the question as typed (empty when a chip was
// tapped), so "setup for 8 players" can answer for 8.
(function () {
  'use strict';

  const STOP = new Set(('a an the is are am was were be do does did i me my you your it its '
    + 'of to in on at for and or but if so can could would should will what whats how '
    + 'who whom which when where why this that there their they them we us our with about '
    + 'get got has have had just than then too very really please tell mean means').split(' '));

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Answers are plain text with **bold** and line breaks — nothing else.
  function fmt(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Crude, but applied to both sides, so "vote", "votes", "voted" and
  // "voting" all land on "vot".
  function stem(w) {
    if (w.length > 4 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
  }
  function words(s) { return norm(s).split(' ').filter(Boolean); }
  function content(s) { return words(s).filter(w => !STOP.has(w)).map(stem); }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function tokenHit(key, toks) {
    if (toks.includes(key)) return 1;
    if (key.length < 5) return 0;
    const max = key.length >= 8 ? 2 : 1;
    return toks.some(t => t.length >= 4 && lev(key, t, max) <= max) ? 0.75 : 0;
  }

  // Multi-word key phrases must appear as a phrase; single words match by
  // token, with typo tolerance. The question text itself counts a little, so
  // an entry is findable even by words nobody thought to list as keys.
  function score(entry, query) {
    const qn = ' ' + words(query).map(stem).join(' ') + ' ';
    const toks = content(query);
    if (!toks.length && !qn.trim()) return 0;
    let s = 0;
    for (const k of entry.keys || []) {
      const kw = words(k).map(stem);
      if (kw.length > 1) {
        if (qn.includes(' ' + kw.join(' ') + ' ')) s += 2 * kw.length;
      } else if (kw.length === 1) {
        s += 2 * tokenHit(kw[0], toks);
      }
    }
    const qt = new Set(content(entry.q));
    for (const t of toks) if (qt.has(t)) s += 0.5;
    return s;
  }

  function create(opts) {
    const entries = opts.entries;
    const byId = Object.fromEntries(entries.map(e => [e.id, e]));
    const ctx = () => (opts.context ? opts.context() : {});

    function answerOf(entry, query) {
      const a = typeof entry.a === 'function' ? entry.a(ctx(), query || '') : entry.a;
      return a || entry.fallback || '';
    }

    function best(query) {
      const ranked = entries
        .map(e => ({ e, s: score(e, query) }))
        .filter(r => r.s >= 1.5)
        .sort((x, y) => y.s - x.s);
      return ranked;
    }

    let el = null;
    function build() {
      el = document.createElement('div');
      el.className = 'ask-overlay';
      el.hidden = true;
      el.innerHTML = `
        <div class="ask-sheet" role="dialog" aria-label="${esc(opts.title)}">
          <div class="ask-head">
            <span class="ask-title">${esc(opts.title)}</span>
            <button class="ask-close" aria-label="Close">✕</button>
          </div>
          <div class="ask-log"></div>
          <div class="ask-chips"></div>
          <form class="ask-form" autocomplete="off">
            <input class="ask-input" type="text" enterkeyhint="send"
                   placeholder="${esc(opts.placeholder || 'Ask anything about the rules…')}">
            <button class="ask-send" type="submit">Ask</button>
          </form>
        </div>`;
      document.body.appendChild(el);
      el.addEventListener('click', e => { if (e.target === el) close(); });
      el.querySelector('.ask-close').addEventListener('click', close);
      el.querySelector('.ask-form').addEventListener('submit', e => {
        e.preventDefault();
        const input = el.querySelector('.ask-input');
        const q = input.value.trim();
        if (!q) return;
        input.value = '';
        ask(q);
      });
      el.querySelector('.ask-chips').addEventListener('click', e => {
        const b = e.target.closest('[data-ask]');
        if (b) show(byId[b.dataset.ask], byId[b.dataset.ask].q);
      });
      el.querySelector('.ask-log').addEventListener('click', e => {
        const b = e.target.closest('[data-ask]');
        if (b) show(byId[b.dataset.ask], byId[b.dataset.ask].q);
      });
    }

    function chipsHtml(ids) {
      return ids.map(id => byId[id]).filter(Boolean)
        .map(e => `<button class="ask-chip" data-ask="${e.id}">${esc(e.q)}</button>`).join('');
    }

    function renderSuggestions(exclude) {
      const ids = (opts.suggest ? opts.suggest(ctx()) : entries.slice(0, 4).map(e => e.id))
        .filter(id => id !== exclude).slice(0, 4);
      el.querySelector('.ask-chips').innerHTML = chipsHtml(ids);
    }

    function push(html, cls) {
      const log = el.querySelector('.ask-log');
      const div = document.createElement('div');
      div.className = 'ask-msg ' + cls;
      div.innerHTML = html;
      log.appendChild(div);
      return div;
    }

    function show(entry, asked) {
      const q = push(esc(asked), 'q');
      // Land on the question, so its answer reads from the top.
      requestAnimationFrame(() => q.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      const related = (entry.related || []).filter(id => byId[id]).slice(0, 3);
      push(`${fmt(answerOf(entry, asked === entry.q ? '' : asked))}${related.length
        ? `<div class="ask-related">${chipsHtml(related)}</div>` : ''}`, 'a');
      renderSuggestions(entry.id);
    }

    function ask(q) {
      const ranked = best(q);
      if (!ranked.length) {
        const asked = push(esc(q), 'q');
        requestAnimationFrame(() => asked.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        const ids = opts.suggest ? opts.suggest(ctx()) : [];
        push(`${fmt(opts.unknown || "I don't have an answer for that one. Try asking it another way, or pick one of these:")}
          <div class="ask-related">${chipsHtml(ids.slice(0, 4))}</div>`, 'a');
        return;
      }
      const top = ranked[0].e;
      show(top, q);
      // A close second usually means the question touched two topics; offer it.
      const second = ranked[1];
      if (second && second.s >= ranked[0].s * 0.8 && !(top.related || []).includes(second.e.id)) {
        const last = el.querySelector('.ask-log .ask-msg.a:last-child');
        const rel = last.querySelector('.ask-related') || last.appendChild(Object.assign(
          document.createElement('div'), { className: 'ask-related' }));
        rel.insertAdjacentHTML('afterbegin', chipsHtml([second.e.id]));
      }
    }

    function open(initial) {
      if (!el) build();
      el.hidden = false;
      document.body.classList.add('ask-open');
      if (!el.querySelector('.ask-log').children.length && opts.intro) {
        push(fmt(typeof opts.intro === 'function' ? opts.intro(ctx()) : opts.intro), 'a');
      }
      renderSuggestions();
      if (initial) ask(initial);
      // Don't pop the keyboard over the suggestions on phones.
      if (window.matchMedia('(hover: hover)').matches) el.querySelector('.ask-input').focus();
    }
    function close() {
      if (!el) return;
      el.hidden = true;
      document.body.classList.remove('ask-open');
    }

    return { open, close, match: q => (best(q)[0] || {}).e || null, answer: answerOf };
  }

  if (typeof window !== 'undefined') window.AskSheet = { create };
  if (typeof module !== 'undefined') module.exports = { create, score, norm };
})();
