// h2h.js — client for Head to Head, the 1 vs 1 quiz. Shares the page's
// socket, showScreen, esc, copyText and playerToken with client.js.
//
// The server is authoritative: this file renders the view it is sent
// ('h2h:state') and turns taps into events. It never decides who was right.
(function () {
  'use strict';

  const SESSION_KEY = 'h2h-session';
  function saveSession(d) { try { appStorage.setItem(SESSION_KEY, JSON.stringify(d)); } catch {} }
  function loadSession()  { try { return JSON.parse(appStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function clearSession() { try { appStorage.removeItem(SESSION_KEY); } catch {} }

  const $ = id => document.getElementById(id);

  let view = null;
  let myCode = '';
  let userAskedRejoin = false;
  // When the current question appeared on this phone, for the speed score.
  let shown = { key: '', at: 0 };
  // The local moment the current phase ends (from the server's remainingMs).
  let endsAt = 0;
  let clockTimer = null;

  function act(event, extra = {}) {
    socket.emit(event, { code: myCode, token: playerToken, ...extra });
  }

  // ── Home ──────────────────────────────────────────────────────────────
  $('pick-h2h').addEventListener('click', () => { refreshRejoinBanner(); showScreen('h2h-home'); });

  function refreshRejoinBanner() {
    const s = loadSession();
    $('h2h-rejoin-banner').hidden = !(s?.code && s?.name);
    if (s?.name) $('h2h-rejoin-name').textContent = s.name;
  }
  refreshRejoinBanner();

  $('h2h-btn-rejoin').addEventListener('click', () => {
    const s = loadSession();
    if (!s?.code) return;
    myCode = s.code;
    userAskedRejoin = true;
    socket.emit('h2h:rejoin-room', { code: s.code, token: playerToken });
  });

  function lastName() {
    try { return loadSession()?.name || JSON.parse(appStorage.getItem('h2h-name') || '""') || ''; } catch { return ''; }
  }

  $('h2h-btn-create').addEventListener('click', () => {
    $('h2h-create-error').textContent = '';
    if (!$('h2h-create-name').value) $('h2h-create-name').value = lastName();
    showScreen('h2h-create');
    setTimeout(() => $('h2h-create-name').focus(), 60);
  });

  $('h2h-btn-join').addEventListener('click', () => {
    $('h2h-join-error').textContent = '';
    if (!$('h2h-join-name').value) $('h2h-join-name').value = lastName();
    showScreen('h2h-join');
  });

  function rememberName(name) { try { appStorage.setItem('h2h-name', JSON.stringify(name)); } catch {} }

  $('h2h-create-submit').addEventListener('click', () => {
    const name = $('h2h-create-name').value.trim();
    if (!name) { $('h2h-create-error').textContent = 'Enter your name.'; return; }
    rememberName(name);
    socket.emit('h2h:create-room', { name, token: playerToken });
  });

  $('h2h-join-submit').addEventListener('click', () => {
    const code = $('h2h-join-code').value.trim().toUpperCase();
    const name = $('h2h-join-name').value.trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) { $('h2h-join-error').textContent = 'Enter the 5-letter code.'; return; }
    if (!name) { $('h2h-join-error').textContent = 'Enter your name.'; return; }
    rememberName(name);
    myCode = code;
    socket.emit('h2h:join-room', { code, name, token: playerToken });
  });

  ['h2h-join-code', 'h2h-join-name'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('h2h-join-submit').click();
  }));
  $('h2h-create-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('h2h-create-submit').click(); });

  // Invite links look like /?room=CODE&game=h2h; /?game=h2h alone opens home.
  (function deepLink() {
    const p = new URLSearchParams(location.search);
    if ((p.get('game') || '').toLowerCase() !== 'h2h') return;
    const code = (p.get('room') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { refreshRejoinBanner(); showScreen('h2h-home'); return; }
    if (loadSession()?.code === code) return;   // a reload mid-match: auto-rejoin handles it
    clearSession();
    refreshRejoinBanner();
    $('h2h-join-code').value = code;
    showScreen('h2h-join');
    const name = (p.get('name') || '').trim().slice(0, 20) || lastName();
    if (name) $('h2h-join-name').value = name;
    if (p.get('name')) setTimeout(() => $('h2h-join-submit').click(), 150);
    else setTimeout(() => $('h2h-join-name').focus(), 60);
  })();

  // ── Connection ────────────────────────────────────────────────────────
  function otherGameSaved() {
    try {
      return ['avalon-session', 'imposter-session', 'trivia-session', 'council-session'].some(k => appStorage.getItem(k));
    } catch { return false; }
  }

  socket.on('connect', () => {
    const s = loadSession();
    if (!s?.code || otherGameSaved()) return;
    myCode = s.code;
    socket.emit('h2h:rejoin-room', { code: s.code, token: playerToken });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !socket.connected || !loadSession()?.code) return;
    act('h2h:request-sync');
  });

  socket.on('h2h:desync', () => {
    const s = loadSession();
    if (s?.code) socket.emit('h2h:rejoin-room', { code: s.code, token: playerToken });
  });

  socket.on('h2h:rejoin-error', msg => {
    clearSession();
    refreshRejoinBanner();
    if (userAskedRejoin) alert(msg);
    userAskedRejoin = false;
  });

  socket.on('h2h:error', msg => {
    const active = document.querySelector('.screen.active')?.id || '';
    const target = { 'screen-h2h-create': 'h2h-create-error', 'screen-h2h-join': 'h2h-join-error' }[active];
    if (target) $(target).textContent = msg;
    else if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  });

  socket.on('h2h:joined', ({ code, name }) => {
    myCode = code;
    saveSession({ code, name });
    userAskedRejoin = false;
    refreshRejoinBanner();
  });

  socket.on('h2h:state', v => {
    const prev = view;
    view = v;
    myCode = v.code;
    if (v.you) saveSession({ code: v.code, name: v.you.name });
    endsAt = v.remainingMs == null ? 0 : performance.now() + v.remainingMs;
    if (v.phase === 'question') {
      const key = v.code + ':' + v.index + ':' + (v.total || 0);
      // First sight of this question: start its stopwatch where the server's
      // clock says it is (late on a reconnect, zero normally).
      if (shown.key !== key) shown = { key, at: performance.now() - (v.rules.answerMs - (v.remainingMs ?? v.rules.answerMs)) };
    }
    if (v.phase === 'reveal' && prev?.phase !== 'reveal') buzz(v);
    route();
  });

  function buzz(v) {
    const mine = v.reveal?.picks?.[v.you?.pid];
    try { navigator.vibrate?.(mine?.correct ? 40 : [60, 50, 60]); } catch {}
  }

  function route() {
    const v = view;
    if (!v) return;
    if (v.state === 'lobby') { renderLobby(); showIfNot('h2h-lobby'); return; }
    renderGame();
    showIfNot('h2h-game');
  }

  function showIfNot(id) {
    if (!$('screen-' + id).classList.contains('active')) showScreen(id);
  }

  const me = () => view.players.find(p => p.you);
  const them = () => view.players.find(p => !p.you);

  // ── Lobby ─────────────────────────────────────────────────────────────
  const inviteLink = code => `${location.origin}/?room=${encodeURIComponent(code)}&game=h2h`;
  let qrFor = '';

  function versus(you, opp, { scores = false } = {}) {
    const side = (p, cls, empty) => `
      <div class="h2h-side ${cls}${p && !p.connected ? ' away' : ''}">
        <div class="h2h-avatar">${p ? esc(p.name.slice(0, 1).toUpperCase()) : '?'}</div>
        <div class="h2h-name">${p ? esc(p.name) : empty}</div>
        ${scores && p ? `<div class="h2h-score">${p.score}</div>` : ''}
      </div>`;
    return `<div class="h2h-versus">${side(you, 'you', 'You')}<div class="h2h-vs">VS</div>${side(opp, 'them', 'Waiting…')}</div>`;
  }

  function renderLobby() {
    const v = view;
    $('h2h-lobby-code').textContent = v.code;
    const opp = them();
    $('h2h-lobby-versus').innerHTML = versus(me(), opp);
    $('h2h-invite').hidden = !!opp;
    if (!opp && qrFor !== v.code) {
      qrFor = v.code;
      $('h2h-qr-image').src = `/qr?data=${encodeURIComponent(inviteLink(v.code))}`;
      const reachable = typeof originIsReachableByOthers === 'function' ? originIsReachableByOthers() : true;
      $('h2h-qr-warning').hidden = reachable;
      if (!reachable) $('h2h-qr-warning').textContent = 'You’re on localhost, so this code only works on this machine.';
    }
    const cat = v.category;
    $('h2h-lobby-start').innerHTML = opp
      ? `<button class="h2h-btn h2h-btn-main h2h-go" id="h2h-start">Play ${esc(cat?.icon || '')} ${esc(cat?.name || '')}</button>`
      : `<p class="h2h-wait">Send your friend the code <b>${esc(v.code)}</b></p>`;
    $('h2h-start')?.addEventListener('click', () => act('h2h:start'));
    $('h2h-cats').innerHTML = (v.categories || []).map(c => `
      <button class="h2h-cat${cat?.id === c.id ? ' picked' : ''}" data-cat="${esc(c.id)}">
        <span class="h2h-cat-icon">${esc(c.icon)}</span><span class="h2h-cat-name">${esc(c.name)}</span>
      </button>`).join('');
    $('h2h-cats').querySelectorAll('[data-cat]').forEach(b =>
      b.addEventListener('click', () => act('h2h:category', { category: b.dataset.cat })));
  }

  let inviteTimer = null;
  $('h2h-invite-btn').addEventListener('click', async () => {
    if (!myCode) return;
    const url = inviteLink(myCode);
    if (navigator.share) { try { await navigator.share({ title: 'Head to Head', text: 'Quiz me!', url }); return; } catch {} }
    const ok = typeof copyText === 'function' ? await copyText(url) : false;
    if (!ok) { window.prompt('Copy this invite link:', url); return; }
    $('h2h-invite-label').textContent = 'Link copied!';
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => { $('h2h-invite-label').textContent = 'Copy invite link'; }, 2000);
  });

  function leave() {
    if (view?.state === 'playing' && view.phase !== 'game-over' && !confirm('Leave this match?')) return;
    act('h2h:leave');
    clearSession();
    view = null; myCode = ''; qrFor = '';
    stopClock();
    refreshRejoinBanner();
    showScreen('h2h-home');
  }
  $('h2h-lobby-leave').addEventListener('click', leave);

  // ── Match ─────────────────────────────────────────────────────────────
  const LETTERS = ['A', 'B', 'C', 'D'];

  function scoreBar() {
    const you = me(), opp = them();
    const pill = (p, cls) => `
      <div class="h2h-pill ${cls}${p && !p.connected ? ' away' : ''}">
        <span class="h2h-pill-name">${p ? esc(p.name) : '—'}</span>
        <span class="h2h-pill-score">${p ? p.score : 0}</span>
      </div>`;
    return `<div class="h2h-scorebar">${pill(you, 'you')}<div class="h2h-qno">${view.question ? `${view.question.n}/${view.total}` : ''}</div>${pill(opp, 'them')}</div>`;
  }

  function renderGame() {
    const v = view;
    const body = $('h2h-game-body');
    stopClock();
    if (v.phase === 'intro') {
      body.innerHTML = `
        <div class="h2h-intro">
          <div class="h2h-intro-cat"><span>${esc(v.category?.icon || '')}</span>${esc(v.category?.name || '')}</div>
          ${versus(me(), them())}
          <p class="h2h-ready">Get ready…</p>
        </div>`;
      return;
    }
    if (v.phase === 'question' || v.phase === 'reveal') { renderQuestion(body); return; }
    if (v.phase === 'game-over') { renderEnd(body); return; }
  }

  function renderQuestion(body) {
    const v = view, q = v.question;
    const rev = v.phase === 'reveal' ? v.reveal : null;
    const you = me(), opp = them();
    const myPick = rev ? rev.picks[you.pid] : null;
    const oppPick = rev && opp ? rev.picks[opp.pid] : null;
    const chosen = rev ? myPick?.choice : v.yourChoice;
    const oppAnswered = !!opp && (v.answered || []).includes(opp.pid);

    const opts = q.options.map((o, i) => {
      let cls = 'h2h-opt';
      if (rev) {
        if (i === rev.answer) cls += ' right';
        else if (i === chosen) cls += ' wrong';
        else cls += ' dim';
      } else if (chosen === i) cls += ' locked';
      else if (chosen != null) cls += ' dim';
      const tags = rev ? [
        myPick?.choice === i ? `<span class="h2h-tag you">You${myPick.points ? ' +' + myPick.points : ''}</span>` : '',
        oppPick?.choice === i ? `<span class="h2h-tag them">${esc(opp.name)}${oppPick.points ? ' +' + oppPick.points : ''}</span>` : '',
      ].join('') : '';
      return `<button class="${cls}" data-choice="${i}" ${rev || chosen != null ? 'disabled' : ''}>
        <span class="h2h-opt-letter">${LETTERS[i]}</span><span class="h2h-opt-text">${esc(o)}</span>${tags ? `<span class="h2h-tags">${tags}</span>` : ''}
      </button>`;
    }).join('');

    let status;
    if (rev) {
      const line = myPick?.choice == null ? 'Too slow!' : myPick.correct ? `Correct! +${myPick.points}` : 'Wrong';
      status = `<div class="h2h-status ${myPick?.correct ? 'good' : 'bad'}">${line}</div>`;
    } else if (chosen != null) {
      status = `<div class="h2h-status">${oppAnswered ? 'Both locked in' : `Waiting for ${esc(opp?.name || 'them')}…`}</div>`;
    } else {
      status = `<div class="h2h-status h2h-opp-flag">${oppAnswered ? `${esc(opp.name)} answered!` : '&nbsp;'}</div>`;
    }

    body.innerHTML = `
      ${scoreBar()}
      <div class="h2h-timer${rev ? ' done' : ''}"><div class="h2h-timer-fill" id="h2h-timer-fill"></div><span class="h2h-timer-num" id="h2h-timer-num"></span></div>
      ${q.double ? `<div class="h2h-double">Last question · Double points</div>` : ''}
      <div class="h2h-q">
        ${q.art ? `<div class="h2h-art">${esc(q.art)}</div>` : ''}
        <p class="h2h-q-text">${esc(q.text)}</p>
      </div>
      <div class="h2h-opts">${opts}</div>
      ${status}`;

    body.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => {
      if (view.phase !== 'question' || view.yourChoice != null) return;
      const choice = Number(b.dataset.choice);
      view.yourChoice = choice;                 // lock it in on screen at once
      act('h2h:answer', { choice, index: view.index, ms: Math.round(performance.now() - shown.at) });
      renderQuestion(body);
      startClock();
    }));
    if (!rev) startClock();
    else { $('h2h-timer-fill').style.width = '0%'; }
  }

  function startClock() {
    stopClock();
    const total = view.rules.answerMs;
    const fill = $('h2h-timer-fill'), num = $('h2h-timer-num');
    const draw = () => {
      const left = Math.max(0, endsAt - performance.now());
      if (fill) {
        fill.style.width = (100 * left / total).toFixed(1) + '%';
        fill.classList.toggle('low', left < 3000);
      }
      if (num) num.textContent = Math.ceil(left / 1000);
      if (left <= 0) stopClock();
    };
    draw();
    clockTimer = setInterval(draw, 100);
  }
  function stopClock() { clearInterval(clockTimer); clockTimer = null; }

  function renderEnd(body) {
    const v = view;
    const you = me(), opp = them();
    const youWon = v.winner === you.pid;
    const title = v.winner === 'tie' ? 'It’s a tie!' : youWon ? 'You win!' : `${esc(opp?.name || 'They')} wins`;
    const mark = p => !p ? '' : p.correct ? `<span class="h2h-mark good">✓</span>` : `<span class="h2h-mark bad">${p.choice == null ? '–' : '✗'}</span>`;
    const recap = (v.recap || []).map(r => `
      <div class="h2h-recap-row">
        ${mark(r.picks[you.pid])}
        <div class="h2h-recap-q"><span class="h2h-recap-text">${r.art ? esc(r.art) + ' ' : ''}${esc(r.text)}</span><span class="h2h-recap-a">${esc(r.answer)}</span></div>
        ${opp ? mark(r.picks[opp.pid]) : ''}
      </div>`).join('');
    body.innerHTML = `
      <div class="h2h-end ${v.winner === 'tie' ? 'tie' : youWon ? 'won' : 'lost'}">
        <div class="h2h-end-cat">${esc(v.category?.icon || '')} ${esc(v.category?.name || '')}</div>
        <h2 class="h2h-end-title">${title}</h2>
        ${versus(you, opp, { scores: true })}
        <div class="h2h-end-buttons">
          <button class="h2h-btn h2h-btn-main" id="h2h-rematch" ${opp && opp.connected ? '' : 'disabled'}>Rematch</button>
          <button class="h2h-btn h2h-btn-alt" id="h2h-newtopic">New topic</button>
        </div>
        <div class="h2h-recap">
          <div class="h2h-recap-head"><span>You</span><span>Answers</span><span>${esc(opp?.name || '')}</span></div>
          ${recap}
        </div>
        <button class="h2h-link-btn" id="h2h-end-leave">Leave</button>
      </div>`;
    $('h2h-rematch').addEventListener('click', () => act('h2h:again', { mode: 'rematch' }));
    $('h2h-newtopic').addEventListener('click', () => act('h2h:again', { mode: 'lobby' }));
    $('h2h-end-leave').addEventListener('click', leave);
  }
})();
