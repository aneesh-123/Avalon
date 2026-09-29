// secret.js — client for the Secret Hitler game mode. Shares the page's socket,
// showScreen, esc, copyText and playerToken with client.js; everything else is
// its own. Every word a player reads comes from secret-theme.js (SEC_THEME).
//
// The server is authoritative: this file renders the per-seat view it is sent
// ('sec:state') and turns taps into events. It never decides anything.
(function () {
  'use strict';

  const T = window.SEC_THEME;
  const $ = id => document.getElementById(id);

  const SESSION_KEY = 'secret-session';
  function saveSecSession(d) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(d)); } catch {} }
  function loadSecSession()  { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function clearSecSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

  // ── State ─────────────────────────────────────────────────────────────
  let view = null;             // the last 'sec:state'
  let myCode = '';
  let userAskedRejoin = false;
  let selectedCard = null;     // index of the card picked in a legislative session
  let pendingTarget = null;    // a player picked for a power, awaiting confirm

  function act(event, extra = {}) {
    socket.emit(event, { code: myCode, token: playerToken, ...extra });
  }

  // ── Theme into the static screens ─────────────────────────────────────
  $('sec-pick-icon').textContent = T.pickerIcon;
  $('sec-pick-name').textContent = T.gameName;
  $('sec-pick-desc').textContent = T.pickerDesc;
  $('sec-emblem-icon').textContent = T.pickerIcon;
  $('sec-home-title').textContent = T.gameName;
  $('sec-home-tagline').textContent = T.tagline;
  $('sec-credit').textContent = T.credit;

  // ── Words ─────────────────────────────────────────────────────────────
  const nameOf = seat => view?.players[seat]?.name ?? '—';
  const who = seat => `<strong>${esc(nameOf(seat))}</strong>`;
  const policyWord = p => T.policy[p];
  const partyName = p => T.party[p].name;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ── Picker + home ─────────────────────────────────────────────────────
  $('pick-secret').addEventListener('click', () => { refreshRejoinBanner(); showScreen('sec-home'); });

  function refreshRejoinBanner() {
    const s = loadSecSession();
    $('sec-rejoin-banner').hidden = !(s?.code && s?.name);
    if (s?.name) $('sec-rejoin-name').textContent = s.name;
  }
  refreshRejoinBanner();

  $('sec-btn-rejoin').addEventListener('click', () => {
    const s = loadSecSession();
    if (!s?.code) return;
    myCode = s.code;
    userAskedRejoin = true;
    socket.emit('sec:rejoin-room', { code: s.code, token: playerToken });
  });

  $('sec-btn-create').addEventListener('click', () => {
    $('sec-create-error').textContent = '';
    const s = loadSecSession();
    if (s?.name && !$('sec-create-name').value) $('sec-create-name').value = s.name;
    showScreen('sec-create');
    setTimeout(() => $('sec-create-name').focus(), 60);
  });

  $('sec-btn-join').addEventListener('click', () => {
    $('sec-join-error').textContent = '';
    showScreen('sec-join');
  });

  // One game at a time across the whole app: taking a seat here drops any
  // saved seat in the other games, so their auto-rejoin cannot yank this
  // phone back into an old game on the next reconnect.
  function beginSecret() {
    try { ['avalon-session', 'imposter-session', 'trivia-session'].forEach(k => localStorage.removeItem(k)); } catch {}
  }

  $('sec-create-submit').addEventListener('click', () => {
    const name = $('sec-create-name').value.trim();
    if (!name) { $('sec-create-error').textContent = 'Enter your name.'; $('sec-create-name').focus(); return; }
    $('sec-create-error').textContent = '';
    beginSecret();
    socket.emit('sec:create-room', { name, token: playerToken });
  });
  $('sec-create-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('sec-create-submit').click(); });

  $('sec-join-submit').addEventListener('click', () => {
    const code = $('sec-join-code').value.trim().toUpperCase();
    const name = $('sec-join-name').value.trim();
    if (code.length !== 5) { $('sec-join-error').textContent = 'Room codes are five characters.'; return; }
    if (!name) { $('sec-join-error').textContent = 'Enter your name.'; return; }
    $('sec-join-error').textContent = '';
    myCode = code;
    beginSecret();
    socket.emit('sec:join-room', { code, name, token: playerToken });
  });
  ['sec-join-code', 'sec-join-name'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('sec-join-submit').click();
  }));

  // Invite links look like /?room=CODE&game=secret. Avalon's own handler
  // ignores any link whose game isn't Avalon, so the two never fight over it.
  (function deepLink() {
    const p = new URLSearchParams(location.search);
    if ((p.get('game') || '').toLowerCase() !== 'secret') return;
    const code = (p.get('room') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return;
    const saved = loadSecSession();
    if (saved?.code === code) return;   // a reload mid-game: auto-rejoin handles it
    clearSecSession();
    refreshRejoinBanner();
    $('sec-join-code').value = code;
    showScreen('sec-join');
    const name = (p.get('name') || '').trim().slice(0, 20);
    if (name) { $('sec-join-name').value = name; setTimeout(() => $('sec-join-submit').click(), 150); }
    else setTimeout(() => $('sec-join-name').focus(), 60);
  })();

  // ── Connection ────────────────────────────────────────────────────────
  function otherGameSaved() {
    try { return ['avalon-session', 'imposter-session', 'trivia-session'].some(k => localStorage.getItem(k)); } catch { return false; }
  }

  socket.on('connect', () => {
    const s = loadSecSession();
    if (!s?.code || otherGameSaved()) return;
    myCode = s.code;
    socket.emit('sec:rejoin-room', { code: s.code, token: playerToken });
  });

  // Back from the background: the game may have moved on. Pull the state.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return;
    if (!socket.connected || !loadSecSession()?.code || otherGameSaved()) return;
    act('sec:request-sync');
  });

  socket.on('sec:desync', () => {
    const s = loadSecSession();
    if (s?.code) socket.emit('sec:rejoin-room', { code: s.code, token: playerToken });
  });

  socket.on('sec:rejoin-error', msg => {
    clearSecSession();
    refreshRejoinBanner();
    if (userAskedRejoin) alert(msg);
    userAskedRejoin = false;
    if (document.querySelector('.screen.active')?.id.startsWith('screen-sec-')
        && !['screen-sec-home', 'screen-sec-join', 'screen-sec-create'].includes(document.querySelector('.screen.active').id)) {
      view = null;
      showScreen('sec-home');
    }
  });

  socket.on('sec:error', msg => {
    const active = document.querySelector('.screen.active')?.id || '';
    const target = { 'screen-sec-create': 'sec-create-error', 'screen-sec-join': 'sec-join-error' }[active];
    if (target) $(target).textContent = msg;
    else if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  });

  socket.on('sec:joined', ({ code, name }) => {
    myCode = code;
    saveSecSession({ code, name });
    userAskedRejoin = false;
    refreshRejoinBanner();
  });

  // ── State routing ─────────────────────────────────────────────────────
  socket.on('sec:state', v => {
    const prev = view;
    view = v;
    myCode = v.code;
    if (v.you) saveSecSession({ code: v.code, name: v.you.name });

    const phase = v.game?.phase, prevPhase = prev?.game?.phase;
    // A new decision on this phone clears half-made picks from the last one.
    if (phase !== prevPhase || v.game?.president !== prev?.game?.president) { selectedCard = null; pendingTarget = null; }

    // The role card pops up once, when the roles are dealt.
    if (phase === 'reveal' && prevPhase !== 'reveal' && !v.game.ready.includes(v.you?.seat)) openRole();
    if (v.state !== 'playing') closeRole();

    // Something happened that this phone has to act on: a buzz.
    if (prev && phase !== prevPhase && needsMe(v)) { try { navigator.vibrate?.(40); } catch {} }

    route();
  });

  function needsMe(v) {
    const g = v.game, me = v.you?.seat;
    if (!g) return false;
    return (g.phase === 'nominate' && g.president === me)
      || (g.phase === 'vote' && v.players[me]?.alive)
      || (g.phase === 'president-discard' && g.president === me)
      || (g.phase === 'chancellor-enact' && g.chancellor === me)
      || (g.phase === 'veto' && g.president === me)
      || (g.phase === 'power' && g.president === me);
  }

  function route() {
    const v = view;
    if (!v) return;
    if (v.state === 'lobby') { renderLobby(); showIfNot('sec-lobby'); return; }
    renderGame();
    showIfNot('sec-game');
  }

  function showIfNot(id) {
    if (!$('screen-' + id).classList.contains('active')) showScreen(id);
  }

  const isController = v => !!v.you && (v.you.isHost || !v.host || !v.host.connected);

  // ── Lobby ─────────────────────────────────────────────────────────────
  const inviteLink = code => `${location.origin}/?room=${encodeURIComponent(code)}&game=secret`;
  let qrFor = '';

  function renderLobby() {
    const v = view;
    $('sec-lobby-code').textContent = v.code;
    if (qrFor !== v.code) {
      qrFor = v.code;
      $('sec-qr-image').src = `/qr?data=${encodeURIComponent(inviteLink(v.code))}`;
      const reachable = typeof originIsReachableByOthers === 'function' ? originIsReachableByOthers() : true;
      $('sec-qr-warning').hidden = reachable;
      if (!reachable) $('sec-qr-warning').textContent = 'You’re on localhost, so this code only works on this machine. Open the app on your network address for others to scan it.';
    }

    const n = v.players.length;
    const ctl = isController(v);
    const need = v.minPlayers - n;
    $('sec-lobby-status').textContent = need > 0
      ? `${plural(n, 'player', 'players')} here · ${need} more to start`
      : `${n} players · ready when you are`;

    $('sec-lobby-players').innerHTML = `
      <p class="sec-seat-hint">${ctl
        ? `Put everyone in the order they sit around the table. The ${esc(T.president)} moves down this list.`
        : `This is the seating order. The ${esc(T.president)} moves down this list.`}</p>
      ${v.players.map((p, i) => `
        <div class="lobby-player sec-lobby-player${p.you ? ' lobby-me' : ''}">
          <span class="lobby-player-name">
            <span class="sec-seat-no">${i + 1}</span>
            ${esc(p.name)}${p.you ? ' <span class="lobby-you-tag">you</span>' : ''}
            ${v.host?.name === p.name ? '<span class="sec-host-tag">host</span>' : ''}
            ${p.connected ? '' : '<span class="sec-away">away</span>'}
          </span>
          ${ctl ? `<span class="sec-seat-move">
            <button class="sec-move" data-from="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
            <button class="sec-move" data-from="${i}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
          </span>` : ''}
        </div>`).join('')}
      ${ctl && n > 2 ? '<button class="sec-link-btn" id="sec-shuffle-seats">Shuffle the order</button>' : ''}`;

    // What this many players gets you.
    const teams = v.teams;
    $('sec-lobby-setup').innerHTML = teams ? `
      <div class="sec-setup">
        <p class="section-label">With ${n} players</p>
        <div class="sec-setup-teams">
          <span class="sec-chip liberal">${T.party.liberal.icon} ${teams[0]} ${esc(T.party.liberal.plural)}</span>
          <span class="sec-chip fascist">${T.party.fascist.icon} ${teams[1]} ${esc(teams[1] === 1 ? T.party.fascist.name : T.party.fascist.plural)} + ${esc(T.role.hitler.name)}</span>
        </div>
        <p class="sec-muted">${n <= 6
          ? `${esc(T.role.hitler.name)} knows who the ${esc(teams[1] === 1 ? T.party.fascist.name : T.party.fascist.plural)} ${teams[1] === 1 ? 'is' : 'are'}.`
          : `${esc(T.role.hitler.name)} does not know who the ${esc(T.party.fascist.plural)} are.`}</p>
        ${powerStrip(v.powers)}
      </div>` : '';

    $('sec-lobby-actions').innerHTML = ctl
      ? `<button class="primary-btn" id="sec-start-btn" ${need > 0 || n > v.maxPlayers ? 'disabled' : ''}>${need > 0 ? `Need ${need} more` : 'Deal the roles'}</button>`
      : `<p class="lobby-hint">Waiting for ${esc(v.host?.name || 'the host')} to start.</p>`;
  }

  function powerStrip(powers) {
    if (!powers) return '';
    const slots = [...powers, 'win'];
    return `<div class="sec-power-strip">${slots.map((p, i) => `
      <span class="sec-power-slot${p ? '' : ' empty'}" title="${p === 'win' ? 'Fascists win' : p ? esc(T.power[p].name) : ''}">
        <span class="sec-power-n">${i + 1}</span>
        <span class="sec-power-icon">${p === 'win' ? T.party.fascist.icon : p ? T.power[p].icon : ''}</span>
      </span>`).join('')}</div>
      <p class="sec-muted sec-power-legend">${[...new Set(powers.filter(Boolean))].map(p => `${T.power[p].icon} ${esc(T.power[p].name)}`).join(' · ')}</p>`;
  }

  $('sec-lobby-players').addEventListener('click', e => {
    const mv = e.target.closest('.sec-move');
    if (mv) { act('sec:move-seat', { from: +mv.dataset.from, dir: +mv.dataset.dir }); return; }
    if (e.target.id === 'sec-shuffle-seats') act('sec:shuffle-seats');
  });
  $('sec-lobby-actions').addEventListener('click', e => {
    if (e.target.id === 'sec-start-btn') act('sec:start');
  });

  let inviteReset = null;
  $('sec-invite-btn').addEventListener('click', async () => {
    if (!view?.code) return;
    const url = inviteLink(view.code);
    const ok = await copyText(url);
    if (!ok) { window.prompt('Copy this invite link:', url); return; }
    $('sec-invite-label').textContent = 'Link copied!';
    $('sec-invite-btn').classList.add('copied');
    clearTimeout(inviteReset);
    inviteReset = setTimeout(() => {
      $('sec-invite-label').textContent = 'Or copy the invite link';
      $('sec-invite-btn').classList.remove('copied');
    }, 2000);
  });

  function leave() {
    act('sec:leave');
    clearSecSession();
    refreshRejoinBanner();
    view = null;
    closeRole();
    showScreen('sec-home');
  }
  $('sec-lobby-leave').addEventListener('click', leave);
  $('sec-leave-btn').addEventListener('click', () => {
    if (view?.game?.phase !== 'over' && !confirm('Leave this game? Your seat stays, and you can take it back by joining with the same name.')) return;
    leave();
  });

  // ── Game ──────────────────────────────────────────────────────────────
  function renderGame() {
    const v = view, g = v.game;
    $('sec-game-code').textContent = v.code;
    $('sec-role-btn').innerHTML = g.role ? `${T.role[g.role].icon} My role` : 'My role';
    $('sec-boards').innerHTML = boards(g);
    $('sec-banner').innerHTML = banner(v);
    $('sec-panel').innerHTML = panel(v);
    $('sec-players').innerHTML = playerList(v);
    $('sec-log').innerHTML = logList(g);
  }

  function boards(g) {
    const lib = Array.from({ length: 5 }, (_, i) => `
      <span class="sec-slot liberal${i < g.liberal ? ' filled' : ''}">${i < g.liberal ? T.party.liberal.icon : i === 4 ? '🏁' : ''}</span>`).join('');
    const fas = Array.from({ length: 6 }, (_, i) => {
      const p = g.powers[i];
      const icon = i < g.fascist ? T.party.fascist.icon : i === 5 ? '🏁' : p ? T.power[p].icon : '';
      return `<span class="sec-slot fascist${i < g.fascist ? ' filled' : ''}${i >= 3 ? ' danger' : ''}" title="${p ? esc(T.power[p].name) : ''}">${icon}</span>`;
    }).join('');
    const dots = Array.from({ length: 3 }, (_, i) => `<span class="sec-dot${i < g.tracker ? ' on' : ''}"></span>`).join('');
    return `
      <div class="sec-track">
        <span class="sec-track-name liberal">${esc(T.party.liberal.plural)}</span>
        <div class="sec-slots">${lib}</div>
      </div>
      <div class="sec-track">
        <span class="sec-track-name fascist">${esc(T.party.fascist.plural)}</span>
        <div class="sec-slots">${fas}</div>
      </div>
      <div class="sec-track-foot">
        <span class="sec-tracker" title="Three failed governments in a row force the top ${esc(T.policy.one)} into play">${esc(T.trackerName)} ${dots}</span>
        <span class="sec-deck">🂠 ${g.deckCount} · discard ${g.discardCount}</span>
      </div>
      ${g.fascist >= 3 && g.phase !== 'over' ? `<p class="sec-warn">If ${esc(T.role.hitler.name)} is elected ${esc(T.chancellor)} now, the ${esc(T.party.fascist.plural)} win.</p>` : ''}
      ${g.vetoUnlocked && g.phase !== 'over' ? `<p class="sec-muted sec-center">Veto power is unlocked.</p>` : ''}`;
  }

  function voteChips(lastVote) {
    return `<div class="sec-vote-chips">${lastVote.votes.map(x => `
      <span class="sec-vchip ${x.ja ? 'ja' : 'nein'}">${esc(nameOf(x.seat))} · ${esc(x.ja ? T.ja : T.nein)}</span>`).join('')}</div>`;
  }

  // What just happened, shown until the next thing does.
  function banner(v) {
    const g = v.game, ev = g.lastEvent;
    if (g.phase === 'over' || g.phase === 'reveal' || g.phase === 'vote') return '';
    const parts = [];
    const lv = g.lastVote;
    if (lv && ev && (ev.t === 'failed' || ev.t === 'elected' || (ev.t === 'enacted' && ev.chaos && g.tracker === 0))) {
      parts.push(`<p>${lv.passed ? '✅' : '❌'} ${esc(T.president)} ${who(lv.president)} and ${esc(T.chancellor)} ${who(lv.chancellor)} were ${lv.passed ? 'elected' : 'voted down'}.</p>${voteChips(lv)}`);
    }
    if (ev?.t === 'failed' && ev.tracker < 3) parts.push(`<p class="sec-muted">${esc(T.trackerName)}: ${ev.tracker} of 3.</p>`);
    if (ev?.t === 'veto') parts.push(`<p>✋ The ${esc(T.government)} vetoed the agenda. ${esc(T.trackerName)} moves on.</p>`);
    if (ev?.t === 'enacted') {
      parts.push(ev.chaos
        ? `<p>🌀 ${esc(T.chaos)}: a <strong class="sec-${ev.policy}">${esc(policyWord(ev.policy))}</strong> ${esc(T.policy.one)} was enacted from the top of the deck.</p>`
        : `<p>📜 A <strong class="sec-${ev.policy}">${esc(policyWord(ev.policy))}</strong> ${esc(T.policy.one)} was enacted.</p>`);
    }
    if (ev?.t === 'executed') parts.push(`<p>🗡️ ${who(ev.target)} was ${esc(T.execute.past)}.</p>`);
    return parts.length ? `<div class="sec-banner-card">${parts.join('')}</div>` : '';
  }

  function pickList(seats, cls = '') {
    return `<div class="sec-picks">${seats.map(s => `
      <button class="sec-pick${pendingTarget === s ? ' selected' : ''} ${cls}" data-seat="${s}">${esc(nameOf(s))}</button>`).join('')}</div>`;
  }

  function cards(hand, pickable) {
    return `<div class="sec-cards">${hand.map((c, i) => `
      <button class="sec-card ${c}${selectedCard === i ? ' selected' : ''}" data-card="${i}" ${pickable ? '' : 'disabled'}>
        <span class="sec-card-icon">${T.party[c].icon}</span>
        <span class="sec-card-name">${esc(policyWord(c))}</span>
      </button>`).join('')}</div>`;
  }

  const panelCard = (title, body) => `<div class="sec-panel-card">${title ? `<p class="sec-panel-title">${title}</p>` : ''}${body}</div>`;

  function panel(v) {
    const g = v.game, me = v.you?.seat, amAlive = v.players[me]?.alive;
    const pres = g.president, chanc = g.chancellor;
    if (!amAlive && g.phase !== 'over') {
      return panelCard(`You’re ${esc(T.execute.dead.toLowerCase())}`, `<p class="sec-muted">You can’t vote, talk strategy, or hold office any more. Stay quiet and watch it play out.</p>`);
    }

    switch (g.phase) {
      case 'reveal': {
        const ready = g.ready.includes(me);
        const waiting = v.players.filter(p => !g.ready.includes(p.seat)).map(p => esc(p.name));
        return panelCard('The roles are dealt', `
          <p>Look at your role without letting anyone see your screen.</p>
          <button class="secondary-btn" data-do="show-role">${T.role[g.role].icon} Show my role</button>
          ${ready
            ? `<p class="sec-muted sec-center">Waiting for ${waiting.join(', ')}.</p>`
            : '<button class="primary-btn" data-do="ready">I’ve seen it</button>'}
          ${isController(v) && waiting.length ? '<button class="sec-link-btn" data-do="begin">Start without waiting</button>' : ''}`);
      }

      case 'nominate':
        if (pres === me) {
          return panelCard(`You’re ${esc(T.president)}`, `
            <p>Pick your ${esc(T.chancellor)}. Talk it over with the table first.</p>
            ${pickList(g.eligible || [])}
            ${pendingTarget !== null ? `<button class="primary-btn" data-do="nominate">Nominate ${esc(nameOf(pendingTarget))}</button>` : ''}
            ${g.termLimited?.length ? `<p class="sec-muted">${g.termLimited.map(s => esc(nameOf(s))).join(', ')} can’t be ${esc(T.chancellor)} this round (term limit).</p>` : ''}`);
        }
        return panelCard(`${who(pres)} is ${esc(T.president)}`, `<p class="sec-muted">They’re picking a ${esc(T.chancellor)}.</p>`);

      case 'vote': {
        const n = v.players.filter(p => p.alive).length;
        const mine = g.yourVote;
        return panelCard('Vote', `
          <p>${esc(T.president)} ${who(pres)} with ${esc(T.chancellor)} ${who(chanc)}?</p>
          ${amAlive ? `<div class="sec-vote-btns">
            <button class="sec-vote ja${mine === true ? ' chosen' : ''}" data-vote="ja">${esc(T.ja)}</button>
            <button class="sec-vote nein${mine === false ? ' chosen' : ''}" data-vote="nein">${esc(T.nein)}</button>
          </div>
          <p class="sec-muted sec-center">${mine === null ? 'Votes are revealed once everyone has voted.' : 'You can change your vote until the last one is in.'}</p>`
          : `<p class="sec-muted">You’re dead. The living vote.</p>`}
          <p class="sec-muted sec-center">${g.voted.length} of ${n} voted</p>`);
      }

      case 'president-discard':
        if (pres === me) {
          return panelCard(`Discard one ${esc(T.policy.one)}`, `
            <p>You drew three. Discard one; your ${esc(T.chancellor)} gets the other two. Nobody else sees these.</p>
            ${cards(g.hand, true)}
            ${selectedCard !== null ? `<button class="primary-btn" data-do="discard">Discard ${esc(policyWord(g.hand[selectedCard]))}</button>` : ''}`);
        }
        return panelCard('Legislative session', `<p class="sec-muted">${who(pres)} is choosing a ${esc(T.policy.one)} to discard. No talking until it’s over.</p>`);

      case 'chancellor-enact':
        if (chanc === me) {
          const canVeto = g.vetoUnlocked && !g.vetoDenied;
          return panelCard(`Enact one ${esc(T.policy.one)}`, `
            <p>${who(pres)} passed you two. Enact one; the other is discarded.</p>
            ${cards(g.hand, true)}
            ${selectedCard !== null ? `<button class="primary-btn" data-do="enact">Enact ${esc(policyWord(g.hand[selectedCard]))}</button>` : ''}
            ${canVeto ? `<button class="secondary-btn" data-do="veto">Propose a veto</button>` : ''}
            ${g.vetoDenied ? `<p class="sec-muted">The ${esc(T.president)} refused the veto. You must enact one.</p>` : ''}`);
        }
        return panelCard('Legislative session', `<p class="sec-muted">${who(chanc)} is choosing a ${esc(T.policy.one)} to enact.${g.vetoDenied ? ' The veto was refused.' : ''}</p>`);

      case 'veto':
        if (pres === me) {
          return panelCard('Veto?', `
            <p>${who(chanc)} wants to veto this agenda. If you agree, both ${esc(T.policy.many)} are discarded and the ${esc(T.trackerName.toLowerCase())} moves on.</p>
            <div class="sec-vote-btns">
              <button class="sec-vote ja" data-do="veto-yes">Agree</button>
              <button class="sec-vote nein" data-do="veto-no">Refuse</button>
            </div>`);
        }
        if (chanc === me) return panelCard('Veto proposed', `${cards(g.hand, false)}<p class="sec-muted">Waiting for ${who(pres)} to agree or refuse.</p>`);
        return panelCard('Veto proposed', `<p class="sec-muted">${who(chanc)} asked to veto. ${who(pres)} is deciding.</p>`);

      case 'power':
        return powerPanel(v);

      case 'over':
        return gameOverPanel(v);
    }
    return '';
  }

  function powerPanel(v) {
    const g = v.game, me = v.you?.seat, pw = g.power, def = T.power[pw.type];
    const title = `${def.icon} ${esc(def.name)}`;
    if (g.president !== me) {
      return panelCard(title, `<p>${esc(T.president)} ${who(g.president)} is using this power.</p><p class="sec-muted">${esc(def.desc)}</p>`);
    }
    if (pw.type === 'peek') {
      return panelCard(title, `
        <p>The next three ${esc(T.policy.many)}, top first. Keep it to yourself, or don’t.</p>
        ${cards(pw.cards || [], false)}
        <button class="primary-btn" data-do="power-done">Done</button>`);
    }
    if (pw.type === 'investigate' && pw.result) {
      return panelCard(title, `
        <div class="sec-reveal ${pw.result}">
          <span class="sec-reveal-icon">${T.party[pw.result].icon}</span>
          <span>${who(pw.target)} is a <strong>${esc(partyName(pw.result))}</strong>.</span>
        </div>
        <p class="sec-muted">You can tell the table the truth or lie.</p>
        <button class="primary-btn" data-do="power-done">Done</button>`);
    }
    const verb = { investigate: 'Investigate', special: 'Make them ' + T.president, execute: T.execute.verb }[pw.type];
    return panelCard(title, `
      <p>${esc(def.desc)}</p>
      ${pickList(pw.targets || [], pw.type === 'execute' ? 'danger' : '')}
      ${pendingTarget !== null ? `<button class="primary-btn${pw.type === 'execute' ? ' sec-danger-btn' : ''}" data-do="power">${esc(verb)} ${pw.type === 'special' ? '' : esc(nameOf(pendingTarget))}</button>` : ''}`);
  }

  function gameOverPanel(v) {
    const g = v.game, winner = g.winner;
    const mine = g.party === winner;
    const roles = g.roles.map(r => `
      <div class="sec-final-row ${T.role[r.role] ? r.role : ''}">
        <span>${esc(nameOf(r.seat))}${v.players[r.seat].alive ? '' : ` <span class="sec-dead-tag">${esc(T.execute.dead)}</span>`}</span>
        <span class="sec-final-role ${r.role === 'liberal' ? 'liberal' : 'fascist'}">${T.role[r.role].icon} ${esc(T.role[r.role].name)}</span>
      </div>`).join('');
    return `<div class="sec-over ${winner}">
      <div class="sec-over-icon">${T.party[winner].icon}</div>
      <p class="sec-over-title">${esc(T.party[winner].plural)} win</p>
      <p class="sec-over-reason">${esc(T.win[winner][g.winReason])}</p>
      <p class="sec-over-you">${mine ? 'Your team won.' : 'Your team lost.'}</p>
      <div class="sec-final">${roles}</div>
      ${isController(v)
        ? '<button class="primary-btn" data-do="again">Play again</button>'
        : `<p class="lobby-hint">${esc(v.host?.name || 'The host')} can start another game.</p>`}
    </div>`;
  }

  function playerList(v) {
    const g = v.game, me = v.you?.seat;
    const known = new Map((g.known || []).map(k => [k.seat, k.role]));
    const probed = new Map((g.investigations || []).map(x => [x.target, x.party]));
    const rows = v.players.map(p => {
      const s = p.seat;
      const tags = [];
      const live = g.phase !== 'over';
      if (live && s === g.president) tags.push(`<span class="sec-tag pres">${esc(T.president)}</span>`);
      if (live && s === g.chancellor && g.phase !== 'nominate') tags.push(`<span class="sec-tag chanc">${esc(T.chancellor)}${g.phase === 'vote' ? '?' : ''}</span>`);
      if (g.termLimited?.includes(s)) tags.push('<span class="sec-tag limit">term limit</span>');
      if (g.phase === 'vote' && g.voted.includes(s)) tags.push('<span class="sec-tag voted">voted</span>');
      if (g.phase === 'reveal' && g.ready.includes(s)) tags.push('<span class="sec-tag voted">ready</span>');
      const k = known.get(s);
      const secret = s === me && g.role
        ? `<span class="sec-secret ${g.party}" title="Only you see this">${T.role[g.role].icon}</span>`
        : k ? `<span class="sec-secret fascist" title="${esc(T.role[k].name)}">${T.role[k].icon}</span>`
        : probed.has(s) ? `<span class="sec-secret ${probed.get(s)}" title="You investigated: ${esc(partyName(probed.get(s)))}">${T.party[probed.get(s)].icon}</span>` : '';
      return `<div class="sec-player${p.alive ? '' : ' dead'}${p.you ? ' me' : ''}">
        <span class="sec-seat-no">${s + 1}</span>
        <span class="sec-player-name">${esc(p.name)}${p.you ? ' <span class="lobby-you-tag">you</span>' : ''}${p.connected ? '' : ' <span class="sec-away">away</span>'}${p.alive ? '' : ` <span class="sec-dead-tag">${esc(T.execute.dead)}</span>`}</span>
        <span class="sec-player-tags">${tags.join('')}${secret}</span>
      </div>`;
    }).join('');
    const hostGone = v.host && !v.host.connected && !v.you?.isHost
      ? '<button class="sec-link-btn" data-do="claim-host">The host dropped. Take over hosting</button>' : '';
    return `<p class="section-label">At the table</p>${rows}${hostGone}`;
  }

  // Newest round first; within a round, in the order it happened.
  function logList(g) {
    const rounds = [];
    g.log.forEach(e => { if (e.t === 'round' || !rounds.length) rounds.push([]); rounds[rounds.length - 1].push(e); });
    const lines = rounds.reverse().flat().map(e => {
      switch (e.t) {
        case 'round': return `<div class="sec-log-round">Round ${e.round} · ${esc(T.president)} ${who(e.president)}</div>`;
        case 'election': return `<div>${e.passed ? '✅' : '❌'} ${who(e.president)} + ${who(e.chancellor)} · ${e.ja} ${esc(T.ja)} / ${e.nein} ${esc(T.nein)}</div>`;
        case 'enact': return `<div>📜 Enacted <span class="sec-${e.policy}">${esc(policyWord(e.policy))}</span></div>`;
        case 'chaos': return `<div>🌀 Chaos: <span class="sec-${e.policy}">${esc(policyWord(e.policy))}</span> enacted from the deck</div>`;
        case 'veto': return `<div>✋ Agenda vetoed</div>`;
        case 'veto-denied': return `<div>✋ Veto refused by ${who(e.president)}</div>`;
        case 'reshuffle': return `<div class="sec-muted">🔀 Discards shuffled back into the deck</div>`;
        case 'power': {
          const p = T.power[e.power];
          if (e.power === 'peek') return `<div>${p.icon} ${who(e.president)} peeked at the deck</div>`;
          if (e.power === 'investigate') return `<div>${p.icon} ${who(e.president)} investigated ${who(e.target)}</div>`;
          if (e.power === 'special') return `<div>${p.icon} ${who(e.president)} chose ${who(e.target)} as next ${esc(T.president)}</div>`;
          return `<div>${p.icon} ${who(e.president)} ${esc(T.execute.past)} ${who(e.target)}</div>`;
        }
        case 'over': return `<div><strong>${esc(T.party[e.winner].plural)} win.</strong> ${esc(T.win[e.winner][e.reason])}</div>`;
      }
      return '';
    });
    return lines.join('');
  }

  // ── Game taps ─────────────────────────────────────────────────────────
  $('screen-sec-game').addEventListener('click', e => {
    const v = view;
    if (!v?.game) return;
    const g = v.game;

    const pick = e.target.closest('.sec-pick');
    if (pick) { pendingTarget = +pick.dataset.seat; renderGame(); return; }

    const card = e.target.closest('.sec-card');
    if (card && !card.disabled) { selectedCard = +card.dataset.card; renderGame(); return; }

    const vote = e.target.closest('[data-vote]');
    if (vote) { act('sec:vote', { ja: vote.dataset.vote === 'ja' }); return; }

    const btn = e.target.closest('[data-do]');
    if (!btn) return;
    switch (btn.dataset.do) {
      case 'show-role': openRole(); break;
      case 'ready': act('sec:ready'); break;
      case 'begin': act('sec:begin'); break;
      case 'nominate': if (pendingTarget !== null) act('sec:nominate', { target: pendingTarget }); break;
      case 'discard': if (selectedCard !== null) act('sec:discard', { index: selectedCard }); break;
      case 'enact': if (selectedCard !== null) act('sec:enact', { index: selectedCard }); break;
      case 'veto': act('sec:veto'); break;
      case 'veto-yes': act('sec:veto-answer', { accept: true }); break;
      case 'veto-no': act('sec:veto-answer', { accept: false }); break;
      case 'power':
        if (pendingTarget === null) break;
        if (g.power?.type === 'execute' && !confirm(`${T.execute.verb} ${nameOf(pendingTarget)}? This can’t be undone.`)) break;
        act('sec:power', { target: pendingTarget });
        break;
      case 'power-done': act('sec:power-done'); break;
      case 'again': act('sec:play-again'); break;
      case 'claim-host': act('sec:claim-host'); break;
    }
  });

  // ── Role card ─────────────────────────────────────────────────────────
  function openRole() {
    const g = view?.game;
    if (!g?.role) return;
    const role = T.role[g.role];
    $('sec-role-card').className = `sec-role-card ${g.party}`;
    $('sec-role-party').textContent = `${T.party[g.party].name} team`;
    $('sec-role-icon').textContent = role.icon;
    $('sec-role-name').textContent = role.name;
    $('sec-role-goal').textContent = role.goal;
    let known = '';
    if (g.known?.length) {
      known = `<p class="section-label">You know</p>${g.known.map(k =>
        `<div class="sec-known-row"><span>${esc(nameOf(k.seat))}</span><span>${T.role[k.role].icon} ${esc(T.role[k.role].name)}</span></div>`).join('')}`;
    } else if (g.role === 'hitler') {
      known = `<p class="sec-muted">You don’t know who the ${esc(T.party.fascist.plural)} are. They know you.</p>`;
    } else if (g.role === 'liberal') {
      known = `<p class="sec-muted">You don’t know anyone’s role. Watch the votes.</p>`;
    }
    $('sec-role-known').innerHTML = known;
    $('sec-role-overlay').hidden = false;
  }
  function closeRole() { $('sec-role-overlay').hidden = true; }
  $('sec-role-btn').addEventListener('click', openRole);
  $('sec-role-close').addEventListener('click', closeRole);

  // ── Rules ─────────────────────────────────────────────────────────────
  function openRules() {
    const P = T.president, C = T.chancellor, L = T.party.liberal, F = T.party.fascist, H = T.role.hitler.name;
    $('sec-rules-body').innerHTML = `
      <p class="section-label">How to play ${esc(T.gameName)}</p>
      <p>Players are secretly split into <strong class="sec-liberal">${esc(L.plural)}</strong> and <strong class="sec-fascist">${esc(F.plural)}</strong>. One ${esc(F.name)} is secretly <strong>${esc(H)}</strong>. The ${esc(L.plural)} are the majority but don’t know who anyone is. The ${esc(F.plural)} know each other.</p>
      <p class="sec-rules-h">Each round</p>
      <p>The ${esc(P)} nominates a ${esc(C)}, and everyone votes ${esc(T.ja)} or ${esc(T.nein)}. If most say ${esc(T.ja)}, the ${esc(P)} draws three ${esc(T.policy.many)}, discards one in secret and passes two to the ${esc(C)}, who enacts one. Then the ${esc(P)} role moves to the next seat.</p>
      <p>If the vote fails, the ${esc(T.trackerName.toLowerCase())} moves. Three failures in a row enacts the top ${esc(T.policy.one)} of the deck.</p>
      <p>The last elected ${esc(P)} and ${esc(C)} can’t be nominated ${esc(C)} next (with five players left, only the ${esc(C)}).</p>
      <p class="sec-rules-h">Powers</p>
      <p>Some ${esc(F.name)} ${esc(T.policy.many)} give the ${esc(P)} a power: ${Object.values(T.power).map(p => `${p.icon} <strong>${esc(p.name)}</strong>: ${esc(p.desc)}`).join(' ')}</p>
      <p>After five ${esc(F.name)} ${esc(T.policy.many)}, the ${esc(C)} can propose a veto; if the ${esc(P)} agrees, both cards are thrown away.</p>
      <p class="sec-rules-h">Winning</p>
      <p><strong class="sec-liberal">${esc(L.plural)}</strong>: five ${esc(L.name)} ${esc(T.policy.many)}, or ${esc(H)} is ${esc(T.execute.past)}.</p>
      <p><strong class="sec-fascist">${esc(F.plural)}</strong>: six ${esc(F.name)} ${esc(T.policy.many)}, or ${esc(H)} is elected ${esc(C)} after three ${esc(F.name)} ${esc(T.policy.many)}.</p>
      <p class="sec-muted">Anyone can lie about anything, including what cards they saw.</p>
      <p class="sec-credit">${esc(T.credit)}</p>`;
    $('sec-rules-overlay').hidden = false;
  }
  $('sec-btn-rules').addEventListener('click', openRules);
  $('sec-rules-btn2').addEventListener('click', openRules);
  $('sec-rules-close').addEventListener('click', () => { $('sec-rules-overlay').hidden = true; });
  $('sec-rules-overlay').addEventListener('click', e => { if (e.target.id === 'sec-rules-overlay') $('sec-rules-overlay').hidden = true; });
})();
