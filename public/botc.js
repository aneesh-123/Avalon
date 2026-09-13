// botc.js — client for Blood on the Clocktower. Mirrors imposter.js patterns:
// shares the global socket and showScreen(), keeps its own localStorage session
// and identity token, and re-renders from whatever the server sends.
//
// The phase payload is built per-viewer — your character and private
// information are never in anyone else's state — so there's no shared game
// object to diff against. Note the character shown is the *believed* one: the
// Drunk is never told otherwise.
(function () {
  'use strict';

  function saveBotcSession(d) { localStorage.setItem('botc-session', JSON.stringify(d)); }
  function loadBotcSession()  { try { return JSON.parse(localStorage.getItem('botc-session')); } catch { return null; } }
  function clearBotcSession() { localStorage.removeItem('botc-session'); }

  function botcToken() {
    let t = localStorage.getItem('botc-token');
    if (!t) {
      t = 'bt-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem('botc-token', t);
    }
    return t;
  }
  const token = botcToken();

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const $ = id => document.getElementById(id);

  let myName = '', myRoomCode = '', playerCount = 7;
  let lastState = null, grimoire = null, showGrimoire = false;
  let fortunePicks = [];   // Fortune Teller selects two before confirming
  let slayMode = false;

  $('pick-botc')?.addEventListener('click', () => showScreen('botc-home'));

  socket.on('connect', () => {
    const s = loadBotcSession();
    if (s?.name && s?.code) {
      myName = s.name; myRoomCode = s.code;
      socket.emit('botc:rejoin-room', { code: s.code, name: s.name, token });
    }
  });

  // ── Home / create / join ──────────────────────────────────────────────
  $('botc-btn-create-screen')?.addEventListener('click', () => {
    setPlayerCount(7);
    $('botc-create-error').textContent = '';
    showScreen('botc-create');
  });
  $('botc-btn-join-screen')?.addEventListener('click', () => {
    $('botc-join-error').textContent = '';
    showScreen('botc-join');
  });

  function setPlayerCount(n) {
    playerCount = Math.max(5, Math.min(15, n));
    $('botc-pc-value').textContent = playerCount;
    $('botc-pc-minus').disabled = playerCount <= 5;
    $('botc-pc-plus').disabled  = playerCount >= 15;
  }
  $('botc-pc-minus')?.addEventListener('click', () => setPlayerCount(playerCount - 1));
  $('botc-pc-plus') ?.addEventListener('click', () => setPlayerCount(playerCount + 1));

  $('botc-create-submit')?.addEventListener('click', () => {
    const name = $('botc-create-name').value.trim();
    if (!name) { $('botc-create-error').textContent = 'Enter your name.'; return; }
    myName = name;
    socket.emit('botc:create-room', {
      playerCount, name, token,
      storytellerView: $('botc-st-view').checked,
    });
  });

  $('botc-join-submit')?.addEventListener('click', () => {
    const code = $('botc-join-code').value.trim().toUpperCase();
    const name = $('botc-join-name').value.trim();
    if (code.length !== 5) { $('botc-join-error').textContent = 'Enter a 5-letter room code.'; return; }
    if (!name)             { $('botc-join-error').textContent = 'Enter your name.'; return; }
    myName = name;
    socket.emit('botc:join-room', { code, name, token });
  });

  // ── Lobby ─────────────────────────────────────────────────────────────
  socket.on('botc:room-created', ({ code }) => { myRoomCode = code; saveBotcSession({ name: myName, code }); showScreen('botc-lobby'); });
  socket.on('botc:room-joined',  ({ code }) => { myRoomCode = code; saveBotcSession({ name: myName, code }); showScreen('botc-lobby'); });
  socket.on('botc:join-error', msg => { $('botc-join-error').textContent = msg; $('botc-create-error').textContent = msg; });
  socket.on('botc:action-error', msg => {
    const el = $('botc-action-error');
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 4000);
  });
  socket.on('botc:rejoin-ok', ({ state, claimedName }) => {
    if (claimedName) myName = claimedName;
    if (state !== 'playing') showScreen('botc-lobby');
  });
  socket.on('botc:rejoin-error', () => clearBotcSession());

  socket.on('botc:lobby-update', state => {
    myRoomCode = state.code;
    $('botc-lobby-code').textContent = state.code;
    $('botc-lobby-status').textContent =
      `${state.players.length} of ${state.playerCount} players — ${state.players.filter(p => p.ready).length} ready`;
    $('botc-lobby-players').innerHTML = state.players.map(p => `
      <div class="botc-lobby-row">
        <span class="botc-lobby-name">${esc(p.name)}${p.id === socket.id ? ' <em>(you)</em>' : ''}</span>
        <span class="botc-lobby-ready ${p.ready ? 'is-ready' : ''}">${p.ready ? 'Ready' : 'Waiting'}</span>
      </div>`).join('');
    const me = state.players.find(p => p.id === socket.id);
    const btn = $('botc-ready-btn');
    btn.textContent = me?.ready ? 'Not Ready' : "I'm Ready";
    btn.classList.toggle('btn-unready', !!me?.ready);
  });

  $('botc-ready-btn')?.addEventListener('click', () => socket.emit('botc:toggle-ready'));
  $('botc-lobby-leave')?.addEventListener('click', () => {
    socket.emit('botc:leave-lobby'); clearBotcSession(); showScreen('botc-home');
  });
  $('botc-invite-btn')?.addEventListener('click', async () => {
    const url = `${location.origin}/?room=${encodeURIComponent(myRoomCode)}&game=botc`;
    const label = $('botc-invite-label');
    try { await navigator.clipboard.writeText(url); }
    catch { window.prompt('Copy this invite link:', url); return; }
    label.textContent = 'Link copied!';
    setTimeout(() => { label.textContent = 'Copy invite link'; }, 2000);
  });

  socket.on('botc:game-start', () => showScreen('botc-game'));
  socket.on('botc:grimoire', g => { grimoire = g; if (showGrimoire && lastState) render(lastState); });

  // ── Game ──────────────────────────────────────────────────────────────
  socket.on('botc:phase-update', state => {
    if (state.phase !== 'night') fortunePicks = [];
    lastState = state;
    showScreen('botc-game');
    render(state);
  });

  function render(state) {
    $('botc-game').innerHTML = `
      ${renderHeader(state)}
      ${state.phase === 'game-over' ? renderGameOver(state) : ''}
      ${state.you ? renderYou(state) : ''}
      ${state.phase === 'night'      ? renderNight(state)      : ''}
      ${state.phase === 'day'        ? renderDay(state)        : ''}
      ${state.phase === 'nomination' ? renderNomination(state) : ''}
      ${renderTownSquare(state)}
      ${renderGrimoire(state)}
      <p class="botc-error" id="botc-action-error"></p>
    `;
    wire(state);
  }

  function renderHeader(state) {
    const label = state.phase === 'game-over' ? 'Game Over'
      : state.phase === 'night' ? `Night ${state.nightNumber}`
      : `Day ${state.nightNumber}`;
    // Auto-rejoin drops you straight back into a saved game on load, which is
    // right after a dropped connection but leaves you with no way back to the
    // game picker. This is that way out.
    return `<div class="botc-phase-header">
        <span class="botc-phase-label">${label}</span>
        <button class="botc-leave-btn" id="botc-leave-game">Leave</button>
      </div>`;
  }

  function renderYou(state) {
    const you = state.you;
    const info = you.info.length
      ? you.info.map(i => `<li><span class="botc-info-night">Night ${i.night}</span> ${esc(i.text)}</li>`).join('')
      : '<li class="botc-info-empty">Nothing yet.</li>';
    return `
      <div class="botc-card ${you.alignment === 'evil' ? 'is-evil' : ''}">
        <div class="botc-card-label">You are the</div>
        <div class="botc-card-name">${esc(you.character)}</div>
        <div class="botc-card-blurb">${esc(you.blurb)}</div>
        <div class="botc-card-state">
          ${you.alive ? 'Alive' : 'Dead'}${!you.alive ? (you.ghostVoteUsed ? ' — ghost vote spent' : ' — one ghost vote left') : ''}
        </div>
      </div>
      <div class="botc-info-box">
        <div class="botc-section-label">What you know</div>
        <ul class="botc-info-list">${info}</ul>
      </div>`;
  }

  function renderNight(state) {
    if (state.prompt) {
      const verb = {
        protect: 'Choose a player to protect from the Demon tonight',
        poison:  'Choose a player to poison — their ability malfunctions',
        kill:    'Choose a player to kill tonight',
        master:  'Choose your master — you may only vote when they do',
        fortune: 'Choose two players — you learn if either is the Demon',
        ravenkeeper: 'You died. Choose a player — you learn their character',
      }[state.prompt.type] || 'Choose a player';

      const twoPick = state.prompt.picks === 2;
      const targets = state.players
        .filter(p => state.prompt.type === 'ravenkeeper' ? true : p.alive)
        .map(p => `<button class="botc-target ${fortunePicks.includes(p.id) ? 'is-picked' : ''}"
                     data-target="${p.id}">${esc(p.name)}</button>`).join('');

      return `<div class="botc-prompt">
          <div class="botc-prompt-text">${verb}</div>
          <div class="botc-target-grid">${targets}</div>
          ${twoPick ? `<button class="primary-btn botc-confirm" id="botc-confirm-picks"
                        ${fortunePicks.length === 2 ? '' : 'disabled'}>
                        Confirm ${fortunePicks.length}/2</button>` : ''}
        </div>`;
    }
    return `<div class="botc-waiting">The town sleeps${state.nightWaitingOn ? ' — someone is acting' : ''}…</div>`;
  }

  function renderDay(state) {
    const deaths = state.deathsLastNight.length
      ? `<div class="botc-deaths">Died in the night: <strong>${state.deathsLastNight.map(esc).join(', ')}</strong></div>`
      : `<div class="botc-deaths botc-deaths-none">Nobody died in the night.</div>`;

    const events = (state.dayEvents || []).length
      ? `<div class="botc-events">${state.dayEvents.map(e => `<div>${esc(e)}</div>`).join('')}</div>` : '';

    const last = state.lastNominationResult
      ? `<div class="botc-nom-result">${esc(state.lastNominationResult.nomineeName)} — ${state.lastNominationResult.yes} vote(s), needed ${state.lastNominationResult.threshold}. ${esc(state.lastNominationResult.outcome)}.</div>`
      : '';

    const block = state.onTheBlock
      ? `<div class="botc-block">On the block: <strong>${esc(state.onTheBlock.name)}</strong> (${state.onTheBlock.votes} votes)</div>`
      : `<div class="botc-block botc-block-none">Nobody is on the block.</div>`;

    const canNominate = state.you?.alive && !state.nominations.nominators.includes(state.you.id);
    const action = slayMode ? 'slay' : 'nominate';
    const targets = (canNominate || slayMode)
      ? state.players
          .filter(p => slayMode ? p.alive : !state.nominations.nominated.includes(p.id))
          .map(p => `<button class="botc-target ${slayMode ? 'is-slay' : ''}" data-${action}="${p.id}">${esc(p.name)}</button>`)
          .join('')
      : '';

    return `
      ${deaths}${events}${last}${block}
      ${state.you?.canSlay ? `<button class="secondary-btn botc-slaybtn" id="botc-slay-toggle">
          ${slayMode ? 'Cancel — do not shoot' : 'Claim Slayer and shoot someone'}</button>` : ''}
      ${(canNominate || slayMode)
        ? `<div class="botc-section-label">${slayMode ? 'Shoot which player?' : 'Nominate a player'}</div>
           <div class="botc-target-grid">${targets}</div>`
        : `<div class="botc-waiting">${state.you?.alive ? 'You have already nominated today.' : 'The dead may not nominate.'}</div>`}
      ${state.you?.id === state.hostId
        ? `<button class="primary-btn botc-enddaybtn" id="botc-end-day">End the day${state.onTheBlock ? ` — execute ${esc(state.onTheBlock.name)}` : ' — no execution'}</button>`
        : ''}`;
  }

  function renderNomination(state) {
    const n = state.currentNomination;
    if (!n) return '';
    const voted = n.youVoted !== null;
    return `
      <div class="botc-nomination">
        <div class="botc-nom-title"><strong>${esc(n.nominatorName)}</strong> nominates <strong>${esc(n.nomineeName)}</strong></div>
        <div class="botc-nom-sub">${n.voted.length} vote(s) cast — ${n.threshold} needed to put them on the block</div>
        ${state.you?.canVote && !voted ? `
          <div class="botc-vote-row">
            <button class="botc-vote-btn botc-vote-yes" id="botc-vote-yes">Hand up</button>
            <button class="botc-vote-btn botc-vote-no"  id="botc-vote-no">Hand down</button>
          </div>
          ${!state.you.alive ? '<div class="botc-ghost-warn">Voting yes spends your only ghost vote.</div>' : ''}`
        : `<div class="botc-waiting">${voted ? `You voted ${n.youVoted ? 'yes' : 'no'} — waiting for the rest…` : 'You cannot vote.'}</div>`}
        ${state.you?.id === state.hostId ? '<button class="secondary-btn small" id="botc-close-nom">Close voting early</button>' : ''}
      </div>`;
  }

  function renderTownSquare(state) {
    const seats = state.players.map(p => `
      <div class="botc-seat ${p.alive ? '' : 'is-dead'}">
        <div class="botc-seat-name">${esc(p.name)}</div>
        ${p.character ? `<div class="botc-seat-char ${p.alignment === 'evil' ? 'is-evil' : ''}">${esc(p.character)}</div>` : ''}
        <div class="botc-seat-state">${p.alive ? 'alive' : (p.ghostVoteUsed ? 'dead · vote spent' : 'dead · 1 vote')}</div>
      </div>`).join('');
    return `<div class="botc-section-label">Town Square</div><div class="botc-square">${seats}</div>`;
  }

  function renderGameOver(state) {
    return `<div class="botc-over ${state.winner === 'good' ? 'is-good' : 'is-evil'}">
        <div class="botc-over-winner">${state.winner === 'good' ? 'Good wins' : 'Evil wins'}</div>
        <div class="botc-over-reason">${esc(state.winReason || '')}</div>
      </div>`;
  }

  // The Storyteller's grimoire. Only rendered where the server has agreed to
  // send it — host of an opted-in room, or anyone after the game is over.
  function renderGrimoire(state) {
    const available = (state.storytellerView && state.you?.id === state.hostId) || state.phase === 'game-over';
    if (!available) return '';
    if (!showGrimoire) {
      return `<button class="secondary-btn small botc-grim-toggle" id="botc-grim-toggle">Show Storyteller view</button>`;
    }
    if (!grimoire) return `<button class="secondary-btn small botc-grim-toggle" id="botc-grim-toggle">Hide Storyteller view</button>
      <div class="botc-waiting">Loading grimoire…</div>`;

    const rows = grimoire.players.map(p => `
      <div class="botc-grim-row ${p.alive ? '' : 'is-dead'}">
        <div class="botc-grim-name">${esc(p.name)}</div>
        <div class="botc-grim-char ${p.alignment === 'evil' ? 'is-evil' : ''}">
          ${esc(p.character)}${p.isDrunk ? ` <span class="botc-grim-flag">believes ${esc(p.believedCharacter)}</span>` : ''}
        </div>
        <div class="botc-grim-status">
          ${p.poisoned ? '<span class="botc-grim-flag is-bad">poisoned</span>' : ''}
          ${p.protected ? '<span class="botc-grim-flag is-ok">protected</span>' : ''}
          ${p.abilityWorking ? '' : '<span class="botc-grim-flag is-bad">ability broken</span>'}
        </div>
        ${p.fakeBoard ? `<div class="botc-grim-fake">Fed from fake board: ${esc(p.fakeBoard.join(' · '))}</div>` : ''}
        ${p.info.length ? `<div class="botc-grim-info">${p.info.map(i => esc(i)).join('<br>')}</div>` : ''}
      </div>`).join('');

    return `
      <button class="secondary-btn small botc-grim-toggle" id="botc-grim-toggle">Hide Storyteller view</button>
      <div class="botc-grimoire">
        <div class="botc-section-label">Grimoire</div>
        <div class="botc-grim-meta">
          Red herring: ${esc(grimoire.redHerring || 'none')} ·
          Demon bluffs: ${esc((grimoire.bluffs || []).join(', ') || 'none')}
          ${grimoire.registration ? `<br>Recluse ${grimoire.registration.recluseMisregisters ? `registers as ${esc(grimoire.registration.recluseAs)}` : 'registers truthfully'} ·
            Spy ${grimoire.registration.spyMisregisters ? `registers as ${esc(grimoire.registration.spyAs)}` : 'registers truthfully'}` : ''}
        </div>
        ${rows}
      </div>`;
  }

  function wire(state) {
    document.querySelectorAll('[data-target]').forEach(btn =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.target;
        if (state.prompt?.picks === 2) {
          fortunePicks = fortunePicks.includes(id)
            ? fortunePicks.filter(x => x !== id)
            : [...fortunePicks, id].slice(-2);
          render(state);
        } else {
          socket.emit('botc:night-choice', { targetId: id });
        }
      }));

    $('botc-confirm-picks')?.addEventListener('click', () => {
      if (fortunePicks.length === 2) socket.emit('botc:night-choice', { targetIds: fortunePicks });
    });

    document.querySelectorAll('[data-nominate]').forEach(btn =>
      btn.addEventListener('click', () => socket.emit('botc:nominate', { nomineeId: btn.dataset.nominate })));
    document.querySelectorAll('[data-slay]').forEach(btn =>
      btn.addEventListener('click', () => { slayMode = false; socket.emit('botc:slay', { targetId: btn.dataset.slay }); }));

    $('botc-slay-toggle')?.addEventListener('click', () => { slayMode = !slayMode; render(state); });
    $('botc-vote-yes')?.addEventListener('click', () => socket.emit('botc:vote', { vote: true }));
    $('botc-vote-no') ?.addEventListener('click', () => socket.emit('botc:vote', { vote: false }));
    $('botc-close-nom')?.addEventListener('click', () => socket.emit('botc:close-nomination'));
    $('botc-end-day')  ?.addEventListener('click', () => socket.emit('botc:end-day'));
    $('botc-leave-game')?.addEventListener('click', () => {
      const over = state.phase === 'game-over';
      if (!over && !window.confirm('Leave this game? Your seat will be given up.')) return;
      socket.emit('botc:leave-game');
      clearBotcSession();
      showScreen('picker');
    });
    $('botc-grim-toggle')?.addEventListener('click', () => {
      showGrimoire = !showGrimoire;
      if (showGrimoire) socket.emit('botc:request-grimoire');
      render(state);
    });
  }

  // ── Invite deep link (?room=CODE&game=botc) ────────────────────────────
  const params = new URLSearchParams(location.search);
  if ((params.get('game') || '').toLowerCase() === 'botc') {
    const code = (params.get('room') || '').trim().toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(code)) {
      const prev = loadBotcSession();
      if (prev?.code && prev.code !== code) clearBotcSession();
      $('botc-join-code').value = code;
      showScreen('botc-join');
      setTimeout(() => $('botc-join-name').focus(), 50);
    }
  }
})();
