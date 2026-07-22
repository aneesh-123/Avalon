// imposter.js — client for the Imposter game. Mirrors client.js patterns:
// same socket, localStorage session + stable token, auto-rejoin on connect,
// pause/resume overlay, and phase-driven rendering.
(function () {
  'use strict';

  // ── Session (separate key from Avalon's) ──────────────────────────────
  function saveImpSession(d) { localStorage.setItem('imposter-session', JSON.stringify(d)); }
  function loadImpSession()  { try { return JSON.parse(localStorage.getItem('imposter-session')); } catch { return null; } }
  function clearImpSession() { localStorage.removeItem('imposter-session'); }

  // ── State ─────────────────────────────────────────────────────────────
  let myName     = '';
  let myRoomCode = '';
  let myInfo     = null;   // { displayRole, team, word, category, extra }
  let lastState  = null;
  let myVoted    = false;

  // ── Game picker ───────────────────────────────────────────────────────
  document.getElementById('pick-avalon')?.addEventListener('click', () => showScreen('home'));
  document.getElementById('pick-imposter')?.addEventListener('click', () => showScreen('imp-home'));

  // ── Auto-rejoin on connect (refresh mid-game) ─────────────────────────
  socket.on('connect', () => {
    const s = loadImpSession();
    if (s?.name && s?.code) {
      myName = s.name; myRoomCode = s.code;
      socket.emit('imp:rejoin-room', { code: s.code, name: s.name, token: playerToken });
    }
  });

  // Rejoin banner on imposter home
  const impSaved = loadImpSession();
  if (impSaved?.name && impSaved?.code) {
    document.getElementById('imp-rejoin-banner').style.display = 'block';
    document.getElementById('imp-rejoin-name').textContent = impSaved.name;
  }
  document.getElementById('imp-btn-rejoin')?.addEventListener('click', () => {
    const s = loadImpSession();
    if (!s) return;
    myName = s.name; myRoomCode = s.code;
    socket.emit('imp:rejoin-room', { code: s.code, name: s.name, token: playerToken });
  });

  // ── Create screen ─────────────────────────────────────────────────────
  let impPlayerCount   = 5;
  let impImposterCount = 1;
  const selectedCategories = new Set();
  let categoriesLoaded = false;

  function maxImposters(n) { return Math.min(3, Math.floor((n - 1) / 2)); }

  function revealImpSection(n) {
    const el = document.getElementById(`imp-create-section-${n}`);
    el.style.display = '';
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function renderImpCounts() {
    document.getElementById('imp-pc-value').textContent = impPlayerCount;
    document.getElementById('imp-ic-value').textContent = impImposterCount;
    document.getElementById('imp-pc-minus').disabled = impPlayerCount <= 4;
    document.getElementById('imp-pc-plus').disabled  = impPlayerCount >= 15;
    document.getElementById('imp-ic-minus').disabled = impImposterCount <= 1;
    document.getElementById('imp-ic-plus').disabled  = impImposterCount >= maxImposters(impPlayerCount);
  }

  document.getElementById('imp-btn-create')?.addEventListener('click', () => {
    document.getElementById('imp-create-error').textContent = '';
    impPlayerCount = 5;
    impImposterCount = 1;
    for (let i = 2; i <= 4; i++) document.getElementById(`imp-create-section-${i}`).style.display = 'none';
    renderImpCounts();
    showScreen('imp-create');
  });
  document.getElementById('imp-btn-join-screen')?.addEventListener('click', () => {
    document.getElementById('imp-join-error').textContent = '';
    showScreen('imp-join');
  });

  // Player count changes stay live even after later steps are revealed,
  // so the host can adjust players/imposters without losing their place.
  document.getElementById('imp-pc-minus').addEventListener('click', () => {
    if (impPlayerCount > 4) impPlayerCount--;
    impImposterCount = Math.min(impImposterCount, maxImposters(impPlayerCount));
    renderImpCounts();
  });
  document.getElementById('imp-pc-plus').addEventListener('click', () => {
    if (impPlayerCount < 15) impPlayerCount++;
    renderImpCounts();
  });
  document.getElementById('imp-ic-minus').addEventListener('click', () => {
    if (impImposterCount > 1) impImposterCount--;
    renderImpCounts();
  });
  document.getElementById('imp-ic-plus').addEventListener('click', () => {
    if (impImposterCount < maxImposters(impPlayerCount)) impImposterCount++;
    renderImpCounts();
  });

  document.getElementById('imp-pc-confirm-btn').addEventListener('click', () => {
    revealImpSection(2);
  });
  document.getElementById('imp-ic-confirm-btn').addEventListener('click', () => {
    if (!categoriesLoaded) { socket.emit('imp:get-categories'); categoriesLoaded = true; }
    revealImpSection(3);
  });
  document.getElementById('imp-settings-confirm-btn').addEventListener('click', () => {
    revealImpSection(4);
  });

  socket.on('imp:categories', ({ categories }) => {
    const grid = document.getElementById('imp-category-chips');
    grid.innerHTML = categories.map(c =>
      `<button class="imp-chip ${selectedCategories.has(c) ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    grid.querySelectorAll('.imp-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const c = chip.dataset.cat;
        if (selectedCategories.has(c)) { selectedCategories.delete(c); chip.classList.remove('on'); }
        else { selectedCategories.add(c); chip.classList.add('on'); }
        updateCategoriesSummary();
      });
    });
  });

  function updateCategoriesSummary() {
    const useCustom = document.getElementById('imp-custom-checkbox').checked;
    document.getElementById('imp-categories-summary').textContent = useCustom
      ? 'Custom word'
      : selectedCategories.size ? `${selectedCategories.size} selected` : 'Random';
  }

  function updateRolesSummary() {
    const n = document.querySelectorAll('.imp-roles-list input:checked').length;
    document.getElementById('imp-roles-summary').textContent = n ? `${n} on` : 'Off';
  }
  document.querySelectorAll('.imp-roles-list input').forEach(cb => cb.addEventListener('change', updateRolesSummary));

  // Collapsible "Categories" / "Special Roles" dropdowns
  function wireCallout(toggleId, sectionId, arrowId) {
    document.getElementById(toggleId).addEventListener('click', () => {
      const sec = document.getElementById(sectionId);
      const arrow = document.getElementById(arrowId);
      const open = sec.style.display !== 'none';
      sec.style.display = open ? 'none' : 'block';
      arrow.textContent = open ? '▼' : '▲';
    });
  }
  wireCallout('imp-categories-toggle', 'imp-categories-section', 'imp-categories-arrow');
  wireCallout('imp-roles-toggle', 'imp-roles-section', 'imp-roles-arrow');

  document.getElementById('imp-custom-checkbox').addEventListener('change', e => {
    document.getElementById('imp-custom-fields').style.display = e.target.checked ? 'block' : 'none';
    document.getElementById('imp-category-chips').style.opacity = e.target.checked ? '0.35' : '1';
    document.getElementById('imp-category-chips').style.pointerEvents = e.target.checked ? 'none' : 'auto';
    updateCategoriesSummary();
  });

  document.getElementById('imp-create-submit').addEventListener('click', () => {
    const name = document.getElementById('imp-create-name').value.trim();
    const errEl = document.getElementById('imp-create-error');
    if (!name) { errEl.textContent = 'Please enter your name.'; return; }
    const useCustom = document.getElementById('imp-custom-checkbox').checked;
    const customWord = document.getElementById('imp-custom-word').value.trim();
    if (useCustom && !customWord) { errEl.textContent = 'Enter a custom secret word (or turn off custom mode).'; return; }
    myName = name;
    localStorage.removeItem('avalon-session'); // one active game at a time
    socket.emit('imp:create-room', {
      playerCount: impPlayerCount,
      name, token: playerToken,
      config: {
        imposterCount: impImposterCount,
        impostersKnowEachOther: document.getElementById('imp-know-checkbox').checked,
        hintLevel: document.getElementById('imp-hint-select').value,
        clueRounds: document.getElementById('imp-two-rounds').checked ? 2 : 1,
        allowImposterGuess: document.getElementById('imp-allow-guess').checked,
        specialRoles: {
          detective:   document.getElementById('imp-role-detective').checked,
          confused:    document.getElementById('imp-role-confused').checked,
          doubleAgent: document.getElementById('imp-role-doubleagent').checked,
          accomplice:  document.getElementById('imp-role-accomplice').checked,
          jester:      document.getElementById('imp-role-jester').checked,
        },
        categories: [...selectedCategories],
        customWord:     useCustom ? customWord : null,
        customCategory: useCustom ? document.getElementById('imp-custom-category').value.trim() : null,
        customRelated:  useCustom ? document.getElementById('imp-custom-related').value.trim() : null,
      },
    });
  });

  // ── Join ──────────────────────────────────────────────────────────────
  document.getElementById('imp-join-submit').addEventListener('click', () => {
    const code = document.getElementById('imp-join-code').value.trim().toUpperCase();
    const name = document.getElementById('imp-join-name').value.trim();
    const errEl = document.getElementById('imp-join-error');
    if (!code || code.length !== 5) { errEl.textContent = 'Enter a 5-letter room code.'; return; }
    if (!name)                      { errEl.textContent = 'Enter your name.'; return; }
    myName = name;
    localStorage.removeItem('avalon-session');
    socket.emit('imp:join-room', { code, name, token: playerToken });
  });

  // ── Lobby socket events ───────────────────────────────────────────────
  socket.on('imp:room-created', ({ code }) => {
    myRoomCode = code;
    document.getElementById('imp-lobby-code').textContent = code;
    saveImpSession({ name: myName, code });
    showScreen('imp-lobby');
  });
  socket.on('imp:room-joined', ({ code }) => {
    myRoomCode = code;
    document.getElementById('imp-lobby-code').textContent = code;
    saveImpSession({ name: myName, code });
    showScreen('imp-lobby');
  });
  socket.on('imp:join-error', msg => {
    const joinActive = document.getElementById('screen-imp-join').classList.contains('active');
    if (joinActive) document.getElementById('imp-join-error').textContent = msg;
    else document.getElementById('imp-create-error').textContent = msg;
  });
  socket.on('imp:game-in-progress', ({ disconnectedSlots }) => {
    const errEl = document.getElementById('imp-join-error');
    errEl.textContent = disconnectedSlots.length
      ? 'A game is in progress. If you were playing, enter your name exactly as you joined and try again.'
      : 'A game is already in progress in that room.';
  });
  socket.on('imp:rejoin-ok', ({ state, claimedName }) => {
    if (claimedName) myName = claimedName;
    myRoomCode = myRoomCode || loadImpSession()?.code || '';
    document.getElementById('imp-lobby-code').textContent = myRoomCode;
    saveImpSession({ name: myName, code: myRoomCode });
    if (state === 'playing') { preparePlacard(); showScreen('imp-placard'); }
    else showScreen('imp-lobby');
  });
  socket.on('imp:rejoin-error', () => { clearImpSession(); });

  socket.on('imp:lobby-update', state => {
    const { players, playerCount: needed } = state;
    const me = players.find(p => p.id === socket.id);
    const joined = players.length, full = joined === needed;
    const readyCount = players.filter(p => p.ready).length;

    document.getElementById('imp-lobby-status').textContent =
      full ? `All ${needed} players joined!` : `Waiting for players… (${joined}/${needed})`;

    document.getElementById('imp-lobby-players').innerHTML = players.map(p => {
      const isMe = p.name === myName;
      return `<div class="lobby-player ${p.ready ? 'ready' : ''}${isMe ? ' lobby-me' : ''}">
         <span class="lobby-player-name">${esc(p.name)}${isMe ? ' <span class="lobby-you-tag">You</span>' : ''}</span>
         <span class="lobby-player-status">${p.ready ? '✓ Ready' : 'Waiting'}</span>
       </div>`;
    }).join('');

    const readyBtn = document.getElementById('imp-ready-btn');
    if (full) {
      readyBtn.style.display = 'block';
      readyBtn.textContent = me?.ready ? 'Unready' : "I'm Ready";
      readyBtn.className = 'primary-btn' + (me?.ready ? ' btn-unready' : '');
    } else {
      readyBtn.style.display = 'none';
    }
    document.getElementById('imp-lobby-hint').textContent =
      full ? `Game starts when all ${needed} players are ready. (${readyCount}/${needed} ready)` : '';
  });

  document.getElementById('imp-ready-btn').addEventListener('click', () => socket.emit('imp:toggle-ready'));
  document.getElementById('imp-lobby-leave').addEventListener('click', () => {
    socket.emit('imp:leave-lobby');
    clearImpSession();
    location.reload();
  });

  // ── Role / word card ──────────────────────────────────────────────────
  socket.on('imp:your-role', info => { myInfo = info; });

  function cardHTML() {
    if (!myInfo) return '';
    const teamCls = myInfo.team;   // 'regular' | 'imposter' | 'jester'
    const banner = myInfo.team === 'imposter' ? '💀 Imposter Team'
                 : myInfo.team === 'jester'   ? '🃏 Independent'
                 : '⚔ Regular Team';
    return `
      <div class="imp-card ${teamCls}">
        <div class="imp-card-banner ${teamCls}">${banner}</div>
        <div class="imp-card-role">${esc(myInfo.displayRole)}</div>
        ${myInfo.category ? `<div class="imp-card-category">Category: <strong>${esc(myInfo.category)}</strong></div>` : ''}
        ${myInfo.word
          ? `<div class="imp-card-word-label">The secret word is</div><div class="imp-card-word">${esc(myInfo.word)}</div>`
          : `<div class="imp-card-noword">You do NOT know the word</div>`}
        ${myInfo.extra ? `<div class="imp-card-extra">${esc(myInfo.extra)}</div>` : ''}
      </div>`;
  }

  function preparePlacard() {
    document.getElementById('imp-placard-name').textContent = myName;
    document.getElementById('imp-rcb-placard').textContent = myRoomCode;
    const placard = document.getElementById('imp-placard');
    placard.classList.remove('seen');
    placard.innerHTML = `
      <div class="placard-crest">🕵️</div>
      <div class="placard-label">${esc(myName)}</div>
      <div class="placard-tap-hint">Tap to reveal</div>`;
    document.getElementById('imp-to-game-btn').style.display = 'none';
  }

  document.getElementById('imp-placard').addEventListener('click', () => {
    showImpRoleOverlay();
    document.getElementById('imp-to-game-btn').style.display = 'block';
  });
  document.getElementById('imp-to-game-btn').addEventListener('click', () => {
    showScreen('imp-game');
    if (lastState) renderImpGame(lastState);
  });

  function showImpRoleOverlay() {
    const overlay = document.getElementById('imp-role-overlay');
    document.getElementById('imp-role-card').innerHTML = cardHTML() +
      '<button class="primary-btn" id="imp-card-close" style="margin-top:18px;">✓ Got it — hide my card</button>';
    overlay.style.display = 'flex';
    document.getElementById('imp-card-close').addEventListener('click', () => {
      overlay.style.display = 'none';
    }, { once: true });
  }
  document.getElementById('imp-show-card-btn').addEventListener('click', showImpRoleOverlay);

  // ── Game flow ─────────────────────────────────────────────────────────
  socket.on('imp:game-start', () => {
    myVoted = false;
    preparePlacard();
    showScreen('imp-placard');
  });

  socket.on('imp:phase-update', state => {
    lastState = state;
    document.getElementById('imp-rcb-game').textContent = myRoomCode;
    const onGame = document.getElementById('screen-imp-game').classList.contains('active');
    if (onGame) renderImpGame(state);
  });

  socket.on('imp:revote', () => { myVoted = false; });

  function renderImpGame(state) {
    const header = document.getElementById('imp-game-header');
    const el = document.getElementById('imp-game-content');
    const me = socket.id;
    const isHost = state.hostId === me;

    header.innerHTML = `
      <div class="imp-header-row">
        ${state.category ? `<span class="imp-header-cat">📁 ${esc(state.category)}</span>` : '<span class="imp-header-cat">📁 Category hidden</span>'}
        <span class="imp-header-imps">🕵️ ${state.imposterCount} imposter${state.imposterCount > 1 ? 's' : ''}</span>
        ${state.clueRounds > 1 ? `<span class="imp-header-round">Round ${state.clueRound}/${state.clueRounds}</span>` : ''}
      </div>`;

    const cluesHTML = state.clues.length ? `
      <div class="imp-clue-list">
        ${state.clues.map(cl => `
          <div class="imp-clue-row${cl.playerId === me ? ' mine' : ''}">
            <span class="imp-clue-name">${esc(cl.name)}${state.clueRounds > 1 ? ` <em>(r${cl.round})</em>` : ''}</span>
            <span class="imp-clue-text">${esc(cl.text)}</span>
          </div>`).join('')}
      </div>` : '';

    if (state.phase === 'clue') {
      const myTurn = state.currentCluerId === me;
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">Clue Time</div>
          <div class="phase-sub">${myTurn
            ? 'It\'s <strong>your</strong> turn — give a one-word (or short) clue about the word.'
            : `Waiting for <strong>${esc(state.currentCluerName || '?')}</strong> to give a clue…`}</div>
        </div>
        ${cluesHTML}
        ${myTurn ? `
          <div class="imp-clue-input-row">
            <input id="imp-clue-input" class="name-input-solo" type="text" placeholder="Your clue…" maxlength="60" autocomplete="off">
            <button class="primary-btn" id="imp-clue-submit" style="margin-top:10px;">Submit Clue →</button>
          </div>` : `
          <div class="imp-turn-order">
            ${state.clueOrder.map((id, i) => {
              const p = state.players.find(pl => pl.id === id);
              const done = i < state.clueIndex;
              const now  = i === state.clueIndex;
              return `<span class="imp-order-chip ${done ? 'done' : now ? 'now' : ''}">${esc(p?.name || '?')}</span>`;
            }).join('')}
          </div>`}`;
      if (myTurn) {
        const input = document.getElementById('imp-clue-input');
        const send = () => {
          const text = input.value.trim();
          if (!text) return;
          socket.emit('imp:submit-clue', { text });
        };
        document.getElementById('imp-clue-submit').addEventListener('click', send);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
        input.focus();
      }
      return;
    }

    if (state.phase === 'discussion') {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">Discussion</div>
          <div class="phase-sub">All clues are in. Talk it out — who doesn't know the word?</div>
        </div>
        ${cluesHTML}
        ${isHost
          ? `<button class="primary-btn" id="imp-start-vote-btn" style="margin-top:20px;">Start the Vote →</button>`
          : `<div class="all-voted-msg">The host starts the vote when the group is ready…</div>`}`;
      document.getElementById('imp-start-vote-btn')?.addEventListener('click', () => socket.emit('imp:start-vote'));
      return;
    }

    if (state.phase === 'vote') {
      const iVoted = !!state.votes[me] || myVoted;
      const votedCount = Object.keys(state.votes).length;
      const candidates = state.voteCandidates
        ? state.players.filter(p => state.voteCandidates.includes(p.id))
        : state.players;
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">${state.voteRound === 2 ? 'Revote — tie breaker' : 'Vote'}</div>
          <div class="phase-sub">${state.voteRound === 2
            ? 'The first vote tied. Choose between the tied players. Another tie and the Imposters win!'
            : 'Who is the Imposter? Votes stay hidden until everyone has voted.'}</div>
        </div>
        ${cluesHTML}
        ${iVoted
          ? `<div class="voted-msg">Your vote is in — waiting for others… (${votedCount}/${state.players.length})</div>`
          : `<div id="imp-vote-list">
              ${candidates.filter(p => p.id !== me).map(p => `
                <div class="pick-player imp-vote-pick" data-id="${p.id}">
                  <span class="pick-name">${esc(p.name)}</span>
                  <span class="pick-check"></span>
                </div>`).join('')}
            </div>
            <button class="primary-btn" id="imp-vote-submit" disabled style="margin-top:16px;">Select a player</button>`}
        <div class="quest-count">${votedCount}/${state.players.length} voted</div>`;

      if (!iVoted) {
        let target = null;
        el.querySelectorAll('.imp-vote-pick').forEach(row => {
          row.addEventListener('click', () => {
            el.querySelectorAll('.imp-vote-pick').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            target = row.dataset.id;
            const btn = document.getElementById('imp-vote-submit');
            btn.disabled = false;
            btn.textContent = `Vote for ${state.players.find(p => p.id === target)?.name || ''}`;
          });
        });
        document.getElementById('imp-vote-submit')?.addEventListener('click', () => {
          if (!target) return;
          myVoted = true;
          socket.emit('imp:cast-vote', { targetId: target });
        });
      }
      return;
    }

    if (state.phase === 'imposter-guess') {
      const accusedMe = state.accusedId === me;
      if (accusedMe) {
        el.innerHTML = `
          <div class="phase-header">
            <div class="phase-title" style="color:#ff8888;">You've been caught!</div>
            <div class="phase-sub">One last chance — guess the secret word to steal the win.</div>
          </div>
          ${cluesHTML}
          <input id="imp-guess-input" class="name-input-solo" type="text" placeholder="Your guess…" maxlength="60" autocomplete="off" style="margin-top:12px;">
          <button class="primary-btn evil-action-btn" id="imp-guess-submit" style="margin-top:12px;">🗡 Final Guess</button>`;
        const input = document.getElementById('imp-guess-input');
        const send = () => {
          const guess = input.value.trim();
          if (!guess) return;
          socket.emit('imp:guess-word', { guess });
        };
        document.getElementById('imp-guess-submit').addEventListener('click', send);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
        input.focus();
      } else {
        el.innerHTML = `
          <div class="phase-header">
            <div class="phase-title">${esc(state.accusedName || '?')} was voted out!</div>
            <div class="phase-sub">They're on the Imposter team — but they get one final guess at the word…</div>
          </div>
          <div class="waiting-pulse">🗡️</div>`;
      }
      return;
    }

    if (state.phase === 'game-over') {
      const w = state.winner;
      const banner = w === 'regular'  ? { icon: '⚔️', title: 'Regular Players Win!', cls: 'good' }
                   : w === 'imposter' ? { icon: '🕵️', title: 'Imposters Win!',       cls: 'evil' }
                   :                    { icon: '🃏', title: 'The Jester Wins!',      cls: 'jester' };

      const rolesHTML = state.revealedRoles ? `
        <div class="roles-reveal">
          <div class="roles-reveal-title">True Roles</div>
          ${state.revealedRoles.map(p => `
            <div class="role-reveal-row ${p.team === 'imposter' ? 'evil' : 'good'}">
              <span class="rr-name">${esc(p.name)}</span>
              <span class="rr-role">${p.team === 'jester' ? '🃏 ' : ''}${esc(p.role)}</span>
            </div>`).join('')}
        </div>` : '';

      const votesHTML = state.voteHistory?.length ? `
        <div class="replay-section">
          <div class="replay-title">Vote Breakdown</div>
          ${state.voteHistory.map(round => `
            <div class="replay-card pass">
              <div class="replay-card-header"><span class="replay-q">${round.round === 2 ? 'Revote' : 'Vote'}</span></div>
              ${round.tallies.map(t => `
                <div class="imp-tally-row">
                  <strong>${esc(t.name)}</strong> — ${t.votes} vote${t.votes !== 1 ? 's' : ''}
                  <span class="imp-tally-voters">(${t.voters.map(esc).join(', ')})</span>
                </div>`).join('')}
            </div>`).join('')}
        </div>` : '';

      el.innerHTML = `
        <div class="game-over-box ${banner.cls === 'jester' ? 'evil' : banner.cls}">
          <div class="go-icon">${banner.icon}</div>
          <div class="go-title" ${banner.cls === 'jester' ? 'style="color:#ce93d8;"' : ''}>${banner.title}</div>
          ${state.winReason ? `<div class="go-reason">${esc(state.winReason)}</div>` : ''}
          <div class="imp-word-reveal">The word was <strong>${esc(state.secretWord || '?')}</strong>
            ${state.secretCategory ? `<span class="imp-word-cat">(${esc(state.secretCategory)})</span>` : ''}</div>
          ${rolesHTML}
          ${votesHTML}
          <button class="primary-btn" id="imp-new-game-btn" style="margin-top:24px;">← New Game</button>
        </div>`;
      document.getElementById('imp-new-game-btn').addEventListener('click', () => {
        socket.emit('imp:leave-game');
        clearImpSession();
        location.reload();
      });
      return;
    }
  }

  // ── Pause / resume ────────────────────────────────────────────────────
  function wireImpPauseLeave() {
    const btn = document.getElementById('imp-pause-leave-btn');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    let armed = false, timer = null;
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Tap again to confirm leaving';
        btn.classList.add('armed');
        timer = setTimeout(() => { armed = false; btn.textContent = 'Leave Game'; btn.classList.remove('armed'); }, 3000);
        return;
      }
      clearTimeout(timer);
      socket.emit('imp:leave-game');
      clearImpSession();
      location.reload();
    });
  }

  socket.on('imp:game-paused', ({ disconnected }) => {
    document.getElementById('imp-pause-body').innerHTML =
      `Waiting for <strong>${esc(disconnected.join(', '))}</strong> to reconnect…`;
    document.getElementById('imp-rcb-pause').textContent = myRoomCode;
    document.getElementById('imp-pause-overlay').style.display = 'flex';
    wireImpPauseLeave();
    document.getElementById('imp-pause-card-btn').onclick = e => { e.stopPropagation(); showImpRoleOverlay(); };
  });

  socket.on('imp:game-resumed', () => {
    document.getElementById('imp-pause-overlay').style.display = 'none';
  });
})();
