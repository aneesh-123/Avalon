// council.js — client for The Council. Shares the page's socket, showScreen,
// esc, copyText and playerToken with client.js; everything else is its own.
//
// The server is authoritative: this file renders the per-player view it is
// sent ('cn:state') and turns taps into events. It never decides an outcome.
(function () {
  'use strict';

  const SESSION_KEY = 'council-session';
  function saveSession(d) { try { appStorage.setItem(SESSION_KEY, JSON.stringify(d)); } catch {} }
  function loadSession()  { try { return JSON.parse(appStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function clearSession() { try { appStorage.removeItem(SESSION_KEY); } catch {} }

  const $ = id => document.getElementById(id);

  let view = null;
  let myCode = '';
  let userAskedRejoin = false;
  // The leader's half-made plan, kept here until they tap Propose.
  const draft = { round: 0, option: null, partner: null };
  let rolePeek = false;

  function act(event, extra = {}) {
    socket.emit(event, { code: myCode, token: playerToken, ...extra });
  }

  // ── Picker + home ─────────────────────────────────────────────────────
  $('pick-council')?.addEventListener('click', () => { refreshRejoinBanner(); showScreen('cn-home'); });

  function refreshRejoinBanner() {
    const s = loadSession();
    $('cn-rejoin-banner').hidden = !(s?.code && s?.name);
    if (s?.name) $('cn-rejoin-name').textContent = s.name;
  }
  refreshRejoinBanner();

  $('cn-btn-rejoin').addEventListener('click', () => {
    const s = loadSession();
    if (!s?.code) return;
    myCode = s.code;
    userAskedRejoin = true;
    socket.emit('cn:rejoin-room', { code: s.code, token: playerToken });
  });

  $('cn-btn-create').addEventListener('click', () => {
    $('cn-create-error').textContent = '';
    const s = loadSession();
    if (s?.name && !$('cn-create-name').value) $('cn-create-name').value = s.name;
    showScreen('cn-create');
    setTimeout(() => $('cn-create-name').focus(), 60);
  });

  $('cn-btn-join').addEventListener('click', () => {
    $('cn-join-error').textContent = '';
    showScreen('cn-join');
  });

  $('cn-create-submit').addEventListener('click', () => {
    const name = $('cn-create-name').value.trim();
    if (!name) { $('cn-create-error').textContent = 'Enter your name.'; return; }
    socket.emit('cn:create-room', { name, token: playerToken });
  });

  $('cn-join-submit').addEventListener('click', () => {
    const code = $('cn-join-code').value.trim().toUpperCase();
    const name = $('cn-join-name').value.trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) { $('cn-join-error').textContent = 'Enter the 5-letter room code.'; return; }
    if (!name) { $('cn-join-error').textContent = 'Enter your name.'; return; }
    myCode = code;
    socket.emit('cn:join-room', { code, name, token: playerToken });
  });

  ['cn-join-code', 'cn-join-name'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('cn-join-submit').click();
  }));
  $('cn-create-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('cn-create-submit').click(); });

  // Invite links look like /?room=CODE&game=council.
  (function deepLink() {
    const p = new URLSearchParams(location.search);
    if ((p.get('game') || '').toLowerCase() !== 'council') return;
    const code = (p.get('room') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return;
    if (loadSession()?.code === code) return;   // a reload mid-game: auto-rejoin handles it
    clearSession();
    refreshRejoinBanner();
    $('cn-join-code').value = code;
    showScreen('cn-join');
    const name = (p.get('name') || '').trim().slice(0, 20);
    if (name) { $('cn-join-name').value = name; setTimeout(() => $('cn-join-submit').click(), 150); }
    else setTimeout(() => $('cn-join-name').focus(), 60);
  })();

  // ── Connection ────────────────────────────────────────────────────────
  function otherGameSaved() {
    try {
      return ['avalon-session', 'imposter-session', 'trivia-session'].some(k => appStorage.getItem(k));
    } catch { return false; }
  }

  socket.on('connect', () => {
    const s = loadSession();
    if (!s?.code || otherGameSaved()) return;
    myCode = s.code;
    socket.emit('cn:rejoin-room', { code: s.code, token: playerToken });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !socket.connected || !loadSession()?.code) return;
    act('cn:request-sync');
  });

  socket.on('cn:desync', () => {
    const s = loadSession();
    if (s?.code) socket.emit('cn:rejoin-room', { code: s.code, token: playerToken });
  });

  socket.on('cn:rejoin-error', msg => {
    clearSession();
    refreshRejoinBanner();
    if (userAskedRejoin) alert(msg);
    userAskedRejoin = false;
  });

  socket.on('cn:error', msg => {
    const active = document.querySelector('.screen.active')?.id || '';
    const target = { 'screen-cn-create': 'cn-create-error', 'screen-cn-join': 'cn-join-error' }[active];
    if (target) $(target).textContent = msg;
    else if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  });

  socket.on('cn:joined', ({ code, name }) => {
    myCode = code;
    saveSession({ code, name });
    userAskedRejoin = false;
    refreshRejoinBanner();
  });

  socket.on('cn:state', v => {
    const prev = view;
    view = v;
    myCode = v.code;
    if (v.you) saveSession({ code: v.code, name: v.you.name });
    if (draft.round !== v.round || v.phase !== 'propose') { draft.round = v.round; draft.option = null; draft.partner = null; }
    // Roles are private: once the reveal is over, hide yours until you tap.
    if (prev?.phase === 'roles' && v.phase !== 'roles') rolePeek = false;
    // Your turn: a buzz for anyone looking away.
    if (yourTurn(v) && !yourTurn(prev)) { try { navigator.vibrate?.(60); } catch {} }
    route();
  });

  function yourTurn(v) {
    if (!v || v.state !== 'playing' || !v.you) return false;
    const me = v.you.pid;
    if (v.phase === 'propose') return v.leader === me;
    if (v.phase === 'vote') return v.yourVote === null;
    if (v.phase === 'act') return !!v.proposal && (v.proposal.leader === me || v.proposal.partner === me) && !v.yourAction;
    return false;
  }

  function route() {
    const v = view;
    if (!v) return;
    if (v.state === 'lobby') { renderLobby(); showIfNot('cn-lobby'); return; }
    renderGame();
    showIfNot('cn-game');
  }

  function showIfNot(id) {
    if (!$('screen-' + id).classList.contains('active')) showScreen(id);
  }

  const nameOf = pid => view?.names?.[pid] || view?.players.find(p => p.pid === pid)?.name || '?';
  const isHostish = v => !!v.you && (v.you.isHost || !v.players.some(p => p.host && p.connected));

  // ── Lobby ─────────────────────────────────────────────────────────────
  const inviteLink = code => `${location.origin}/?room=${encodeURIComponent(code)}&game=council`;
  let qrFor = '';

  function renderLobby() {
    const v = view;
    $('cn-lobby-code').textContent = v.code;
    if (qrFor !== v.code) {
      qrFor = v.code;
      $('cn-qr-image').src = `/qr?data=${encodeURIComponent(inviteLink(v.code))}`;
      const reachable = typeof originIsReachableByOthers === 'function' ? originIsReachableByOthers() : true;
      $('cn-qr-warning').hidden = reachable;
      if (!reachable) $('cn-qr-warning').textContent = 'You’re on localhost, so this code only works on this machine.';
    }
    const n = v.players.length;
    $('cn-lobby-players').innerHTML = `
      <p class="cn-label">At the table · ${n} of ${v.rules.max}</p>
      <div class="cn-chips">${v.players.map(p => `
        <span class="cn-chip${p.you ? ' you' : ''}${p.connected ? '' : ' away'}">${p.host ? '👑 ' : ''}${esc(p.name)}${p.you ? ' (you)' : ''}</span>`).join('')}
      </div>`;
    let actions;
    if (isHostish(v)) {
      actions = n >= v.rules.min
        ? `<button class="primary-btn cn-big-btn" id="cn-start">Start the Game</button>`
        : `<button class="primary-btn cn-big-btn btn-unready" disabled>Need ${v.rules.min - n} more</button>
           <p class="cn-muted">The Council needs at least ${v.rules.min} players.</p>`;
    } else {
      actions = `<p class="cn-muted">Waiting for <strong>${esc(v.players.find(p => p.host)?.name || 'the host')}</strong> to start…</p>`;
    }
    $('cn-lobby-actions').innerHTML = actions;
    $('cn-start')?.addEventListener('click', () => act('cn:start'));
  }

  let inviteTimer = null;
  $('cn-invite-btn').addEventListener('click', async () => {
    if (!myCode) return;
    const url = inviteLink(myCode);
    const ok = typeof copyText === 'function' ? await copyText(url) : false;
    if (!ok) { window.prompt('Copy this invite link:', url); return; }
    $('cn-invite-label').textContent = 'Link copied!';
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => { $('cn-invite-label').textContent = 'Or copy the invite link'; }, 2000);
  });

  function leave() {
    if (!confirm('Leave this game?')) return;
    act('cn:leave');
    clearSession();
    view = null; myCode = '';
    refreshRejoinBanner();
    showScreen('cn-home');
  }
  $('cn-lobby-leave').addEventListener('click', leave);

  // ── Game ──────────────────────────────────────────────────────────────
  const ICON = { gold: '🪙', people: '👥' };
  const LABEL = { gold: 'Gold', people: 'People' };

  function meter(kind, value, max) {
    const pips = Array.from({ length: max }, (_, i) =>
      `<span class="cn-pip${i < value ? ' on' : ''}${value <= 2 && i < value ? ' low' : ''}"></span>`).join('');
    return `<div class="cn-meter ${kind}${value <= 2 ? ' danger' : ''}">
      <div class="cn-meter-top"><span class="cn-meter-icon">${ICON[kind]}</span><span class="cn-meter-name">${LABEL[kind]}</span><span class="cn-meter-num">${value}</span></div>
      <div class="cn-pips">${pips}</div>
    </div>`;
  }

  function roleBlock(v) {
    const traitor = v.you.role === 'traitor';
    const allies = v.you.allies || [];
    if (!rolePeek) return `<button class="cn-role-toggle" id="cn-role-toggle">👁 Tap to see your role</button>`;
    return `<button class="cn-role-toggle open ${traitor ? 'traitor' : 'loyal'}" id="cn-role-toggle">
      ${traitor
        ? `🗡️ You are a <strong>TRAITOR</strong>${allies.length ? `<span>With: ${allies.map(esc).join(', ')}</span>` : ''}`
        : `🛡️ You are <strong>LOYAL</strong>`}
      <em>Tap to hide</em></button>`;
  }

  function cardBlock(v) {
    const c = v.card;
    if (!c) return '';
    const opt = side => `<div class="cn-option ${side}">
      <span class="cn-option-icon">${ICON[side]}</span>
      <span class="cn-option-text">${esc(c[side])}</span>
      <span class="cn-option-cost">−1 ${LABEL[side]}</span></div>`;
    return `<div class="cn-card">
      <div class="cn-card-icon">${c.icon}</div>
      <h2 class="cn-card-title">${esc(c.title)}</h2>
      <p class="cn-card-text">${esc(c.text)}</p>
      ${opt('gold')}${opt('people')}
    </div>`;
  }

  function whisperBlock(v) {
    if (v.phase === 'result') return '';
    if (v.whisper) {
      return `<div class="cn-whisper has">🤫 <strong>Your spy whispers:</strong> the <b class="${v.whisper.trap}">${LABEL[v.whisper.trap].toUpperCase()}</b> answer is a <b>trap</b> this round. It costs 1 extra.</div>`;
    }
    return `<div class="cn-whisper">No whisper for you this round.</div>`;
  }

  function voteSummary(lv) {
    if (!lv) return '';
    const names = list => list.map(nameOf).map(esc).join(', ') || 'nobody';
    return `<div class="cn-lastvote ${lv.passed ? 'pass' : 'fail'}">
      <strong>${lv.passed ? '✅ Plan approved' : '❌ Plan rejected'} ${lv.approve.length}–${lv.reject.length}</strong>
      <span>Yes: ${names(lv.approve)}</span><span>No: ${names(lv.reject)}</span></div>`;
  }

  function planLine(p) {
    return `<div class="cn-plan">
      <span class="cn-plan-who">👑 ${esc(nameOf(p.leader))} + ${esc(nameOf(p.partner))}</span>
      <span class="cn-plan-what ${p.option}">${ICON[p.option]} ${esc(view.card?.[p.option] || '')} <em>(−1 ${LABEL[p.option]})</em></span>
    </div>`;
  }

  function skipButton(v, label) {
    if (!isHostish(v)) return '';
    const offline = v.players.filter(p => !p.connected).length;
    if (!offline) return '';
    return `<button class="secondary-btn cn-skip" id="cn-skip">${label}</button>`;
  }

  function phaseBlock(v) {
    const me = v.you.pid;
    const leaderName = esc(nameOf(v.leader));

    if (v.phase === 'roles') {
      const n = v.ready.length, total = v.players.length;
      const done = v.ready.includes(me);
      const traitor = v.you.role === 'traitor';
      return `<div class="cn-panel cn-role-card ${traitor ? 'traitor' : 'loyal'}">
          <div class="cn-role-big">${traitor ? '🗡️' : '🛡️'}</div>
          <h2>${traitor ? 'You are a TRAITOR' : 'You are LOYAL'}</h2>
          ${traitor
            ? `<p>${(v.you.allies || []).length ? `Your fellow traitors: <strong>${v.you.allies.map(esc).join(', ')}</strong>` : 'You work alone.'}</p>
               <p>Drain the <b>Gold</b> or the <b>People</b> to 0. Sabotage plans you are part of.</p>`
            : `<p>Keep <b>Gold</b> and <b>People</b> above 0 for ${v.rules.rounds} rounds.</p>
               <p>There ${v.traitorCount === 1 ? 'is 1 traitor' : `are ${v.traitorCount} traitors`} at the table.</p>`}
        </div>
        ${done
          ? `<p class="cn-wait">Ready ✓ — waiting for everyone (${n}/${total})</p>`
          : `<button class="primary-btn cn-big-btn" id="cn-ready">I've seen my role</button>`}
        ${isHostish(v) && n < total ? `<button class="secondary-btn cn-skip" id="cn-skip">Start without waiting</button>` : ''}`;
    }

    if (v.phase === 'propose') {
      const rejectNote = v.rejects ? `<p class="cn-rejects">Rejected plans this round: <strong>${v.rejects} of ${v.rules.maxRejects}</strong>. ${v.rules.maxRejects - v.rejects === 1 ? 'One more and the kingdom panics!' : ''}</p>` : '';
      if (v.leader !== me) {
        return `${voteSummary(v.lastVote)}${rejectNote}
          <div class="cn-panel"><p class="cn-wait big">👑 <strong>${leaderName}</strong> is the leader.</p>
          <p class="cn-muted">They pick an answer and one partner. Talk it over!</p></div>`;
      }
      const others = v.players.filter(p => p.pid !== me);
      return `${voteSummary(v.lastVote)}${rejectNote}
        <div class="cn-panel cn-leader">
          <p class="cn-step">👑 You are the leader</p>
          <p class="cn-label">1. Pick an answer</p>
          <div class="cn-pick-row">
            ${['gold', 'people'].map(s => `<button class="cn-pick ${s}${draft.option === s ? ' on' : ''}" data-option="${s}">${ICON[s]} ${LABEL[s]}</button>`).join('')}
          </div>
          <p class="cn-label">2. Pick your partner</p>
          <div class="cn-chips">${others.map(p => `<button class="cn-chip pick${draft.partner === p.pid ? ' on' : ''}" data-partner="${p.pid}">${esc(p.name)}</button>`).join('')}</div>
          <button class="primary-btn cn-big-btn${draft.option && draft.partner ? '' : ' btn-unready'}" id="cn-propose" ${draft.option && draft.partner ? '' : 'disabled'}>Propose this plan</button>
        </div>`;
    }

    if (v.phase === 'vote') {
      const total = v.players.length, n = v.voted.length;
      const mine = v.yourVote;
      return `<div class="cn-panel">
          <p class="cn-step">🗳️ Vote on the plan</p>
          ${planLine(v.proposal)}
          ${mine === null
            ? `<div class="cn-vote-row">
                 <button class="cn-vote yes" id="cn-yes">👍 Approve</button>
                 <button class="cn-vote no" id="cn-no">👎 Reject</button>
               </div>`
            : `<p class="cn-wait">You voted <strong>${mine ? 'Approve' : 'Reject'}</strong>. Waiting (${n}/${total})…</p>`}
          <p class="cn-muted">Waiting on: ${v.players.filter(p => !v.voted.includes(p.pid)).map(p => esc(p.name)).join(', ') || '—'}</p>
          ${v.proposal.leader === me && n === 0 ? `<button class="secondary-btn cn-skip" id="cn-withdraw">Change my plan</button>` : ''}
          ${n > 0 ? skipButton(v, 'Count the votes that are in') : ''}
        </div>`;
    }

    if (v.phase === 'act') {
      const onTeam = v.proposal.leader === me || v.proposal.partner === me;
      const traitor = v.you.role === 'traitor';
      let body;
      if (onTeam && !v.yourAction) {
        body = `<p class="cn-step">🤫 Secretly choose</p>
          <p class="cn-muted">Nobody will see what you pick, only how many sabotaged.</p>
          <div class="cn-vote-row">
            <button class="cn-vote yes" id="cn-help">🤝 Help</button>
            ${traitor ? `<button class="cn-vote no" id="cn-sabotage">🗡️ Sabotage</button>` : ''}
          </div>
          ${traitor ? '' : `<p class="cn-muted">Loyal players can only help.</p>`}`;
      } else if (onTeam) {
        body = `<p class="cn-wait">Done ✓ — waiting for your partner…</p>`;
      } else {
        body = `<p class="cn-wait big">🤫 <strong>${esc(nameOf(v.proposal.leader))}</strong> and <strong>${esc(nameOf(v.proposal.partner))}</strong> are carrying out the plan…</p>`;
      }
      return `${voteSummary(v.lastVote)}<div class="cn-panel">${planLine(v.proposal)}${body}${skipButton(v, 'Continue without them')}</div>`;
    }

    if (v.phase === 'result' || v.phase === 'game-over') {
      const r = v.result;
      let head, lines = [];
      if (r.kind === 'panic') {
        head = `<div class="cn-result bad"><span>😱</span><h2>The kingdom panics!</h2></div>`;
        lines.push(`Three plans in a row were rejected.`, `<b>−1 Gold</b> and <b>−1 People</b>.`);
      } else {
        const sab = r.sabotages;
        head = sab
          ? `<div class="cn-result bad"><span>🗡️</span><h2>SABOTAGED!</h2><p>${sab === 1 ? '1 betrayal' : `${sab} betrayals`}</p></div>`
          : `<div class="cn-result good"><span>✅</span><h2>The plan worked</h2></div>`;
        lines.push(`${esc(nameOf(r.leader))} and ${esc(nameOf(r.partner))} chose ${ICON[r.option]} <b>${esc(LABEL[r.option])}</b>.`);
        lines.push(`Base cost: <b>1</b>`);
        if (r.trapped) lines.push(`⚠️ It was the <b>trap</b>: <b>+1</b>`);
        if (sab) lines.push(`🗡️ Sabotage: <b>+2</b>`);
        lines.push(`<span class="cn-total">Lost <b>${r.amount} ${LABEL[r.option]}</b></span>`);
      }
      const winner = v.winner
        ? `<div class="cn-winner ${v.winner}">
             <h2>${v.winner === 'loyal' ? '🛡️ The kingdom survives!' : '🗡️ The kingdom has fallen!'}</h2>
             <p>${v.winner === 'loyal' ? 'Loyal players win.' : `${v.endReason === 'gold' ? 'The treasury is empty.' : 'The people have abandoned you.'} Traitors win.`}</p>
           </div>` : '';
      let tail;
      if (v.phase === 'game-over') {
        tail = `<div class="cn-panel"><p class="cn-label">Who was who</p>
          <div class="cn-roles">${v.roleList.map(p => `<div class="cn-role-row ${p.role}"><span>${esc(p.name)}</span><strong>${p.role === 'traitor' ? '🗡️ Traitor' : '🛡️ Loyal'}</strong></div>`).join('')}</div></div>
          ${isHostish(v) ? `<button class="primary-btn cn-big-btn" id="cn-again">Play Again</button>` : `<p class="cn-muted">The host can start a new game.</p>`}
          <button class="secondary-btn cn-skip" id="cn-leave">Leave</button>`;
      } else {
        tail = `<button class="primary-btn cn-big-btn" id="cn-next">${v.winner ? 'See who was who →' : `Next round →`}</button>`;
      }
      return `${head}<div class="cn-panel cn-math">${lines.map(l => `<p>${l}</p>`).join('')}</div>${winner}${tail}`;
    }
    return '';
  }

  function playersStrip(v) {
    const p = v.proposal;
    return `<div class="cn-strip">${v.players.map(pl => {
      const tags = [];
      if (pl.pid === v.leader && v.phase !== 'result' && v.phase !== 'game-over') tags.push('👑');
      if (p && (v.phase === 'vote' || v.phase === 'act') && (pl.pid === p.leader || pl.pid === p.partner)) tags.push('⚔️');
      if (v.phase === 'vote' && v.voted.includes(pl.pid)) tags.push('✓');
      if (v.phase === 'roles' && v.ready.includes(pl.pid)) tags.push('✓');
      return `<span class="cn-strip-p${pl.you ? ' you' : ''}${pl.connected ? '' : ' away'}">${tags.join('')} ${esc(pl.name)}</span>`;
    }).join('')}</div>`;
  }

  function renderGame() {
    const v = view;
    const showBoard = v.phase !== 'roles';
    $('cn-game-body').innerHTML = `
      <div class="cn-top">
        <span class="cn-round">${v.round ? `Round <b>${v.round}</b> of ${v.rules.rounds}` : 'The Council'}</span>
        ${roleBlock(v)}
      </div>
      ${showBoard ? `<div class="cn-meters">${meter('gold', v.kingdom.gold, v.rules.start)}${meter('people', v.kingdom.people, v.rules.start)}</div>` : ''}
      ${showBoard && v.phase !== 'game-over' ? cardBlock(v) : ''}
      ${showBoard && v.phase !== 'game-over' ? whisperBlock(v) : ''}
      ${phaseBlock(v)}
      ${playersStrip(v)}`;
    wire(v);
  }

  function wire(v) {
    const on = (id, fn) => $(id)?.addEventListener('click', fn);
    on('cn-role-toggle', () => { rolePeek = !rolePeek; renderGame(); });
    on('cn-ready', () => act('cn:ready'));
    on('cn-skip', () => act('cn:skip', { phase: v.phase }));
    document.querySelectorAll('[data-option]').forEach(b => b.addEventListener('click', () => { draft.option = b.dataset.option; renderGame(); }));
    document.querySelectorAll('[data-partner]').forEach(b => b.addEventListener('click', () => { draft.partner = b.dataset.partner; renderGame(); }));
    on('cn-propose', () => { if (draft.option && draft.partner) act('cn:propose', { option: draft.option, partner: draft.partner }); });
    on('cn-withdraw', () => act('cn:withdraw'));
    on('cn-yes', () => act('cn:vote', { approve: true }));
    on('cn-no', () => act('cn:vote', { approve: false }));
    on('cn-help', () => act('cn:act', { choice: 'help' }));
    on('cn-sabotage', () => act('cn:act', { choice: 'sabotage' }));
    on('cn-next', () => act('cn:next', { round: v.round }));
    on('cn-again', () => act('cn:play-again'));
    on('cn-leave', leave);
  }

  $('cn-game-leave').addEventListener('click', leave);
})();
