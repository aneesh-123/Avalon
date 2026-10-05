// trivia.js — client for Trivia Night. Shares the page's socket, showScreen,
// esc, copyText and playerToken with client.js; everything else is its own.
//
// The server is authoritative: this file renders the per-player view it is
// sent ('triv:state') and turns taps into events. The one thing it measures
// itself is time — the buzzer stamps the instant of the tap on this phone's
// clock, converted to server time, so a slow connection does not lose a race
// the player won in the room.
(function () {
  'use strict';

  const SESSION_KEY = 'trivia-session';
  function saveTrivSession(d) { try { appStorage.setItem(SESSION_KEY, JSON.stringify(d)); } catch {} }
  function loadTrivSession()  { try { return JSON.parse(appStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function clearTrivSession() { try { appStorage.removeItem(SESSION_KEY); } catch {} }

  const $ = id => document.getElementById(id);

  // ── State ─────────────────────────────────────────────────────────────
  let view = null;             // the last 'triv:state'
  let myCode = '';
  let teamPickerOpen = false;  // the player asked to switch teams
  let pendingBuzz = null;      // { openId } between the tap and the server's answer
  let tooEarlyUntil = 0;       // performance.now() until which the buzzer ignores taps
  let userAskedRejoin = false;

  function act(event, extra = {}) {
    socket.emit(event, { code: myCode, token: playerToken, ...extra });
  }

  // ── Clock sync ────────────────────────────────────────────────────────
  // Classic NTP-style estimate: send our clock, the server answers with its
  // own, and the midpoint of the round trip is when it read it. The sample
  // with the shortest round trip is the most trustworthy, so that one wins.
  const clock = { samples: [], best: null, rough: null };

  function ping() {
    if (!socket.connected) return;
    const t0 = performance.now();
    let done = false;
    socket.emit('triv:clock', {}, res => {
      if (done || !res || typeof res.now !== 'number') return;
      done = true;
      const t1 = performance.now();
      const sample = { rtt: t1 - t0, offset: res.now - (t0 + t1) / 2, at: t1 };
      clock.samples.push(sample);
      if (clock.samples.length > 12) clock.samples.shift();
      clock.best = clock.samples.reduce((a, b) => (a && a.rtt <= b.rtt ? a : b), null);
    });
    setTimeout(() => { done = true; }, 3000);
  }

  function burst() { for (let i = 0; i < 5; i++) setTimeout(ping, i * 180); }

  function serverNow() {
    const off = clock.best ? clock.best.offset : clock.rough;
    return off === null ? Date.now() : performance.now() + off;
  }

  // Keep the estimate fresh while seated in a quiz: phones drift, and a
  // network change (wifi to cellular) changes the round trip entirely.
  setInterval(() => { if (loadTrivSession()?.code && socket.connected) ping(); }, 8000);

  // ── Game picker + home ────────────────────────────────────────────────
  $('pick-trivia')?.addEventListener('click', () => { refreshRejoinBanner(); showScreen('triv-home'); });

  function refreshRejoinBanner() {
    const s = loadTrivSession();
    $('triv-rejoin-banner').hidden = !(s?.code && s?.name);
    if (s?.name) $('triv-rejoin-name').textContent = s.name;
  }
  refreshRejoinBanner();

  $('triv-btn-rejoin').addEventListener('click', () => {
    const s = loadTrivSession();
    if (!s?.code) return;
    myCode = s.code;
    userAskedRejoin = true;
    socket.emit('triv:rejoin-room', { code: s.code, token: playerToken });
  });

  $('triv-btn-join').addEventListener('click', () => {
    $('triv-join-error').textContent = '';
    showScreen('triv-join');
  });

  // ── Create ────────────────────────────────────────────────────────────
  let categories = [];
  const pick = { mode: 'host', cats: new Set(), rounds: 3, perRound: 6, style: 'themed', seconds: 20 };
  let catsInitialised = false;

  $('triv-btn-create').addEventListener('click', () => {
    $('triv-create-error').textContent = '';
    const s = loadTrivSession();
    if (s?.name && !$('triv-create-name').value) $('triv-create-name').value = s.name;
    socket.emit('triv:get-categories');
    renderCreate();
    showScreen('triv-create');
  });

  socket.on('triv:categories', ({ categories: list }) => {
    categories = Array.isArray(list) ? list : [];
    if (!catsInitialised) {
      // A sensible starter set: a few broad ones and one fandom, so the host
      // who just taps Create still gets a varied quiz.
      ['geography', 'science', 'movies', 'harry-potter']
        .filter(id => categories.some(c => c.id === id))
        .forEach(id => pick.cats.add(id));
      syncRoundsToCats();
      catsInitialised = true;
    }
    renderCreate();
  });

  document.querySelectorAll('.triv-mode').forEach(btn => btn.addEventListener('click', () => {
    pick.mode = btn.dataset.mode;
    renderCreate();
  }));

  $('triv-cat-toggle-all').addEventListener('click', () => {
    if (pick.cats.size === categories.length) pick.cats.clear();
    else categories.forEach(c => pick.cats.add(c.id));
    syncRoundsToCats();
    renderCreate();
  });

  $('triv-cats').addEventListener('click', e => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    const id = chip.dataset.cat;
    if (pick.cats.has(id)) pick.cats.delete(id); else pick.cats.add(id);
    syncRoundsToCats();
    renderCreate();
  });

  // With one category per round, picking a category should mean it comes up:
  // the round count follows the picks. The host can still change it after.
  function syncRoundsToCats() {
    if (pick.style === 'themed' && pick.cats.size) pick.rounds = Math.max(1, Math.min(8, pick.cats.size));
  }

  const stepper = (minus, plus, key, lo, hi) => {
    $(minus).addEventListener('click', () => { pick[key] = Math.max(lo, pick[key] - 1); renderCreate(); });
    $(plus).addEventListener('click', () => { pick[key] = Math.min(hi, pick[key] + 1); renderCreate(); });
  };
  stepper('triv-rounds-minus', 'triv-rounds-plus', 'rounds', 1, 8);
  stepper('triv-per-minus', 'triv-per-plus', 'perRound', 3, 15);

  $('triv-style-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-style]');
    if (b) { pick.style = b.dataset.style; renderCreate(); }
  });
  $('triv-seconds-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-seconds]');
    if (b) { pick.seconds = parseInt(b.dataset.seconds, 10); renderCreate(); }
  });

  function renderCreate() {
    document.querySelectorAll('.triv-mode').forEach(b => b.classList.toggle('selected', b.dataset.mode === pick.mode));
    $('triv-cats').innerHTML = categories.map(c => `
      <button class="triv-cat${pick.cats.has(c.id) ? ' selected' : ''}" data-cat="${esc(c.id)}">
        <span class="triv-cat-icon">${esc(c.icon)}</span>
        <span class="triv-cat-name">${esc(c.name)}</span>
      </button>`).join('') || '<p class="triv-muted">Loading categories…</p>';
    $('triv-cat-toggle-all').textContent = pick.cats.size === categories.length && categories.length ? 'Clear all' : 'Select all';
    $('triv-rounds-value').textContent = pick.rounds;
    $('triv-per-value').textContent = pick.perRound;
    $('triv-rounds-minus').disabled = pick.rounds <= 1;
    $('triv-rounds-plus').disabled = pick.rounds >= 8;
    $('triv-per-minus').disabled = pick.perRound <= 3;
    $('triv-per-plus').disabled = pick.perRound >= 15;
    document.querySelectorAll('#triv-style-seg [data-style]').forEach(b => b.classList.toggle('selected', b.dataset.style === pick.style));
    document.querySelectorAll('#triv-seconds-seg [data-seconds]').forEach(b => b.classList.toggle('selected', +b.dataset.seconds === pick.seconds));
    $('triv-seconds-block').hidden = pick.mode !== 'auto';
    $('triv-phones-row').hidden = pick.mode !== 'host';

    const total = pick.rounds * pick.perRound;
    // Rough pace: a hosted question takes about 40s read, buzzed and judged;
    // an auto one is the timer plus the reveal.
    const perQ = pick.mode === 'host' ? 40 : Math.round(pick.seconds * 0.8) + 7;
    const mins = Math.max(1, Math.round((total * perQ + pick.rounds * 20) / 60));
    const names = categories.filter(c => pick.cats.has(c.id)).map(c => c.name);
    let catLine = '';
    if (pick.style === 'themed' && names.length) {
      const order = Array.from({ length: pick.rounds }, (_, i) => names[i % names.length]);
      catLine = `<span class="triv-summary-rounds">${order.map((n, i) => `R${i + 1} ${esc(n)}`).join(' · ')}</span>`;
      const unused = names.slice(pick.rounds);
      if (unused.length) catLine += `<span class="triv-summary-warn">${unused.map(esc).join(', ')} won’t come up. Add rounds or mix them up.</span>`;
    }
    $('triv-summary').innerHTML = pick.cats.size
      ? `${total} questions · about ${mins} min${catLine}`
      : 'Pick at least one category.';
    $('triv-create-submit').disabled = pick.cats.size === 0;
  }

  $('triv-create-submit').addEventListener('click', () => {
    const name = $('triv-create-name').value.trim();
    if (!name) { $('triv-create-error').textContent = 'Enter your name.'; $('triv-create-name').focus(); return; }
    if (!pick.cats.size) { $('triv-create-error').textContent = 'Pick at least one category.'; return; }
    $('triv-create-error').textContent = '';
    beginTrivia();
    socket.emit('triv:create-room', {
      name, token: playerToken,
      config: {
        mode: pick.mode, categories: [...pick.cats], rounds: pick.rounds, perRound: pick.perRound,
        roundStyle: pick.style, seconds: pick.seconds, showOnPhones: $('triv-show-on-phones').checked,
      },
    });
  });

  // One game at a time across the whole app: taking a Trivia seat drops any
  // saved Avalon or Imposter seat, so their auto-rejoin cannot yank this phone
  // back into an old game on the next reconnect.
  function beginTrivia() {
    try { appStorage.removeItem('avalon-session'); appStorage.removeItem('imposter-session'); } catch {}
    burst();
  }

  // ── Join ──────────────────────────────────────────────────────────────
  $('triv-join-submit').addEventListener('click', () => {
    const code = $('triv-join-code').value.trim().toUpperCase();
    const name = $('triv-join-name').value.trim();
    if (code.length !== 5) { $('triv-join-error').textContent = 'Room codes are five characters.'; return; }
    if (!name) { $('triv-join-error').textContent = 'Enter your name.'; return; }
    $('triv-join-error').textContent = '';
    myCode = code;
    beginTrivia();
    socket.emit('triv:join-room', { code, name, token: playerToken });
  });
  ['triv-join-code', 'triv-join-name'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('triv-join-submit').click();
  }));

  // Invite links look like /?room=CODE&game=trivia — Avalon's own handler
  // ignores any link whose game isn't Avalon, so the two never fight over it.
  (function deepLink() {
    const p = new URLSearchParams(location.search);
    if ((p.get('game') || '').toLowerCase() !== 'trivia') return;
    const code = (p.get('room') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return;
    const saved = loadTrivSession();
    if (saved?.code === code) return;   // a reload mid-game: auto-rejoin handles it
    clearTrivSession();
    refreshRejoinBanner();
    $('triv-join-code').value = code;
    showScreen('triv-join');
    const name = (p.get('name') || '').trim().slice(0, 20);
    if (name) { $('triv-join-name').value = name; setTimeout(() => $('triv-join-submit').click(), 150); }
    else setTimeout(() => $('triv-join-name').focus(), 60);
  })();

  // ── Connection ────────────────────────────────────────────────────────
  function otherGameSaved() {
    try { return !!(appStorage.getItem('avalon-session') || appStorage.getItem('imposter-session')); } catch { return false; }
  }

  socket.on('connect', () => {
    const s = loadTrivSession();
    if (!s?.code || otherGameSaved()) return;
    myCode = s.code;
    burst();
    socket.emit('triv:rejoin-room', { code: s.code, token: playerToken });
  });

  // Back from the background: the socket may have survived while the game
  // moved on several questions. Pull the current state.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { releaseWakeLock(); return; }
    if (!socket.connected || !loadTrivSession()?.code) return;
    ping();
    act('triv:request-sync');
    if (onGameScreen()) requestWakeLock();
  });

  socket.on('triv:desync', () => {
    const s = loadTrivSession();
    if (s?.code) socket.emit('triv:rejoin-room', { code: s.code, token: playerToken });
  });

  socket.on('triv:rejoin-error', msg => {
    clearTrivSession();
    refreshRejoinBanner();
    if (userAskedRejoin) alert(msg);
    userAskedRejoin = false;
  });

  socket.on('triv:error', msg => {
    const active = document.querySelector('.screen.active')?.id || '';
    const target = { 'screen-triv-create': 'triv-create-error', 'screen-triv-join': 'triv-join-error', 'screen-triv-team': 'triv-team-error' }[active];
    if (target) $(target).textContent = msg;
    else if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  });

  socket.on('triv:joined', ({ code, name }) => {
    myCode = code;
    saveTrivSession({ code, name });
    userAskedRejoin = false;
    refreshRejoinBanner();
  });

  // ── Wake lock ─────────────────────────────────────────────────────────
  // A phone that dims mid-question drops its socket, and a dropped socket is
  // the most common way to miss a buzz. Keep the screen on while playing.
  let wakeLock = null;
  async function requestWakeLock() {
    try { if (!wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); wakeLock?.addEventListener?.('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
  }
  function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }
  const onGameScreen = () => $('screen-triv-game').classList.contains('active');

  // ── State routing ─────────────────────────────────────────────────────
  socket.on('triv:state', v => {
    const prev = view;
    view = v;
    myCode = v.code;
    if (clock.rough === null || !clock.best) clock.rough = v.serverNow - performance.now();
    if (v.you) saveTrivSession({ code: v.code, name: v.you.name });

    // A new buzzer opening, a new question, or a ruling clears the tap state.
    if (pendingBuzz && (!v.buzz || v.buzz.openId !== pendingBuzz.openId || v.buzz.answeringTeamId)) pendingBuzz = null;
    if (v.you?.teamId && teamPickerOpen && prev?.you?.teamId !== v.you.teamId) teamPickerOpen = false;

    // Buzzers just opened: a buzz of the phone, for anyone looking away.
    if (v.buzz?.open && !(prev?.buzz?.open) && !v.you?.quizmaster) { try { navigator.vibrate?.(60); } catch {} }

    route();
    showCues(prev, v);
  });

  // ── Show cues ─────────────────────────────────────────────────────────
  // Sounds and confetti from trivia-show.js, fired on what changed between
  // two states. Nothing plays on the first state after a load or rejoin.
  function showCues(prev, v) {
    const S = window.TriviaShow;
    if (!S || !prev || prev.code !== v.code) return;
    const r = v.round || {}, pr = prev.round || {};
    const moved = v.phase !== prev.phase || r.qIndex !== pr.qIndex || r.index !== pr.index;
    const mine = v.you?.teamId;
    if (moved) {
      if (v.phase === 'round-intro') S.play('round');
      else if (v.phase === 'question' && v.mode === 'auto') S.play('open');
      else if (v.phase === 'reveal') {
        const res = v.result || {};
        const right = mine ? (res.correctTeamIds || []).includes(mine) : (res.correctTeamIds || []).length > 0;
        const wrong = mine && ((res.wrongTeamIds || []).includes(mine) || (v.mode === 'auto' && res.byTeam?.[mine] && !res.byTeam[mine].correct));
        if (right) { S.play('correct'); if (mine) S.confetti(); }
        else S.play(wrong ? 'wrong' : 'reveal');
      } else if (v.phase === 'game-over') { S.play('fanfare'); S.confetti(true); }
      return;
    }
    if (v.phase === 'question' && v.mode === 'host') {
      const b = v.buzz || {}, pb = prev.buzz || {};
      if (b.open && !pb.open) S.play('open');
      if (b.answeringTeamId && b.answeringTeamId !== pb.answeringTeamId) S.play('buzz');
      if ((b.wrong || []).length > (pb.wrong || []).length) S.play('wrong');
    }
  }

  const soundBtn = $('triv-sound-btn');
  function syncSoundBtn() { if (soundBtn && window.TriviaShow) soundBtn.textContent = window.TriviaShow.sound.on ? '🔊' : '🔇'; }
  soundBtn?.addEventListener('click', () => { window.TriviaShow?.sound.toggle(); syncSoundBtn(); });
  syncSoundBtn();

  function needsTeam(v) {
    return !v.you?.teamId && !(v.mode === 'host' && v.you?.isHost);
  }

  function route() {
    const v = view;
    if (!v) return;
    if (needsTeam(v) || teamPickerOpen) { renderTeamPicker(); showIfNot('triv-team'); return; }
    if (v.state === 'lobby') { renderLobby(); showIfNot('triv-lobby'); releaseWakeLock(); return; }
    renderGame();
    if (!onGameScreen()) { showScreen('triv-game'); requestWakeLock(); }
  }

  function showIfNot(id) {
    if (!$('screen-' + id).classList.contains('active')) showScreen(id);
  }

  // ── Shared bits ───────────────────────────────────────────────────────
  const teamById = id => view?.teams.find(t => t.id === id) || null;

  function crestName(t, cls = '') {
    if (!t) return '';
    return `<span class="triv-team-tag ${cls}" style="color:${esc(t.color)};border-color:${esc(t.color)}55;background:${esc(t.color)}14">${esc(t.crest)} ${esc(t.name)}</span>`;
  }

  function standings(teams) {
    const sorted = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    let rank = 0, last = null;
    return sorted.map((t, i) => { if (t.score !== last) { rank = i + 1; last = t.score; } return { ...t, rank }; });
  }

  const isController = v => !!v.you && (v.you.isHost || !v.host || !v.host.connected);

  // ── Team picker ───────────────────────────────────────────────────────
  function renderTeamPicker() {
    const v = view;
    $('triv-team-back').hidden = !v.you?.teamId;
    $('triv-new-team-name').placeholder = v.suggestedTeamName || 'Team name';
    const teams = v.teams;
    $('triv-team-list').innerHTML = teams.length ? teams.map(t => {
      const mine = v.you?.teamId === t.id;
      const members = t.members.map(m => esc(m.name)).join(', ') || '<em>nobody yet</em>';
      return `<button class="triv-team-card${mine ? ' mine' : ''}" data-team="${esc(t.id)}" style="border-color:${esc(t.color)}${mine ? '' : '44'}">
        <span class="triv-team-crest" style="background:${esc(t.color)}22;box-shadow:0 0 0 2px ${esc(t.color)}66">${esc(t.crest)}</span>
        <span class="triv-team-info">
          <span class="triv-team-name" style="color:${esc(t.color)}">${esc(t.name)}</span>
          <span class="triv-team-members">${members}</span>
        </span>
        <span class="triv-team-join">${mine ? 'Your team' : 'Join'}</span>
      </button>`;
    }).join('') : '<p class="triv-muted triv-team-empty">No teams yet — start the first one.</p>';
  }

  $('triv-team-list').addEventListener('click', e => {
    const card = e.target.closest('[data-team]');
    if (!card) return;
    $('triv-team-error').textContent = '';
    if (card.dataset.team === view?.you?.teamId) { teamPickerOpen = false; route(); return; }
    act('triv:join-team', { teamId: card.dataset.team });
    teamPickerOpen = false;
  });
  $('triv-new-team-btn').addEventListener('click', () => {
    $('triv-team-error').textContent = '';
    const name = $('triv-new-team-name').value.trim() || $('triv-new-team-name').placeholder;
    act('triv:create-team', { name });
    $('triv-new-team-name').value = '';
    teamPickerOpen = false;
  });
  $('triv-new-team-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('triv-new-team-btn').click(); });
  $('triv-team-back').addEventListener('click', () => { teamPickerOpen = false; route(); });

  // ── Lobby ─────────────────────────────────────────────────────────────
  const inviteLink = code => `${location.origin}/?room=${encodeURIComponent(code)}&game=trivia`;
  let qrFor = '';

  function renderLobby() {
    const v = view;
    $('triv-lobby-code').textContent = v.code;
    if (qrFor !== v.code) {
      qrFor = v.code;
      $('triv-qr-image').src = `/qr?data=${encodeURIComponent(inviteLink(v.code))}`;
      const reachable = typeof originIsReachableByOthers === 'function' ? originIsReachableByOthers() : true;
      $('triv-qr-warning').hidden = reachable;
      if (!reachable) $('triv-qr-warning').textContent = 'You’re on localhost, so this code only works on this machine. Open the app on your network address for others to scan it.';
    }

    const c = v.config;
    const modeLine = v.mode === 'host'
      ? `🎙️ Hosted by <strong>${esc(v.host?.name || '—')}</strong>`
      : `📱 No host · ${c.seconds}s per question`;
    const cats = c.categories.map(x => `<span class="triv-mini-cat">${esc(x.icon)} ${esc(x.name)}</span>`).join('');
    $('triv-lobby-summary').innerHTML = `
      <div class="triv-ls-mode">${modeLine}</div>
      <div class="triv-ls-shape">${c.rounds} round${c.rounds > 1 ? 's' : ''} × ${c.perRound} questions · ${c.roundStyle === 'mixed' ? 'mixed categories' : 'one category per round'}</div>
      <div class="triv-ls-cats">${cats}</div>`;

    const you = v.you;
    const myTeam = teamById(you?.teamId);
    $('triv-lobby-you').innerHTML = you?.quizmaster
      ? `<div class="triv-you-box host"><span class="triv-you-icon">🎙️</span><span><strong>You’re the quizmaster.</strong> You see the answers.</span></div>`
      : myTeam
        ? `<div class="triv-you-box"><span>You’re on ${crestName(myTeam)}</span><button class="triv-link-btn" id="triv-change-team">Change team</button></div>`
        : '';
    $('triv-change-team')?.addEventListener('click', () => { teamPickerOpen = true; route(); });

    const teamCards = v.teams.map(t => `
      <div class="triv-lobby-team" style="border-color:${esc(t.color)}44">
        <span class="triv-team-crest" style="background:${esc(t.color)}22;box-shadow:0 0 0 2px ${esc(t.color)}66">${esc(t.crest)}</span>
        <div class="triv-team-info">
          <span class="triv-team-name" style="color:${esc(t.color)}">${esc(t.name)}</span>
          <span class="triv-team-members">${t.members.map(m => `<span class="triv-member${m.connected ? '' : ' away'}">${esc(m.name)}${m.you ? ' <em>(you)</em>' : ''}</span>`).join('')}</span>
        </div>
      </div>`).join('');
    const waiting = v.unassigned.length
      ? `<p class="triv-muted">Picking a team: ${v.unassigned.map(esc).join(', ')}</p>` : '';
    $('triv-lobby-teams').innerHTML = `
      <p class="section-label">Teams <span class="triv-count">${v.teams.length}</span></p>
      ${teamCards || '<p class="triv-muted">No teams yet. Scan the code to join.</p>'}
      ${waiting}`;

    let actions = '';
    if (isController(v)) {
      const n = v.teams.filter(t => t.members.length).length;
      const hint = n === 0 ? 'Waiting for the first team to form.'
        : n === 1 ? 'One team so far. You can start, but trivia is better with two or more.'
        : `${n} teams ready.`;
      actions = `<button class="primary-btn" id="triv-start-btn" ${n ? '' : 'disabled'}>Start the Quiz</button>
                 <p class="lobby-hint">${hint}</p>`;
    } else {
      actions = `<p class="lobby-hint">Waiting for <strong>${esc(v.host?.name || 'the host')}</strong> to start the quiz…</p>`;
    }
    $('triv-lobby-actions').innerHTML = actions;
    $('triv-start-btn')?.addEventListener('click', () => act('triv:start'));
  }

  let inviteTimer = null;
  $('triv-invite-btn').addEventListener('click', async () => {
    if (!myCode) return;
    const url = inviteLink(myCode);
    const ok = typeof copyText === 'function' ? await copyText(url) : false;
    if (!ok) { window.prompt('Copy this invite link:', url); return; }
    $('triv-invite-label').textContent = 'Link copied!';
    $('triv-invite-btn').classList.add('copied');
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => {
      $('triv-invite-label').textContent = 'Or copy the invite link';
      $('triv-invite-btn').classList.remove('copied');
    }, 2000);
  });

  function leave() {
    if (!confirm('Leave this quiz?')) return;
    act('triv:leave');
    clearTrivSession();
    view = null; myCode = ''; teamPickerOpen = false;
    releaseWakeLock();
    $('triv-board-overlay').hidden = true;
    refreshRejoinBanner();
    showScreen('triv-home');
  }
  $('triv-lobby-leave').addEventListener('click', leave);

  // ── Game ──────────────────────────────────────────────────────────────
  function renderGame() {
    const v = view;
    renderBar(v);
    renderBanner(v);
    const c = $('triv-content');
    c.dataset.phase = v.phase;
    switch (v.phase) {
      case 'round-intro': c.innerHTML = introHtml(v); break;
      case 'question':    c.innerHTML = v.mode === 'host' ? (v.you.quizmaster ? hostQuestionHtml(v) : buzzerQuestionHtml(v)) : autoQuestionHtml(v); break;
      case 'reveal':      c.innerHTML = revealHtml(v); break;
      case 'round-end':   c.innerHTML = roundEndHtml(v); break;
      case 'game-over':   c.innerHTML = gameOverHtml(v); break;
      default:            c.innerHTML = '';
    }
    tickTimers();
    if ($('triv-board-overlay').hidden === false) renderBoard();
  }

  function renderBar(v) {
    const r = v.round;
    const qPart = (v.phase === 'question' || v.phase === 'reveal') ? ` · Q${r.qIndex + 1}/${r.count}` : '';
    $('triv-bar-left').innerHTML = v.phase === 'game-over'
      ? '<span class="triv-bar-round">Final scores</span>'
      : `<span class="triv-bar-round">Round ${r.index + 1}/${r.total}${qPart}</span><span class="triv-bar-cat">${esc(r.category.icon)} ${esc(r.category.name)}</span>`;
    const mine = teamById(v.you?.teamId);
    $('triv-bar-score').innerHTML = mine
      ? `<span class="triv-bar-crest">${esc(mine.crest)}</span><span class="triv-bar-pts">${mine.score}</span>`
      : `<span class="triv-bar-crest">🏆</span>`;
  }

  function renderBanner(v) {
    let html = '';
    if (v.mode === 'host' && !v.you.quizmaster && v.phase !== 'game-over' && (!v.host || !v.host.connected)) {
      html = `<div class="triv-banner warn">
        <span>${v.host ? `<strong>${esc(v.host.name)}</strong> (the host) dropped off. Waiting for them…` : 'The host left the quiz.'}</span>
        <button class="triv-link-btn" id="triv-claim-host">Take over hosting</button>
      </div>`;
    }
    $('triv-banner').innerHTML = html;
    $('triv-claim-host')?.addEventListener('click', () => {
      if (confirm('Take over as the host? You’ll see the answers, so you’ll stop playing for your team.')) act('triv:claim-host');
    });
  }

  function countdownHtml(v, label) {
    if (!v.phaseEndsAt) return '';
    return `<div class="triv-countdown" data-ends="${v.phaseEndsAt}" data-label="${esc(label)}"></div>`;
  }

  function nextBtn(v, label, cls = 'primary-btn') {
    return `<button class="${cls} triv-next" data-phase="${esc(v.phase)}" data-q="${v.round?.qIndex ?? ''}">${esc(label)}</button>`;
  }

  // ── Round intro ──
  function introHtml(v) {
    const r = v.round;
    const ctrl = isController(v) && (v.mode === 'auto' || v.you.quizmaster);
    return `<div class="triv-intro">
      <div class="triv-intro-round">Round ${r.index + 1} of ${r.total}</div>
      <div class="triv-intro-icon">${esc(r.category.icon)}</div>
      <div class="triv-intro-cat">${esc(r.category.name)}</div>
      <div class="triv-intro-sub">${r.count} questions${v.mode === 'auto' ? ` · ${v.config.seconds}s each` : ''}</div>
      ${v.mode === 'auto' ? countdownHtml(v, 'Starting in') : ''}
      ${ctrl ? nextBtn(v, v.mode === 'auto' ? 'Start now' : 'Start the round', v.mode === 'auto' ? 'secondary-btn' : 'primary-btn')
             : (v.mode === 'host' ? `<p class="triv-wait">Waiting for the host to start the round…</p>` : '')}
    </div>`;
  }

  function qMeta(v) {
    const r = v.round;
    return `<div class="triv-qmeta"><span>${esc(v.question?.category?.icon || '')} ${esc(v.question?.category?.name || '')}</span><span>Question ${r.qIndex + 1} of ${r.count}</span></div>`;
  }

  // ── Host mode: quizmaster ──
  function hostQuestionHtml(v) {
    const b = v.buzz || {};
    const out = (b.lockedOut || []).map(id => crestName(teamById(id), 'small')).join(' ');
    let panel;
    if (b.answeringTeamId) {
      const t = teamById(b.answeringTeamId);
      const rest = (b.order || []).slice(1).map((o, i) =>
        `<li><span class="triv-order-pos">${i + 2}</span>${crestName(teamById(o.teamId), 'small')}<span class="triv-order-delta">+${(o.delta / 1000).toFixed(2)}s</span></li>`).join('');
      panel = `<div class="triv-host-panel answering" style="border-color:${esc(t?.color || '#c9a96e')}">
        <div class="triv-hp-label">Buzzed first</div>
        <div class="triv-hp-team" style="color:${esc(t?.color || '#c9a96e')}">${esc(t?.crest || '')} ${esc(t?.name || '')}</div>
        <div class="triv-hp-who">${esc(b.answeringName || '')} is answering</div>
        ${rest ? `<ol class="triv-order">${rest}</ol>` : ''}
        <div class="triv-judge">
          <button class="vote-btn approve-btn" id="triv-correct">✓ Correct</button>
          <button class="vote-btn reject-btn" id="triv-wrong">✗ Wrong</button>
        </div>
      </div>`;
    } else if (b.open) {
      panel = `<div class="triv-host-panel open">
        <div class="triv-hp-pulse"></div>
        <div class="triv-hp-label">${b.deciding ? 'Checking who was first…' : 'Buzzers are open'}</div>
        ${out ? `<div class="triv-hp-out">Out: ${out}</div>` : ''}
      </div>`;
    } else {
      panel = `<div class="triv-host-panel">
        <div class="triv-hp-hint">${out ? 'Buzzers locked.' : 'Read it out, then open the buzzers.'}</div>
        ${out ? `<div class="triv-hp-out">Out: ${out}</div>` : ''}
        <button class="primary-btn triv-open-btn" id="triv-open-buzzers">🔔 Open buzzers</button>
      </div>`;
    }
    return `<div class="triv-qcard">
        ${qMeta(v)}
        <div class="triv-qtext">${esc(v.question.text)}</div>
        <div class="triv-answer-key"><span>Answer</span><strong>${esc(v.question.answer)}</strong></div>
      </div>
      ${panel}
      <div class="triv-host-foot">
        ${nextBtn(v, b.answeringTeamId ? 'Skip — show answer' : 'Nobody knows — show answer', 'secondary-btn')}
      </div>`;
  }

  // ── Host mode: player's buzzer ──
  function buzzerState(v) {
    const b = v.buzz || {};
    const mine = v.you.teamId;
    if (b.answeringTeamId) {
      if (b.answeringTeamId === mine) return { cls: 'won', label: 'You’re up!', caption: b.answeringName === v.you.name ? 'Say your answer!' : `${esc(b.answeringName)} buzzed. Answer!` };
      const t = teamById(b.answeringTeamId);
      return { cls: 'other', label: esc(t?.crest || '✋'), caption: `${crestName(t)} buzzed first`, color: t?.color };
    }
    if ((b.lockedOut || []).includes(mine)) return { cls: 'out', label: '✗', caption: 'Your team is out for this one.' };
    if (b.open && (b.yourTeamBuzzed || pendingBuzz)) return { cls: 'sent', label: 'Buzzed!', caption: 'Checking who was first…' };
    if (b.open) return { cls: 'open', label: 'BUZZ', caption: 'Tap now!' };
    return { cls: 'locked', label: '🔒', caption: 'Wait for the host.' };
  }

  function buzzerQuestionHtml(v) {
    const s = buzzerState(v);
    const q = v.question?.text
      ? `<div class="triv-qcard">${qMeta(v)}<div class="triv-qtext">${esc(v.question.text)}</div></div>`
      : `<div class="triv-qcard listen">${qMeta(v)}<div class="triv-qtext">🎧 Listen to the host</div></div>`;
    const out = (v.buzz?.wrong || []).length && s.cls !== 'out'
      ? `<p class="triv-muted triv-center">Missed it: ${(v.buzz.wrong).map(id => crestName(teamById(id), 'small')).join(' ')}</p>` : '';
    return `${q}
      <div class="triv-buzzer-wrap">
        <button class="triv-buzzer ${s.cls}" id="triv-buzzer" ${s.color ? `style="border-color:${esc(s.color)};box-shadow:0 0 40px ${esc(s.color)}55"` : ''}>
          <span class="triv-buzzer-label">${s.label}</span>
        </button>
        <div class="triv-buzzer-caption">${s.caption}</div>
        ${out}
      </div>`;
  }

  // pointerdown, not click: click fires on release, a tenth of a second or
  // more after the finger lands — longer than most buzzer races are decided by.
  $('triv-content').addEventListener('pointerdown', e => {
    const btn = e.target.closest('#triv-buzzer');
    if (!btn || !view?.buzz) return;
    e.preventDefault();
    // Use the event's own timestamp: it is when the finger landed, even if the
    // page was busy and this handler ran late.
    const nowPerf = performance.now();
    const stamp = (typeof e.timeStamp === 'number' && e.timeStamp > 0 && nowPerf - e.timeStamp < 1000 && e.timeStamp <= nowPerf) ? e.timeStamp : nowPerf;
    const b = view.buzz;
    if (!b.open) {
      if (b.answeringTeamId || (b.lockedOut || []).includes(view.you.teamId)) return;
      // Mashing before the host opens the buzzers costs you a moment, like a
      // false start. It does nothing on the server — only this phone waits.
      tooEarlyUntil = nowPerf + 1000;
      btn.classList.add('too-early');
      btn.querySelector('.triv-buzzer-label').textContent = 'Too early!';
      window.TriviaShow?.play('nope');
      setTimeout(() => { if (view?.phase === 'question') renderGame(); }, 1000);
      return;
    }
    if (nowPerf < tooEarlyUntil) return;
    if (b.yourTeamBuzzed || pendingBuzz) return;
    const trusted = clock.best && clock.best.rtt < 1500;
    const at = trusted ? stamp + clock.best.offset : null;
    pendingBuzz = { openId: b.openId };
    act('triv:buzz', { openId: b.openId, at });
    try { navigator.vibrate?.(25); } catch {}
    window.TriviaShow?.play('press');
    renderGame();
  });

  socket.on('triv:buzz-ack', ({ ok, openId }) => {
    if (!ok && pendingBuzz && pendingBuzz.openId === openId) { pendingBuzz = null; if (view) renderGame(); }
  });

  // ── Auto mode: multiple choice ──
  const LETTERS = ['A', 'B', 'C', 'D'];

  function autoQuestionHtml(v) {
    const q = v.question;
    const yours = v.answers?.yours;
    const total = v.config.seconds * 1000;
    const answered = v.answers?.answeredTeamIds?.length || 0;
    const teamCount = v.answers?.teamCount || 0;
    const choices = q.choices.map((c, i) => {
      const cls = yours ? (yours.choice === i ? ' chosen' : ' dim') : '';
      return `<button class="triv-choice${cls}" data-choice="${i}" ${yours ? 'disabled' : ''}>
        <span class="triv-choice-letter">${LETTERS[i]}</span><span class="triv-choice-text">${esc(c)}</span></button>`;
    }).join('');
    const status = yours
      ? `🔒 Locked in <strong>${LETTERS[yours.choice]}</strong>${yours.by !== v.you.name ? ` by ${esc(yours.by)}` : ''} · ${answered}/${teamCount} teams in`
      : `First tap counts · ${answered}/${teamCount} teams in`;
    return `<div class="triv-timer" data-ends="${v.phaseEndsAt}" data-total="${total}"><div class="triv-timer-fill"></div><span class="triv-timer-num"></span></div>
      <div class="triv-qcard">${qMeta(v)}<div class="triv-qtext">${esc(q.text)}</div></div>
      <div class="triv-choices">${choices}</div>
      <p class="triv-answer-status">${status}</p>
      ${isController(v) ? `<div class="triv-host-foot">${nextBtn(v, 'Stop the clock', 'secondary-btn')}</div>` : ''}`;
  }

  $('triv-content').addEventListener('click', e => {
    const choice = e.target.closest('[data-choice]');
    if (choice && !choice.disabled && view?.phase === 'question' && view.mode === 'auto') {
      act('triv:answer', { choice: +choice.dataset.choice });
      // Show the pick at once; the server's state confirms (or overrides) it.
      document.querySelectorAll('.triv-choice').forEach(b => { b.disabled = true; b.classList.add(b === choice ? 'chosen' : 'dim'); });
      try { navigator.vibrate?.(20); } catch {}
      return;
    }
    const next = e.target.closest('.triv-next');
    if (next) {
      next.disabled = true;
      act('triv:next', { phase: next.dataset.phase, qIndex: next.dataset.q === '' ? undefined : +next.dataset.q });
      return;
    }
    if (e.target.closest('#triv-open-buzzers')) { e.target.closest('button').disabled = true; act('triv:open-buzzers'); return; }
    if (e.target.closest('#triv-correct')) { act('triv:judge', { correct: true, teamId: view.buzz?.answeringTeamId }); disableJudge(); return; }
    if (e.target.closest('#triv-wrong'))   { act('triv:judge', { correct: false, teamId: view.buzz?.answeringTeamId }); disableJudge(); return; }
    if (e.target.closest('#triv-play-again')) { act('triv:play-again'); return; }
    if (e.target.closest('#triv-leave-end')) { leave(); return; }
  });

  function disableJudge() { ['triv-correct', 'triv-wrong'].forEach(id => { const b = $(id); if (b) b.disabled = true; }); }

  socket.on('triv:answer-rejected', ({ reason }) => {
    if (reason === 'too-late' && typeof showToast === 'function') showToast('Too late — time was up.');
  });

  // ── Reveal ──
  function revealHtml(v) {
    const q = v.question || {};
    const res = v.result || { correctTeamIds: [], gained: {} };
    const ctrl = isController(v) && (v.mode === 'auto' || v.you.quizmaster);
    const lastQ = v.round.qIndex + 1 >= v.round.count;
    const lastRound = v.round.index + 1 >= v.round.total;
    const nextLabel = !lastQ ? 'Next question →' : (lastRound ? 'Final scores →' : 'End of round →');

    let body;
    if (v.mode === 'host') {
      const winner = teamById(res.correctTeamIds[0]);
      const missed = (res.wrongTeamIds || []).map(id => crestName(teamById(id), 'small')).join(' ');
      body = `<div class="triv-qcard">${qMeta(v)}${q.text ? `<div class="triv-qtext small">${esc(q.text)}</div>` : ''}
          <div class="triv-answer-key big"><span>Answer</span><strong>${esc(q.answer || '')}</strong></div></div>
        ${winner
          ? `<div class="triv-outcome good" style="border-color:${esc(winner.color)}"><div class="triv-outcome-team" style="color:${esc(winner.color)}">${esc(winner.crest)} ${esc(winner.name)}</div><div class="triv-outcome-sub">got it${res.answeredBy ? ` · ${esc(res.answeredBy)}` : ''}</div><div class="triv-outcome-pts">+${res.gained[winner.id] || 0}</div></div>`
          : `<div class="triv-outcome none"><div class="triv-outcome-team">Nobody got this one</div></div>`}
        ${missed ? `<p class="triv-muted triv-center">Missed: ${missed}</p>` : ''}`;
    } else {
      const byTeam = res.byTeam || {};
      const choices = (q.choices || []).map((c, i) => {
        const pickers = Object.entries(byTeam).filter(([, a]) => a.choice === i).map(([id]) => teamById(id)).filter(Boolean);
        const right = i === q.correctIndex;
        return `<div class="triv-choice revealed${right ? ' right' : ''}${pickers.some(t => t.id === v.you.teamId) && !right ? ' wrong' : ''}">
          <span class="triv-choice-letter">${right ? '✓' : LETTERS[i]}</span><span class="triv-choice-text">${esc(c)}</span>
          <span class="triv-choice-pickers">${pickers.map(t => `<span title="${esc(t.name)}">${esc(t.crest)}</span>`).join('')}</span></div>`;
      }).join('');
      const mine = byTeam[v.you.teamId];
      const verdict = !v.you.teamId ? '' : !mine
        ? `<div class="triv-outcome none"><div class="triv-outcome-team">No answer from your team</div></div>`
        : mine.correct
          ? `<div class="triv-outcome good"><div class="triv-outcome-team">Correct!</div><div class="triv-outcome-pts">+${mine.points}</div></div>`
          : `<div class="triv-outcome bad"><div class="triv-outcome-team">Not this time</div></div>`;
      const gotIt = res.correctTeamIds.map(id => `${crestName(teamById(id), 'small')} <span class="triv-plus">+${res.gained[id]}</span>`).join(' ');
      body = `<div class="triv-qcard">${qMeta(v)}<div class="triv-qtext small">${esc(q.text || '')}</div></div>
        <div class="triv-choices">${choices}</div>
        ${verdict}
        <p class="triv-muted triv-center">${gotIt ? `Got it: ${gotIt}` : 'Nobody got this one.'}</p>`;
    }
    return `${body}
      ${v.mode === 'auto' ? countdownHtml(v, lastQ ? (lastRound ? 'Final scores in' : 'Round results in') : 'Next question in') : ''}
      ${ctrl ? `<div class="triv-host-foot">${nextBtn(v, nextLabel, v.mode === 'auto' ? 'secondary-btn' : 'primary-btn')}</div>`
             : (v.mode === 'host' ? '<p class="triv-wait">Waiting for the host…</p>' : '')}`;
  }

  // ── Round end ──
  function boardRows(v, { roundIdx = null, adjust = false } = {}) {
    const rows = standings(v.teams).map(t => {
      const roundPts = roundIdx !== null ? (v.roundScores?.[roundIdx]?.[t.id] || 0) : null;
      const mine = t.id === v.you?.teamId;
      return `<div class="triv-board-row${mine ? ' mine' : ''}" style="border-left-color:${esc(t.color)}">
        <span class="triv-board-rank">${t.rank}</span>
        <span class="triv-board-crest">${esc(t.crest)}</span>
        <span class="triv-board-name">${esc(t.name)}</span>
        ${roundPts !== null ? `<span class="triv-board-round">${roundPts ? '+' + roundPts : '—'}</span>` : ''}
        ${adjust ? `<span class="triv-adjust"><button class="hs-btn" data-adjust="${esc(t.id)}" data-delta="-50">−</button><button class="hs-btn" data-adjust="${esc(t.id)}" data-delta="50">+</button></span>` : ''}
        <span class="triv-board-score">${t.score}</span>
      </div>`;
    }).join('');
    return `<div class="triv-board">${rows || '<p class="triv-muted">No teams.</p>'}</div>`;
  }

  function roundEndHtml(v) {
    const r = v.round;
    const ctrl = isController(v) && (v.mode === 'auto' || v.you.quizmaster);
    const nextCat = r.plan[r.index + 1];
    return `<div class="triv-phase-head">
        <div class="triv-intro-round">End of Round ${r.index + 1}</div>
        <div class="triv-phase-title">${esc(r.category.icon)} ${esc(r.category.name)}</div>
      </div>
      ${boardRows(v, { roundIdx: r.index })}
      ${nextCat ? `<p class="triv-muted triv-center">Up next: ${esc(nextCat.icon)} ${esc(nextCat.name)}</p>` : ''}
      ${v.mode === 'auto' ? countdownHtml(v, 'Next round in') : ''}
      ${ctrl ? `<div class="triv-host-foot">${nextBtn(v, `Start Round ${r.index + 2} →`, v.mode === 'auto' ? 'secondary-btn' : 'primary-btn')}</div>`
             : (v.mode === 'host' ? '<p class="triv-wait">Waiting for the host…</p>' : '')}`;
  }

  // ── Game over ──
  function gameOverHtml(v) {
    const st = standings(v.teams);
    const top = st.filter(t => t.rank === 1 && st.length);
    const mine = st.find(t => t.id === v.you?.teamId);
    const headline = !top.length ? 'Thanks for playing'
      : top.length > 1 ? 'It’s a tie!'
      : `${esc(top[0].name)} win!`;
    const podium = st.slice(0, 3).map(t => `
      <div class="triv-podium-step p${t.rank}" style="border-color:${esc(t.color)}">
        <div class="triv-podium-crest">${esc(t.crest)}</div>
        <div class="triv-podium-name" style="color:${esc(t.color)}">${esc(t.name)}</div>
        <div class="triv-podium-score">${t.score}</div>
        <div class="triv-podium-rank">${['', '1st', '2nd', '3rd'][t.rank] || t.rank + 'th'}</div>
      </div>`).join('');
    const rounds = v.round.plan.map((c, i) => `<th title="${esc(c.name)}">${esc(c.icon)}</th>`).join('');
    const table = st.map(t => `<tr${t.id === v.you?.teamId ? ' class="mine"' : ''}><td>${esc(t.crest)} ${esc(t.name)}</td>${v.round.plan.map((_, i) => `<td>${v.roundScores?.[i]?.[t.id] || 0}</td>`).join('')}<td><strong>${t.score}</strong></td></tr>`).join('');
    const ctrl = isController(v);
    return `<div class="triv-final">
        <div class="triv-final-trophy">🏆</div>
        <div class="triv-final-title">${headline}</div>
        ${mine ? `<div class="triv-final-you">Your team finished <strong>${['', '1st', '2nd', '3rd'][mine.rank] || mine.rank + 'th'}</strong> with ${mine.score} points</div>` : ''}
      </div>
      <div class="triv-podium">${podium}</div>
      <div class="triv-rounds-table-wrap"><table class="triv-rounds-table"><thead><tr><th>Team</th>${rounds}<th>Total</th></tr></thead><tbody>${table}</tbody></table></div>
      <div class="triv-host-foot">
        ${ctrl ? '<button class="primary-btn" id="triv-play-again">Play again</button>' : '<p class="triv-wait">The host can start another game from here.</p>'}
        <button class="secondary-btn" id="triv-leave-end">Leave</button>
      </div>`;
  }

  // ── Scoreboard overlay ──
  $('triv-bar-score').addEventListener('click', () => { renderBoard(); $('triv-board-overlay').hidden = false; });
  $('triv-board-close').addEventListener('click', () => { $('triv-board-overlay').hidden = true; });
  $('triv-board-overlay').addEventListener('click', e => {
    if (e.target.id === 'triv-board-overlay') { $('triv-board-overlay').hidden = true; return; }
    const adj = e.target.closest('[data-adjust]');
    if (adj) { act('triv:adjust-score', { teamId: adj.dataset.adjust, delta: +adj.dataset.delta }); return; }
    if (e.target.closest('#triv-end-now')) {
      if (confirm('End the quiz now and show final scores?')) { act('triv:end-game'); $('triv-board-overlay').hidden = true; }
      return;
    }
    if (e.target.closest('#triv-board-leave')) leave();
  });

  function renderBoard() {
    const v = view;
    if (!v) return;
    const adjust = !!v.you?.quizmaster;
    $('triv-board-body').innerHTML = boardRows(v, { adjust })
      + (adjust ? '<p class="triv-muted triv-center">Use − / + to fix a score by 50.</p>' : '');
    const ctrl = isController(v) && (v.mode === 'auto' || v.you.quizmaster) && v.phase !== 'game-over';
    $('triv-board-foot').innerHTML = `
      ${ctrl ? '<button class="secondary-btn small" id="triv-end-now">End quiz now</button>' : ''}
      <button class="secondary-btn small" id="triv-board-leave">Leave quiz</button>`;
  }

  // ── Timers ──
  function tickTimers() {
    const now = serverNow();
    document.querySelectorAll('#triv-content [data-ends]').forEach(el => {
      const ends = +el.dataset.ends;
      const left = Math.max(0, ends - now);
      if (el.classList.contains('triv-timer')) {
        const total = +el.dataset.total || 1;
        el.querySelector('.triv-timer-fill').style.width = `${(left / total) * 100}%`;
        const secs = Math.ceil(left / 1000);
        el.querySelector('.triv-timer-num').textContent = secs;
        el.classList.toggle('low', left < 5000);
        if (left < 5000 && secs > 0 && +el.dataset.lastTick !== secs) {
          if (el.dataset.lastTick) window.TriviaShow?.play('tick');
          el.dataset.lastTick = secs;
        }
      } else {
        el.textContent = `${el.dataset.label} ${Math.ceil(left / 1000)}`;
      }
    });
  }
  setInterval(() => { if (onGameScreen()) tickTimers(); }, 100);
})();
