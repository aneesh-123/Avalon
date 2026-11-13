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
  let rolePeek = false;
  // The evidence board stays open or shut the way you left it.
  let boardOpen = false;

  function act(event, extra = {}) {
    socket.emit(event, { code: myCode, token: playerToken, ...extra });
  }

  // ── Picker + home ─────────────────────────────────────────────────────
  // Not on the public picker yet: it appears only for Council links
  // (?game=council) or for someone who has already played on this phone.
  try {
    const store = window.localStorage;
    if ((new URLSearchParams(location.search).get('game') || '').toLowerCase() === 'council'
      || store.getItem('council-seen')) {
      $('pick-council').hidden = false;
      store.setItem('council-seen', '1');
    }
  } catch {}
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

  // A practice link (/?game=council&bots=4) seats that many bots at the new
  // table, so one person can try the game. There is no button for it.
  let practiceBots = 0;

  $('cn-create-submit').addEventListener('click', () => {
    const name = $('cn-create-name').value.trim();
    if (!name) { $('cn-create-error').textContent = 'Enter your name.'; return; }
    socket.emit('cn:create-room', { name, token: playerToken, bots: practiceBots });
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
    const bots = parseInt(p.get('bots') || '', 10);
    if (!p.get('room') && bots > 0) {
      practiceBots = Math.min(bots, 9);
      $('cn-create-submit').textContent = `Play with ${practiceBots} bot${practiceBots === 1 ? '' : 's'} →`;
      showScreen('cn-create');
      const name = (p.get('name') || '').trim().slice(0, 20);
      if (name) { $('cn-create-name').value = name; setTimeout(() => $('cn-create-submit').click(), 300); }
      else setTimeout(() => $('cn-create-name').focus(), 60);
      return;
    }
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
    // Roles are private: once the reveal is over, hide yours until you tap.
    if (prev?.phase === 'roles' && v.phase !== 'roles') rolePeek = false;
    // Your turn: a buzz for anyone looking away.
    if (yourTurn(v) && !yourTurn(prev)) { try { navigator.vibrate?.(60); } catch {} }
    route();
  });

  function yourTurn(v) {
    if (!v || v.state !== 'playing' || !v.you) return false;
    const me = v.you.pid;
    if (v.phase === 'scout') return !!v.yourSide && !v.reports?.[v.yourSide];
    if (v.phase === 'vote') return v.yourVote === null;
    if (v.phase === 'accuse') return !v.yourAccusation;
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
        <span class="cn-chip${p.you ? ' you' : ''}${p.bot ? ' bot' : ''}${p.connected ? '' : ' away'}">${p.host ? '👑 ' : ''}${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.you ? ' (you)' : ''}</span>`).join('')}
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
  const SAYS = { safe: '✅ SAFE', trap: '⚠️ TRAP' };

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

  // "Because you hired the hunters…" on a problem that grew out of the last one.
  function storyLine(v) {
    if (!v.card?.follow) return '';
    const last = v.history.find(h => h.round === v.round - 1);
    if (!last?.card) return '';
    return `<p class="cn-story">📜 Because you chose “${esc(last.card[last.choice])}”</p>`;
  }

  // One choice on the problem card: what it costs, who scouted it, what they
  // told the table, and (on your phone only) what you secretly know.
  function choiceTile(v, side) {
    const c = v.card;
    const scout = v.scouts?.[side];
    const said = v.reports?.[side];
    const secret = v.secret && side in v.secret ? v.secret[side] : null;
    const r = v.phase === 'result' ? v.result : null;
    const chosen = r && r.choice === side;
    const mine = v.phase === 'vote' && v.yourVote === side;
    let report;
    if (said) report = `<span class="cn-says ${said}">${esc(nameOf(scout))} says ${SAYS[said]}</span>`;
    else if (v.phase === 'scout') report = `<span class="cn-says wait">🔍 ${esc(nameOf(scout))} is checking…</span>`;
    else report = `<span class="cn-says wait">🔍 ${esc(nameOf(scout))} said nothing</span>`;
    const stamp = secret === null ? ''
      : `<span class="cn-secret ${secret ? 'trap' : 'safe'}">🤫 You know: ${secret ? 'TRAP' : 'SAFE'}</span>`;
    const outcome = chosen ? `<span class="cn-outcome ${r.trapped ? 'trap' : 'safe'}">${r.trapped ? '⚠️ It was a TRAP' : '✅ It was safe'}</span>`
      : r ? `<span class="cn-outcome hidden">Not chosen · stays secret</span>` : '';
    return `<div class="cn-option ${side}${chosen ? ' chosen' : ''}${r && !chosen ? ' dim' : ''}${mine ? ' mine' : ''}">
      <div class="cn-option-head">
        <span class="cn-option-icon">${ICON[side]}</span>
        <span class="cn-option-text">${esc(c[side])}</span>
        <span class="cn-option-cost">−1 ${LABEL[side]}</span>
      </div>
      ${report}${stamp}${outcome}
    </div>`;
  }

  function cardBlock(v) {
    const c = v.card;
    if (!c) return '';
    return `<div class="cn-card">
      ${storyLine(v)}
      <div class="cn-card-icon">${c.icon}</div>
      <h2 class="cn-card-title">${esc(c.title)}</h2>
      <p class="cn-card-text">${esc(c.text)}</p>
      ${choiceTile(v, 'gold')}${choiceTile(v, 'people')}
      <p class="cn-trap-note">Either one might be a trap (+1 extra).</p>
    </div>`;
  }

  // ── The evidence board ────────────────────────────────────────────────
  function historyRow(h) {
    const scoutLine = side => {
      const said = h.reports[side];
      const liar = h.caught && h.caught === h.scouts[side];
      return `<span class="cn-h-scout${liar ? ' liar' : ''}">${ICON[side]} ${esc(nameOf(h.scouts[side]))}: ${said ? SAYS[said] : '—'}${liar ? ' 🤥 LIED' : ''}</span>`;
    };
    const voters = side => (h.votes[side] || []).map(nameOf).map(esc).join(', ') || 'nobody';
    return `<div class="cn-h-row ${h.trapped ? 'trap' : 'safe'}">
      <div class="cn-h-top"><b>R${h.round}</b> ${h.card?.icon || ''} ${esc(h.card?.title || '')}</div>
      <div class="cn-h-pick">Chose ${ICON[h.choice]} <b>${esc(h.card?.[h.choice] || LABEL[h.choice])}</b> → ${h.trapped ? `⚠️ TRAP, −${h.amount}` : `✅ safe, −${h.amount}`}</div>
      <div class="cn-h-scouts"><em>Scouts</em>${scoutLine('gold')}${scoutLine('people')}</div>
      <div class="cn-h-votes"><em>Votes</em><span>🪙 ${voters('gold')}</span><span>👥 ${voters('people')}</span></div>
    </div>`;
  }

  function evidenceBoard(v, { open = boardOpen } = {}) {
    if (!v.history?.length) return '';
    return `<details class="cn-board" id="cn-board"${open ? ' open' : ''}>
      <summary>📜 What happened so far (${v.history.length})</summary>
      ${v.history.slice().reverse().map(historyRow).join('')}
    </details>`;
  }

  function skipButton(v, label) {
    if (!isHostish(v)) return '';
    const offline = v.players.filter(p => !p.connected).length;
    if (!offline) return '';
    return `<button class="secondary-btn cn-skip" id="cn-skip">${label}</button>`;
  }

  function resultHead(v) {
    const r = v.result;
    return `<div class="cn-result ${r.trapped ? 'bad' : 'good'}">
        <span>${r.trapped ? '⚠️' : '✅'}</span>
        <h2>${r.trapped ? 'TRAP!' : 'Safe'}</h2>
        <p>Chose ${ICON[r.choice]} ${LABEL[r.choice]} · lost <b>${r.amount}</b></p>
      </div>`;
  }

  const speakerLine = v => `<p class="cn-speaker">🎙️ <b>${esc(nameOf(v.speaker))}</b> breaks a tie this round</p>`;

  function phaseBlock(v) {
    const me = v.you.pid;

    if (v.phase === 'roles') {
      const n = v.ready.length, total = v.players.length;
      const done = v.ready.includes(me);
      const traitor = v.you.role === 'traitor';
      const tc = v.traitorCount;
      return `<div class="cn-panel cn-role-card ${traitor ? 'traitor' : 'loyal'}">
          <div class="cn-role-big">${traitor ? '🗡️' : '🛡️'}</div>
          <h2>${traitor ? 'You are a TRAITOR' : 'You are LOYAL'}</h2>
          ${traitor
            ? `<p>${(v.you.allies || []).length ? `Your fellow traitor: <strong>${v.you.allies.map(esc).join(', ')}</strong>` : 'You work alone.'}</p>
               <p>You will <b>see every trap</b>. Lie to lead the council into them.</p>
               <p>Win by draining <b>Gold</b> or <b>People</b> to 0, or by not getting named at the end.</p>`
            : `<p>Keep <b>Gold</b> and <b>People</b> above 0 for ${v.rules.rounds} rounds.</p>
               <p>Then name the traitor. There ${tc === 1 ? 'is <b>1 traitor</b>' : `are <b>${tc} traitors</b>`} at the table.</p>`}
        </div>
        ${done
          ? `<p class="cn-wait">Ready ✓ — waiting for everyone (${n}/${total})</p>`
          : `<button class="primary-btn cn-big-btn" id="cn-ready">I've seen my role</button>`}
        ${isHostish(v) && n < total ? `<button class="secondary-btn cn-skip" id="cn-skip">Start without waiting</button>` : ''}`;
    }

    if (v.phase === 'scout') {
      const side = v.yourSide;
      const scoutNames = `<b>${esc(nameOf(v.scouts.gold))}</b> and <b>${esc(nameOf(v.scouts.people))}</b>`;
      if (side && !v.reports[side]) {
        const trap = v.secret[side];
        const traitor = v.you.role === 'traitor';
        return `<div class="cn-panel cn-scout-panel">
            <p class="cn-step">🔍 You scouted ${ICON[side]} ${LABEL[side].toUpperCase()}</p>
            <p class="cn-found ${trap ? 'trap' : 'safe'}">It is ${trap ? '⚠️ a TRAP' : '✅ SAFE'}</p>
            <p class="cn-label">Tell the table</p>
            <div class="cn-vote-row">
              <button class="cn-vote yes" data-report="safe">✅ Safe</button>
              <button class="cn-vote no" data-report="trap">⚠️ Trap</button>
            </div>
            <p class="cn-muted">${traitor ? 'You can lie. Only the choice the table picks gets revealed.' : 'Say it out loud too.'}</p>
          </div>`;
      }
      const waiting = ['gold', 'people'].filter(s => !v.reports[s]).map(s => esc(nameOf(v.scouts[s])));
      return `<div class="cn-panel">
          <p class="cn-wait big">🔍 ${scoutNames} are this round's scouts</p>
          <p class="cn-muted">${side ? 'Reported ✓ — say it out loud too.' : ''} Waiting on: ${waiting.join(', ')}</p>
          ${skipButton(v, 'Go on without them')}
        </div>`;
    }

    if (v.phase === 'vote') {
      const total = v.players.length, n = v.voted.length;
      const mine = v.yourVote;
      return `<div class="cn-panel">
          <p class="cn-step">🗣️ Argue it out, then vote</p>
          <div class="cn-vote-row">
            ${['gold', 'people'].map(s => `<button class="cn-pick ${s}${mine === s ? ' on' : ''}" data-vote="${s}">${ICON[s]} ${LABEL[s]}</button>`).join('')}
          </div>
          <p class="cn-muted">${mine ? `You voted <b>${LABEL[mine]}</b>. Tap the other to change it. ` : ''}Votes are shown when everyone is in (${n}/${total}).</p>
          <p class="cn-muted">Waiting on: ${v.players.filter(p => !v.voted.includes(p.pid)).map(p => esc(p.name)).join(', ') || '—'}</p>
          ${speakerLine(v)}
          ${n > 0 ? skipButton(v, 'Count the votes that are in') : ''}
        </div>`;
    }

    if (v.phase === 'result') {
      const r = v.result;
      const said = r.reports[r.choice];
      const scout = esc(nameOf(r.scouts[r.choice]));
      let truth;
      if (r.caught) truth = `<p class="cn-liar">🤥 ${scout} said ${SAYS[said]}. That was a <b>LIE</b>.</p>`;
      else if (said) truth = `<p class="cn-honest">${scout} told the truth about ${LABEL[r.choice]}.</p>`;
      else truth = '';
      const voters = side => (r.votes[side] || []).map(nameOf).map(esc).join(', ') || 'nobody';
      const winner = v.winner
        ? `<div class="cn-winner traitors">
             <h2>🗡️ The kingdom has fallen!</h2>
             <p>${v.endReason === 'gold' ? 'The treasury is empty.' : 'The people have left.'} Traitors win.</p>
           </div>` : '';
      return `<div class="cn-panel cn-math">
          ${truth}
          <p class="cn-muted">The other choice stays secret.</p>
          <div class="cn-votes-out">
            <p><b>🪙 Gold:</b> ${voters('gold')}</p>
            <p><b>👥 People:</b> ${voters('people')}</p>
            ${r.tieBreak ? `<p class="cn-muted">A tie, so ${esc(nameOf(r.speaker))} decided.</p>` : ''}
          </div>
        </div>
        ${winner}
        <button class="primary-btn cn-big-btn" id="cn-next">${v.winner ? 'See who was who →' : v.round >= v.rules.rounds ? 'Name the traitor →' : 'Next round →'}</button>`;
    }

    if (v.phase === 'accuse') {
      const n = v.accused.length, total = v.players.length;
      const two = v.traitorCount > 1;
      return `<div class="cn-result good"><span>🏰</span><h2>The kingdom survived!</h2>
          <p>One last vote decides who wins.</p></div>
        <div class="cn-panel">
          <p class="cn-step">👉 Who is ${two ? 'a traitor' : 'the traitor'}?</p>
          <p class="cn-muted">Talk it over. Most votes is named. ${two ? 'Name either traitor' : 'Name the traitor'} and the loyal side wins. Miss, or tie, and the traitors win.</p>
          <div class="cn-chips cn-accuse">${v.players.filter(p => p.pid !== me).map(p =>
            `<button class="cn-chip pick${v.yourAccusation === p.pid ? ' on' : ''}" data-accuse="${p.pid}">${esc(p.name)}</button>`).join('')}</div>
          <p class="cn-muted">${v.yourAccusation ? `You named <b>${esc(nameOf(v.yourAccusation))}</b>. Tap another to change. ` : ''}${n}/${total} have voted.</p>
          ${n > 0 ? skipButton(v, 'Count the votes that are in') : ''}
        </div>`;
    }

    if (v.phase === 'game-over') {
      const vd = v.verdict;
      let head;
      if (v.winner === 'loyal') {
        head = `<div class="cn-winner loyal"><h2>🛡️ Loyal council wins!</h2><p>You named <b>${esc(nameOf(vd.named))}</b>, a traitor.</p></div>`;
      } else if (v.endReason === 'gold' || v.endReason === 'people') {
        head = `<div class="cn-winner traitors"><h2>🗡️ Traitors win!</h2><p>${v.endReason === 'gold' ? 'The treasury ran dry.' : 'The people left the kingdom.'}</p></div>`;
      } else {
        head = `<div class="cn-winner traitors"><h2>🗡️ Traitors win!</h2><p>${vd?.named
          ? `You named <b>${esc(nameOf(vd.named))}</b>, who was loyal.`
          : 'The vote was a tie, so nobody was named.'}</p></div>`;
      }
      const votesOut = vd ? `<div class="cn-panel"><p class="cn-label">The final vote</p>
          ${Object.entries(vd.votes).map(([from, to]) => `<p class="cn-vote-line">${esc(nameOf(from))} → <b>${esc(nameOf(to))}</b></p>`).join('')}</div>` : '';
      return `${head}
        <div class="cn-panel"><p class="cn-label">Who was who</p>
          <div class="cn-roles">${v.roleList.map(p => `<div class="cn-role-row ${p.role}"><span>${esc(p.name)}</span><strong>${p.role === 'traitor' ? '🗡️ Traitor' : '🛡️ Loyal'}</strong></div>`).join('')}</div></div>
        ${votesOut}
        ${isHostish(v) ? `<button class="primary-btn cn-big-btn" id="cn-again">Play Again</button>` : `<p class="cn-muted">The host can start a new game.</p>`}
        <button class="secondary-btn cn-skip" id="cn-leave">Leave</button>`;
    }
    return '';
  }

  function playersStrip(v) {
    return `<div class="cn-strip">${v.players.map(pl => {
      const tags = [];
      if (v.scouts && (v.phase === 'scout' || v.phase === 'vote') && (v.scouts.gold === pl.pid || v.scouts.people === pl.pid)) tags.push('🔍');
      if (pl.pid === v.speaker && v.phase === 'vote') tags.push('🎙️');
      if (v.phase === 'vote' && v.voted.includes(pl.pid)) tags.push('✓');
      if (v.phase === 'accuse' && v.accused.includes(pl.pid)) tags.push('✓');
      if (v.phase === 'roles' && v.ready.includes(pl.pid)) tags.push('✓');
      return `<span class="cn-strip-p${pl.you ? ' you' : ''}${pl.connected ? '' : ' away'}">${tags.join('')}${pl.bot ? '🤖' : ''} ${esc(pl.name)}</span>`;
    }).join('')}</div>`;
  }

  function renderGame() {
    const v = view;
    const inRound = ['scout', 'vote', 'result'].includes(v.phase);
    const showMeters = v.phase !== 'roles';
    $('cn-game-body').innerHTML = `
      <div class="cn-top">
        <span class="cn-round">${v.phase === 'accuse' || v.phase === 'game-over' ? 'The End' : v.round ? `Round <b>${v.round}</b> of ${v.rules.rounds}` : 'The Council'}</span>
        ${roleBlock(v)}
      </div>
      ${showMeters ? `<div class="cn-meters">${meter('gold', v.kingdom.gold, v.rules.start)}${meter('people', v.kingdom.people, v.rules.start)}</div>` : ''}
      ${v.phase === 'result' ? resultHead(v) : ''}
      ${inRound ? cardBlock(v) : ''}
      ${phaseBlock(v)}
      ${v.phase === 'accuse' || v.phase === 'game-over' ? evidenceBoard(v, { open: true }) : inRound ? evidenceBoard(v) : ''}
      ${playersStrip(v)}`;
    wire(v);
  }

  function wire(v) {
    const on = (id, fn) => $(id)?.addEventListener('click', fn);
    on('cn-role-toggle', () => { rolePeek = !rolePeek; renderGame(); });
    on('cn-ready', () => act('cn:ready'));
    on('cn-skip', () => act('cn:skip', { phase: v.phase }));
    document.querySelectorAll('[data-report]').forEach(b => b.addEventListener('click', () =>
      act('cn:report', { side: v.yourSide, says: b.dataset.report })));
    document.querySelectorAll('[data-vote]').forEach(b => b.addEventListener('click', () =>
      act('cn:vote', { choice: b.dataset.vote })));
    document.querySelectorAll('[data-accuse]').forEach(b => b.addEventListener('click', () =>
      act('cn:accuse', { target: b.dataset.accuse })));
    $('cn-board')?.addEventListener('toggle', e => {
      if (v.phase !== 'accuse' && v.phase !== 'game-over') boardOpen = e.target.open;
    });
    on('cn-next', () => act('cn:next', { round: v.round }));
    on('cn-again', () => act('cn:play-again'));
    on('cn-leave', leave);
  }

  $('cn-game-leave').addEventListener('click', leave);
})();
