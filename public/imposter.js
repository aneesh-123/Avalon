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
  let myRound    = 1;      // elimination round the client last rendered

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

  // Deep link — /?imp=CODE opens straight on the Imposter join screen with the
  // code filled in, so a playtest run can hand over a ready-to-join browser.
  // Any stale session is cleared first, or auto-rejoin would fight it for the
  // active screen on connect.
  const deepLinkParams = new URLSearchParams(location.search);
  const deepLinkCode = (deepLinkParams.get('imp') || '').trim().toUpperCase();
  const deepLinkName = (deepLinkParams.get('name') || '').trim().slice(0, 20);
  // A reload keeps the query string, so this block runs again mid-game. Only
  // treat the link as a fresh join when it points somewhere the player is not
  // already seated — otherwise clearing the session would destroy the very
  // thing auto-rejoin needs to put them back.
  const savedForDeepLink = loadImpSession();
  if (deepLinkCode && savedForDeepLink?.code === deepLinkCode) {
    // Already in this room: leave the session alone, auto-rejoin handles it.
  } else if (deepLinkCode) {
    clearImpSession();
    document.getElementById('imp-rejoin-banner').style.display = 'none';
    document.getElementById('imp-join-code').value = deepLinkCode;
    document.getElementById('imp-join-error').textContent = '';
    showScreen('imp-join');
    if (deepLinkName) {
      // Name supplied too — seat the player outright. A playtest browser should
      // open already in the lobby, not on a form.
      document.getElementById('imp-join-name').value = deepLinkName;
      setTimeout(() => document.getElementById('imp-join-submit').click(), 120);
    } else {
      setTimeout(() => document.getElementById('imp-join-name')?.focus(), 60);
    }
  }

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

  let categoryWordList = {};
  let previewedCategory = null;
  let serverCategories = [];
  const CUSTOM_CATEGORY = 'Your Words';
  const ownWords = [];

  socket.on('imp:categories', ({ categories, words }) => {
    categoryWordList = words || {};
    serverCategories = categories;
    renderCategoryChips();
  });

  function renderCategoryChips() {
    const categories = ownWords.length ? [...serverCategories, CUSTOM_CATEGORY] : serverCategories;
    categoryWordList[CUSTOM_CATEGORY] = [...ownWords];
    const grid = document.getElementById('imp-category-chips');
    // Each chip toggles selection; the ⓘ opens a peek at that category's words
    // so the host knows what they are actually picking.
    grid.innerHTML = categories.map(c => `
      <span class="imp-chip-wrap">
        <button class="imp-chip ${selectedCategories.has(c) ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>
        <button class="imp-chip-peek" data-peek="${esc(c)}" aria-label="See words in ${esc(c)}">ⓘ</button>
      </span>`).join('') + '<div id="imp-chip-preview" class="imp-chip-preview" style="display:none;"></div>';

    grid.querySelectorAll('.imp-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const c = chip.dataset.cat;
        if (selectedCategories.has(c)) { selectedCategories.delete(c); chip.classList.remove('on'); }
        else { selectedCategories.add(c); chip.classList.add('on'); }
        updateCategoriesSummary();
      });
    });

    grid.querySelectorAll('.imp-chip-peek').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const c = btn.dataset.peek;
        const panel = document.getElementById('imp-chip-preview');
        if (previewedCategory === c) {          // tapping the same one closes it
          previewedCategory = null;
          panel.style.display = 'none';
          return;
        }
        previewedCategory = c;
        const list = categoryWordList[c] || [];
        panel.innerHTML = `
          <div class="imp-preview-head">${esc(c)} — ${list.length} words</div>
          <div class="imp-preview-words">${list.map(w => `<span>${esc(w)}</span>`).join('')}</div>`;
        panel.style.display = 'block';
      });
    });
  }

  // ── Host-added words ──────────────────────────────────────────────────
  function renderOwnWords() {
    const list = document.getElementById('imp-ownword-list');
    list.innerHTML = ownWords.map((w, i) => `
      <span class="imp-ownword-chip">${esc(w)}<button class="imp-ownword-x" data-i="${i}" aria-label="Remove ${esc(w)}">×</button></span>`).join('');
    list.querySelectorAll('.imp-ownword-x').forEach(btn => {
      btn.addEventListener('click', () => {
        ownWords.splice(parseInt(btn.dataset.i, 10), 1);
        // Dropping the last word takes the category with it.
        if (!ownWords.length) selectedCategories.delete(CUSTOM_CATEGORY);
        renderOwnWords();
        renderCategoryChips();
        updateCategoriesSummary();
      });
    });
  }

  function addOwnWord() {
    const input = document.getElementById('imp-ownword-input');
    const word = input.value.trim().slice(0, 40);
    if (!word) return;
    if (ownWords.some(w => w.toLowerCase() === word.toLowerCase())) { input.value = ''; return; }
    ownWords.push(word);
    // Adding a word switches its category on — otherwise it silently would not
    // be used unless the host also noticed the new chip.
    selectedCategories.add(CUSTOM_CATEGORY);
    input.value = '';
    renderOwnWords();
    renderCategoryChips();
    updateCategoriesSummary();
    input.focus();
  }

  document.getElementById('imp-ownword-add')?.addEventListener('click', addOwnWord);
  document.getElementById('imp-ownword-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addOwnWord(); }
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
        customWords: [...ownWords],
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
    // Never persist an empty code — a session without one fails the
    // `s?.code` guard on connect, so the player silently loses auto-rejoin
    // and has no way back into the game.
    if (myRoomCode) saveImpSession({ name: myName, code: myRoomCode });
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
    myRound = 1;
    preparePlacard();
    showScreen('imp-placard');
  });

  socket.on('imp:phase-update', state => {
    // A new elimination round clears the votes server-side. myVoted is a local
    // guard against the gap between clicking and the server echoing back, so it
    // has to be cleared too — otherwise every client believes it has already
    // voted, renders "waiting for others", and the round deadlocks with nobody
    // able to act.
    if (state.round !== myRound) { myRound = state.round; myVoted = false; }
    lastState = state;
    document.getElementById('imp-rcb-game').textContent = myRoomCode;
    const onGame = document.getElementById('screen-imp-game').classList.contains('active');
    // Rejoining sends players to the placard so they can privately re-read
    // their card. A finished game has nothing left to hide, so don't strand
    // someone behind a "tap to reveal" while everyone else sees the result.
    if (!onGame && state.phase === 'game-over') {
      showScreen('imp-game');
      renderImpGame(state);
      return;
    }
    if (onGame) renderImpGame(state);
  });

  socket.on('imp:revote', () => { myVoted = false; });

  function renderImpGame(state) {
    const header = document.getElementById('imp-game-header');
    const el = document.getElementById('imp-game-content');
    const me = socket.id;
    const isHost = state.hostId === me;

    const iAmOut = state.players.find(p => p.id === me)?.eliminated;
    const found = state.impostersFound || 0;
    const totalImps = state.impostersTotal || state.imposterCount;
    const impsLeft = totalImps - found;

    header.innerHTML = `
      <div class="imp-header-row">
        ${state.category ? `<span class="imp-header-cat">📁 ${esc(state.category)}</span>` : '<span class="imp-header-cat">📁 Category hidden</span>'}
        <span class="imp-header-imps">🕵️ ${found > 0
          ? `${impsLeft} of ${totalImps} imposter${totalImps > 1 ? 's' : ''} left`
          : `${totalImps} imposter${totalImps > 1 ? 's' : ''}`}</span>
        ${state.round > 1 ? `<span class="imp-header-round">Round ${state.round}</span>` : ''}
        ${state.clueRounds > 1 ? `<span class="imp-header-round">Clue ${state.clueRound}/${state.clueRounds}</span>` : ''}
      </div>`;

    // Who has been ejected so far, and what they turned out to be. Public
    // information — each ejection is announced as it happens.
    const eliminatedHTML = (state.eliminationLog || []).length ? `
      <div class="imp-elim-list">
        ${state.eliminationLog.map(e => `
          <div class="imp-elim-row ${e.wasImposter ? 'was-imposter' : 'was-crew'}">
            <span class="imp-elim-name">${esc(e.name)}</span>
            <span class="imp-elim-verdict">${e.wasImposter ? '🕵️ was an Imposter' : '⚔ was not an Imposter'}</span>
            ${e.guess ? `<span class="imp-elim-guess">guessed “${esc(e.guess)}” — ${e.guessCorrect ? 'correct' : 'wrong'}</span>` : ''}
          </div>`).join('')}
      </div>` : '';

    // Private to imposters who were told their team. Built entirely from
    // myInfo, which arrived on this socket alone — it is never part of the
    // broadcast state, so it cannot leak to the rest of the table. Statuses
    // come from the public elimination log, so the panel stays current as
    // teammates are caught.
    const teammates = (myInfo?.teammates || []);
    const teamPanel = teammates.length && state.phase !== 'game-over' ? `
      <div class="imp-team-panel">
        <div class="imp-team-title">🤝 Your team — only you see this</div>
        ${teammates.map(name => {
          const caught = (state.eliminationLog || []).some(e => e.name === name);
          return `<div class="imp-team-row ${caught ? 'caught' : 'alive'}">
              <span class="imp-team-name">${esc(name)}</span>
              <span class="imp-team-status">${caught ? 'caught' : 'still in'}</span>
            </div>`;
        }).join('')}
        <div class="imp-team-row you"><span class="imp-team-name">You</span>
          <span class="imp-team-status">${iAmOut ? 'caught' : 'still in'}</span></div>
      </div>` : '';

    // Eliminated players watch, but take no further part.
    const outBanner = iAmOut && state.phase !== 'game-over' ? `
      <div class="imp-out-banner">
        You have been voted out. You can watch the rest of the round, but you
        cannot give clues or vote.
      </div>` : '';

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
        ${outBanner}
        ${teamPanel}
        ${eliminatedHTML}
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
        ${outBanner}
        ${teamPanel}
        ${eliminatedHTML}
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
      const activeTotal = state.activeCount;
      const isRevote = state.voteRound === 2 && !!state.voteCandidates;
      const stillIn = state.players.filter(p => !p.eliminated);
      const candidates = state.voteCandidates
        ? stillIn.filter(p => state.voteCandidates.includes(p.id))
        : stillIn;

      // A revote silently shortens the candidate list, which reads as "why did
      // the names change?" — so name who tied and spell out the stakes.
      const tiedNames = candidates.map(p => p.name);
      const tiedList = tiedNames.length === 2
        ? `<strong>${esc(tiedNames[0])}</strong> and <strong>${esc(tiedNames[1])}</strong>`
        : tiedNames.map((n, i) =>
            `${i === tiedNames.length - 1 ? 'and ' : ''}<strong>${esc(n)}</strong>`).join(', ');
      const iAmTied = !!state.voteCandidates && state.voteCandidates.includes(me);

      // Show exactly where the previous round's votes went, so a table that
      // failed to reach a majority can see why before voting again.
      const lastRound = isRevote && state.voteHistory?.length
        ? state.voteHistory[state.voteHistory.length - 1] : null;
      const breakdown = lastRound ? `
        <div class="imp-vote-breakdown">
          <div class="imp-breakdown-title">Round ${lastRound.round} results — ${lastRound.majorityNeeded} votes needed</div>
          ${lastRound.tallies.map(t => `
            <div class="imp-breakdown-row${state.voteCandidates?.includes(t.id) ? ' still-in' : ''}">
              <span class="imp-bd-name">${esc(t.name)}</span>
              <span class="imp-bd-count">${t.votes}</span>
              <span class="imp-bd-voters">${t.voters.map(esc).join(', ')}</span>
            </div>`).join('')}
        </div>` : '';

      const tieBanner = isRevote ? `
        <div class="imp-tie-banner">
          No one reached a majority — <strong>${state.majorityNeeded} of ${state.players.length}</strong> votes are
          needed to eject someone. ${tiedNames.length === state.players.length
            ? 'Everyone is still on the ballot.'
            : `The ballot narrows to ${tiedList}.`}
          <span class="imp-tie-stakes">Vote ${state.voteRound} of 3 — if no one has a majority after the third, the Imposters win.</span>
          ${iAmTied ? '<span class="imp-tie-self">You are on the ballot, so you cannot vote for yourself.</span>' : ''}
        </div>` : '';

      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">${isRevote ? 'No Majority — Vote Again' : 'Vote'}</div>
          <div class="phase-sub">${isRevote
            ? `Vote ${state.voteRound} of 3.`
            : `Who is the Imposter? It takes <strong>${state.majorityNeeded} of ${activeTotal}</strong> votes to eject someone. Votes stay hidden until everyone has voted.`}</div>
        </div>
        ${tieBanner}
        ${breakdown}
        ${teamPanel}
        ${eliminatedHTML}
        ${cluesHTML}
        ${iAmOut
          ? `<div class="imp-out-banner">You are out of the game — you cannot vote in this round.</div>`
          : iVoted
          ? `<div class="voted-msg">Your vote is in — waiting for others… (${votedCount}/${state.players.length})</div>`
          : `<div class="imp-vote-label">${isRevote ? 'Still on the ballot — pick one' : 'Who do you suspect?'}</div>
            <div id="imp-vote-list">
              ${candidates.filter(p => p.id !== me).map(p => `
                <div class="pick-player imp-vote-pick" data-id="${p.id}">
                  <span class="pick-name">${esc(p.name)}</span>
                  <span class="pick-check"></span>
                </div>`).join('')}
            </div>
            <button class="primary-btn" id="imp-vote-submit" disabled style="margin-top:16px;">Select a player</button>`}
        <div class="quest-count">${votedCount}/${state.activeCount} voted</div>`;

      if (!iVoted && !iAmOut) {
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
            <div class="phase-title">${esc(state.accusedName || '?')} was an Imposter!</div>
            <div class="phase-sub">They get one guess at the secret word. Guess right and the Imposters steal the win outright.</div>
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

  // ── Pass-and-play (one phone) ─────────────────────────────────────────
  // No lobby, no sockets during play: the server deals the roles in one
  // request and this device walks the table, showing each card in turn.
  const SOLO_NAMES_KEY = 'imposter-solo-names';
  let soloNames = [];
  let soloDeal = null;      // [{ name, info }]
  let soloSeen = new Set();   // indexes whose card has been opened
  let soloOpenIndex = null;
  let soloSecret = null;    // { word, category, roles }
  let soloImposters = 1;

  try { soloNames = JSON.parse(localStorage.getItem(SOLO_NAMES_KEY)) || []; } catch { soloNames = []; }
  const saveSoloNames = () => localStorage.setItem(SOLO_NAMES_KEY, JSON.stringify(soloNames));

  function soloMaxImposters() { return Math.max(1, Math.min(3, Math.floor((soloNames.length - 1) / 2))); }

  function renderSoloNames() {
    const list = document.getElementById('imp-solo-name-list');
    list.innerHTML = soloNames.map((n, i) => `
      <span class="imp-ownword-chip">${esc(n)}<button class="imp-ownword-x" data-i="${i}" aria-label="Remove ${esc(n)}">×</button></span>`).join('');
    list.querySelectorAll('.imp-ownword-x').forEach(btn => {
      btn.addEventListener('click', () => {
        soloNames.splice(parseInt(btn.dataset.i, 10), 1);
        saveSoloNames();
        renderSoloNames();
      });
    });
    soloImposters = Math.min(soloImposters, soloMaxImposters());
    document.getElementById('imp-solo-ic-value').textContent = soloImposters;
    document.getElementById('imp-solo-ic-minus').disabled = soloImposters <= 1;
    document.getElementById('imp-solo-ic-plus').disabled  = soloImposters >= soloMaxImposters();
    document.getElementById('imp-solo-count').textContent = soloNames.length
      ? `${soloNames.length} player${soloNames.length === 1 ? '' : 's'}${soloNames.length < 4 ? ' — need at least 4' : ''}`
      : 'No players yet.';
    renderSoloBalance();
  }


  /**
   * Live team balance for the one-phone setup. Mirrors the server's
   * teamBreakdown so the host sees which side each role lands on *while*
   * choosing, instead of only meeting a rejection at the end. The server
   * still validates — this is guidance, not the gate.
   */
  function renderSoloBalance() {
    const el = document.getElementById('imp-solo-balance');
    if (!el) return;
    const n = soloNames.length;
    if (n < 4) { el.innerHTML = ''; return; }

    const on = id => document.getElementById(id)?.checked;
    const impParts = [`${soloImposters} Imposter${soloImposters === 1 ? '' : 's'}`];
    if (on('imp-solo-role-doubleagent')) impParts.push('Double Agent');
    if (on('imp-solo-role-accomplice'))  impParts.push('Accomplice');
    const impSide = soloImposters
      + (on('imp-solo-role-doubleagent') ? 1 : 0)
      + (on('imp-solo-role-accomplice') ? 1 : 0);
    const jester = on('imp-solo-role-jester');
    const regSide = n - impSide - (jester ? 1 : 0);

    const regParts = [];
    if (on('imp-solo-role-detective')) regParts.push('Detective');
    if (on('imp-solo-role-confused'))  regParts.push('Confused');
    const plain = regSide - regParts.length;
    if (plain > 0) regParts.push(`${plain} Regular${plain === 1 ? '' : 's'}`);

    const ok = regSide > impSide && regSide >= 1;
    el.className = 'imp-balance' + (ok ? '' : ' bad');
    el.innerHTML = `
      <div class="imp-balance-row">
        <span class="imp-balance-side evil">Imposter team <strong>${impSide}</strong></span>
        <span class="imp-balance-vs">vs</span>
        <span class="imp-balance-side good">Regular team <strong>${Math.max(0, regSide)}</strong></span>
      </div>
      <div class="imp-balance-detail">${esc(impParts.join(' + '))} &nbsp;·&nbsp; ${esc(regParts.join(' + ') || 'nobody')}</div>
      ${jester ? '<div class="imp-balance-note">🃏 Jester takes a seat but plays for neither side.</div>' : ''}
      ${ok ? '' : '<div class="imp-balance-note bad">The Regular team has to outnumber the Imposter team. Double Agent and Accomplice both count as Imposters.</div>'}`;
  }

  function addSoloName() {
    const input = document.getElementById('imp-solo-name-input');
    const name = input.value.trim().slice(0, 20);
    if (!name) return;
    if (soloNames.some(n => n.toLowerCase() === name.toLowerCase())) { input.value = ''; return; }
    if (soloNames.length >= 15) return;
    soloNames.push(name);
    saveSoloNames();
    input.value = '';
    renderSoloNames();
    input.focus();
  }

  document.getElementById('imp-btn-solo')?.addEventListener('click', () => {
    document.getElementById('imp-solo-error').textContent = '';
    renderSoloNames();
    showScreen('imp-solo-setup');
  });
  document.getElementById('imp-solo-name-add')?.addEventListener('click', addSoloName);
  document.getElementById('imp-solo-name-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addSoloName(); }
  });
  document.getElementById('imp-solo-ic-minus')?.addEventListener('click', () => {
    if (soloImposters > 1) soloImposters--;
    renderSoloNames();
  });
  document.getElementById('imp-solo-ic-plus')?.addEventListener('click', () => {
    if (soloImposters < soloMaxImposters()) soloImposters++;
    renderSoloNames();
  });
  wireCallout('imp-solo-roles-toggle', 'imp-solo-roles-section', 'imp-solo-roles-arrow');
  document.querySelectorAll('#imp-solo-roles-section input').forEach(cb => {
    cb.addEventListener('change', () => {
      const n = document.querySelectorAll('#imp-solo-roles-section input:checked').length;
      document.getElementById('imp-solo-roles-summary').textContent = n ? `${n} on` : 'Off';
      renderSoloBalance();
    });
  });

  function requestSoloDeal() {
    document.getElementById('imp-solo-error').textContent = '';
    socket.emit('imp:solo-deal', {
      names: soloNames,
      config: {
        imposterCount: soloImposters,
        impostersKnowEachOther: document.getElementById('imp-solo-know').checked,
        hintLevel: document.getElementById('imp-solo-hint').value,
        specialRoles: {
          detective:   document.getElementById('imp-solo-role-detective').checked,
          confused:    document.getElementById('imp-solo-role-confused').checked,
          doubleAgent: document.getElementById('imp-solo-role-doubleagent').checked,
          accomplice:  document.getElementById('imp-solo-role-accomplice').checked,
          jester:      document.getElementById('imp-solo-role-jester').checked,
        },
      },
    });
  }
  document.getElementById('imp-solo-start')?.addEventListener('click', requestSoloDeal);
  document.getElementById('imp-solo-again')?.addEventListener('click', requestSoloDeal);
  document.getElementById('imp-solo-again-2')?.addEventListener('click', requestSoloDeal);
  document.getElementById('imp-solo-home')?.addEventListener('click', () => showScreen('imp-home'));

  socket.on('imp:solo-error', msg => {
    document.getElementById('imp-solo-error').textContent = msg;
    showScreen('imp-solo-setup');
  });

  // Roles present in a game, with what each one does. Shown on the setup
  // screen before choosing, and again as a reference once play starts.
  const IMP_ROLE_INFO = {
    'Imposter':     { icon: '🕵️', team: 'evil',  desc: 'Does not know the word. Bluffs from the clues alone, and gets one guess at the word if voted out.' },
    'Double Agent': { icon: '🎭', team: 'evil',  desc: 'Imposter team. Does not know the word, but holds a close-but-wrong one as partial info.' },
    'Accomplice':   { icon: '🤝', team: 'evil',  desc: 'Knows the word and who the imposters are, but wins with them. No final guess if caught.' },
    'Regular':      { icon: '⚔',  team: 'good',  desc: 'Knows the word. Give a clue that proves it without handing it to the imposters.' },
    'Detective':    { icon: '🔍', team: 'good',  desc: 'Knows the word, and is told for certain that one named player is a regular.' },
    'Confused':     { icon: '😵', team: 'good',  desc: 'Regular team, but was given a different word and does not know it.' },
    'Jester':       { icon: '🃏', team: 'jester', desc: 'Knows the word and plays for nobody. Wins alone if the group votes them out.' },
  };
  const IMP_ROLE_ORDER = ['Imposter', 'Double Agent', 'Accomplice', 'Regular', 'Detective', 'Confused', 'Jester'];

  socket.on('imp:solo-dealt', ({ deal, roles, secretWord, category }) => {
    soloDeal = deal;
    soloSeen = new Set();
    soloSecret = { word: secretWord, category, roles };
    renderSoloGrid();
    showScreen('imp-solo-pass');
  });

  // Everyone is on screen at once and taps their own name, so the phone can go
  // round in whatever order suits the table rather than a forced sequence.
  function renderSoloGrid() {
    const grid = document.getElementById('imp-solo-grid');
    grid.innerHTML = soloDeal.map((entry, i) => `
      <button class="imp-solo-tile${soloSeen.has(i) ? ' seen' : ''}" data-i="${i}">
        <span class="imp-solo-tile-name">${esc(entry.name)}</span>
        <span class="imp-solo-tile-state">${soloSeen.has(i) ? '✓ seen' : 'tap to reveal'}</span>
      </button>`).join('');
    grid.querySelectorAll('.imp-solo-tile').forEach(tile => {
      tile.addEventListener('click', () => openSoloCard(parseInt(tile.dataset.i, 10)));
    });

    const left = soloDeal.length - soloSeen.size;
    document.getElementById('imp-solo-grid-hint').textContent = left
      ? `Still waiting on ${left} ${left === 1 ? 'player' : 'players'}.`
      : 'Everyone has seen their role.';
    document.getElementById('imp-solo-to-play').style.display = left ? 'none' : 'block';
  }

  function openSoloCard(i) {
    const { info } = soloDeal[i];
    const teamCls = info.team;
    const banner = info.team === 'imposter' ? '💀 Imposter Team'
                 : info.team === 'jester'   ? '🃏 Independent'
                 : '⚔ Regular Team';
    document.getElementById('imp-solo-card-body').innerHTML = `
      <div class="imp-card ${teamCls}">
        <div class="imp-card-banner ${teamCls}">${banner}</div>
        <div class="imp-card-role">${esc(info.displayRole)}</div>
        ${info.category ? `<div class="imp-card-category">Category: <strong>${esc(info.category)}</strong></div>` : ''}
        ${info.word
          ? `<div class="imp-card-word-label">The secret word is</div><div class="imp-card-word">${esc(info.word)}</div>`
          : `<div class="imp-card-noword">You do NOT know the word</div>`}
        ${info.extra ? `<div class="imp-card-extra">${esc(info.extra)}</div>` : ''}
      </div>`;
    document.getElementById('imp-solo-card-overlay').style.display = 'flex';
    soloOpenIndex = i;
  }

  document.getElementById('imp-solo-card-close')?.addEventListener('click', () => {
    document.getElementById('imp-solo-card-overlay').style.display = 'none';
    if (soloOpenIndex !== null) soloSeen.add(soloOpenIndex);
    soloOpenIndex = null;
    renderSoloGrid();
  });

  /** Which roles are in play and what they do — never who holds them. */
  function renderSoloRolesRef() {
    const counts = {};
    soloSecret.roles.forEach(r => { counts[r.role] = (counts[r.role] || 0) + 1; });
    const present = IMP_ROLE_ORDER.filter(r => counts[r]);
    document.getElementById('imp-solo-roles-ref').innerHTML = `
      <div class="rrp-title">Roles in this game</div>
      ${present.map(r => {
        const info = IMP_ROLE_INFO[r];
        const badge = counts[r] > 1 ? `<span class="rrp-count">×${counts[r]}</span>` : '';
        return `<div class="rrp-row ${info.team === 'evil' ? 'evil' : 'good'}">
            <div class="rrp-role-name">${info.icon} ${esc(r)}${badge}</div>
            <div class="rrp-desc">${info.desc}</div>
          </div>`;
      }).join('')}`;
  }

  document.getElementById('imp-solo-to-play')?.addEventListener('click', () => {
    document.getElementById('imp-solo-summary').innerHTML = `
      <div class="imp-solo-summary-row"><span>Players</span><strong>${soloDeal.length}</strong></div>
      <div class="imp-solo-summary-row"><span>Imposters</span><strong>${soloImposters}</strong></div>
      ${soloSecret.category ? `<div class="imp-solo-summary-row"><span>Category</span><strong>${esc(soloSecret.category)}</strong></div>` : ''}`;
    renderSoloRolesRef();
    showScreen('imp-solo-play');
  });

  document.getElementById('imp-solo-reveal-btn')?.addEventListener('click', () => {
    document.getElementById('imp-solo-word').textContent = soloSecret.word;
    document.getElementById('imp-solo-cat').textContent =
      soloSecret.category ? `(${soloSecret.category})` : '';
    document.getElementById('imp-solo-roles').innerHTML = soloSecret.roles.map(r => {
      const evil = ['Imposter', 'Double Agent', 'Accomplice'].includes(r.role);
      return `<div class="role-reveal-row ${evil ? 'evil' : 'good'}">
          <span class="rr-name">${esc(r.name)}</span>
          <span class="rr-role">${r.role === 'Jester' ? '🃏 ' : ''}${esc(r.role)}</span>
        </div>`;
    }).join('');
    showScreen('imp-solo-reveal');
  });
})();
