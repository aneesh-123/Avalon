// tutorial.js — Interactive first-time tutorial (no server needed)
(function () {
  'use strict';

  // ── Cast ──────────────────────────────────────────────────────────────
  const CAST = [
    { name: 'You',    role: 'Merlin',            evil: false },
    { name: 'Alice',  role: 'Loyal Servant',     evil: false },
    { name: 'Bob',    role: 'Loyal Servant',     evil: false },
    { name: 'Claire', role: 'Assassin',          evil: true  },
    { name: 'David',  role: 'Minion of Mordred', evil: true  },
  ];

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Progress + back/forward navigation ────────────────────────────────
  const TOTAL = 10;
  let currentScene = 0;
  let maxVisited   = 0;   // furthest scene reached — "Next ›" can jump up to here

  function updateHeader() {
    const prog = document.getElementById('tut-progress');
    if (prog) prog.textContent = `Step ${currentScene + 1} of ${TOTAL}`;
    const prev = document.getElementById('tut-prev');
    const next = document.getElementById('tut-next-nav');
    if (prev) prev.disabled = currentScene === 0;
    if (next) next.disabled = currentScene >= maxVisited || currentScene >= TOTAL - 1;
  }

  // ── Continue button helper ────────────────────────────────────────────
  function addNext(container, label, cb) {
    const btn = document.createElement('button');
    btn.className = 'primary-btn tut-next-btn';
    btn.textContent = label || 'Continue →';
    btn.addEventListener('click', cb, { once: true });
    container.appendChild(btn);
    return btn;
  }

  // ── Scene runner ──────────────────────────────────────────────────────
  function enterScene(n) {
    if (n >= TOTAL) { showScreen('home'); return; }
    currentScene = n;
    maxVisited = Math.max(maxVisited, n);
    updateHeader();
    const body = document.getElementById('tut-body');
    body.innerHTML = '';
    body.scrollTop = 0;
    SCENES[n](body, () => enterScene(n + 1));
  }

  // Small helper — a row of players styled like the in-game roster
  function castRow(p, { showAlignment = false, revealDelayIdx = null } = {}) {
    const align = showAlignment
      ? `<span class="tut-player-tag ${p.name === 'You' ? 'you' : p.evil ? 'evil' : 'good'}">
           ${p.name === 'You' ? 'Merlin' : p.evil ? '💀 Evil' : '⚔ Good'}
         </span>`
      : '';
    return `<div class="tut-player-row ${showAlignment && p.evil ? 'evil' : 'good'}"
                 ${revealDelayIdx !== null ? `id="tpr-${revealDelayIdx}" style="opacity:0;transform:translateX(-16px)"` : ''}>
      <span class="tut-player-name">${p.name === 'You' ? '⭐ You' : esc(p.name)}</span>
      ${align}
    </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 0 — Welcome
  // ══════════════════════════════════════════════════════════════════════
  function sceneWelcome(c, next) {
    c.innerHTML = `
      <div class="tut-scene tut-welcome">
        <div class="tut-castle-icon">⚔️</div>
        <h2 class="tut-title">Welcome to Avalon</h2>
        <p class="tut-sub">A hidden-identity game of deception, trust, and strategy.</p>
        <div class="tut-teams-row">
          <div class="tut-team good">
            <div class="tut-team-icon">⚔</div>
            <div class="tut-team-name">Good</div>
            <div class="tut-team-desc">Complete quests to win</div>
          </div>
          <div class="tut-vs">vs</div>
          <div class="tut-team evil">
            <div class="tut-team-icon">💀</div>
            <div class="tut-team-name">Evil</div>
            <div class="tut-team-desc">Sabotage them to win</div>
          </div>
        </div>
        <p class="tut-note">⏱ About 4 minutes. Use ‹ Back / Next › above to revisit any step.</p>
      </div>`;
    addNext(c, 'Start →', next);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 1 — Win conditions (IF Good… / IF Evil…)
  // ══════════════════════════════════════════════════════════════════════
  function sceneWinConditions(c, next) {
    const sizes = [2, 3, 2, 3, 3];
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">How to Win</h2>

        <div class="tut-win-block">
          <div class="tut-if-label good">IF you are <strong>Good</strong>…</div>
          <div class="tut-win-label good">…win 3 quests and you win the game</div>
          <div class="tut-track-row" id="tut-track-g">
            ${sizes.map((s,i) => `<div class="ct-dot" id="tgd-${i}"><span>${s}</span></div>`).join('')}
          </div>
        </div>

        <div class="tut-win-block" id="tut-evil-block" style="opacity:0;transition:opacity 0.5s;">
          <div class="tut-if-label evil">IF you are <strong>Evil</strong>…</div>
          <div class="tut-win-label evil">…fail 3 quests, OR identify Merlin at the end</div>
          <div class="tut-track-row" id="tut-track-e">
            ${sizes.map((s,i) => `<div class="ct-dot" id="ted-${i}"><span>${s}</span></div>`).join('')}
          </div>
        </div>

        <div class="tut-callout" id="tut-twist" style="opacity:0;transition:opacity 0.5s;">
          ⚡ Even if Good completes 3 quests, Evil's Assassin gets one final shot at guessing who Merlin is. A correct guess steals the win.
        </div>
      </div>`;

    let i = 0;
    const passGood = () => {
      const dot = document.getElementById(`tgd-${i}`);
      if (dot) { dot.classList.add('pass'); dot.innerHTML = '✔'; }
      i++;
      if (i < 3) {
        setTimeout(passGood, 650);
      } else {
        setTimeout(() => {
          const evilBlock = document.getElementById('tut-evil-block');
          if (evilBlock) evilBlock.style.opacity = '1';
          let j = 0;
          const failEvil = () => {
            const dot = document.getElementById(`ted-${j}`);
            if (dot) { dot.classList.add('fail'); dot.innerHTML = '✘'; }
            j++;
            if (j < 3) setTimeout(failEvil, 600);
            else {
              setTimeout(() => {
                const twist = document.getElementById('tut-twist');
                if (twist) twist.style.opacity = '1';
                setTimeout(() => addNext(c, 'Got it →', next), 600);
              }, 500);
            }
          };
          setTimeout(failEvil, 300);
        }, 700);
      }
    };
    setTimeout(passGood, 400);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 2 — Meet the players (no roles revealed yet)
  // ══════════════════════════════════════════════════════════════════════
  function sceneMeetPlayers(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Your Table</h2>
        <p class="tut-sub">Five players are in this game — you and four others. Some of them are secretly Evil, but right now <strong>nobody knows who</strong>.</p>
        <div class="tut-player-list" id="tut-cast-list">
          ${CAST.map((p, i) => castRow(p, { revealDelayIdx: i })).join('')}
        </div>
        <div class="tut-callout" id="tut-meet-note" style="opacity:0;transition:opacity 0.4s;">
          Every player has just been dealt a secret role card. Time to look at yours…
        </div>
      </div>`;

    CAST.forEach((_, i) => {
      setTimeout(() => {
        const row = document.getElementById(`tpr-${i}`);
        if (!row) return;
        row.style.transition = 'opacity 0.35s, transform 0.35s';
        row.style.opacity = '1';
        row.style.transform = 'translateX(0)';
        if (i === CAST.length - 1) {
          setTimeout(() => {
            const note = document.getElementById('tut-meet-note');
            if (note) note.style.opacity = '1';
            setTimeout(() => addNext(c, 'See my role →', next), 400);
          }, 350);
        }
      }, 200 + i * 160);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 3 — Role reveal (tap to flip, gameplay-style card with "You can see")
  // ══════════════════════════════════════════════════════════════════════
  function sceneRoleReveal(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Your Secret Role</h2>
        <p class="tut-sub">This is exactly what the role card looks like in a real game.</p>
        <div class="tut-card-wrap">
          <div class="tut-role-card" id="tut-role-card">
            <div class="tut-card-crest">⚜️</div>
            <div class="tut-card-hint">Tap to reveal</div>
          </div>
        </div>
      </div>`;

    document.getElementById('tut-role-card').addEventListener('click', () => {
      const card = document.getElementById('tut-role-card');
      card.style.opacity = '0';
      card.style.transition = 'opacity 0.15s';
      setTimeout(() => {
        card.classList.add('revealed');
        // Mirrors the real in-game role overlay: allegiance banner, portrait,
        // name, description, then the "You can see" known-players block.
        card.innerHTML = `
          <div class="tut-card-allegiance good">Good — Loyal to Arthur</div>
          ${roleArt('Merlin', 'large')}
          <div class="tut-card-role-name">Merlin</div>
          <div class="tut-card-role-desc">You secretly know who the Evil players are. Stay hidden — if the Assassin identifies you at the end, Evil wins.</div>
          <div class="tut-card-known">
            <div class="tut-card-known-title">You can see:</div>
            <div class="tut-known-entry evil">Claire — Evil</div>
            <div class="tut-known-entry evil">David — Evil</div>
          </div>`;
        card.style.transition = 'opacity 0.25s';
        card.style.opacity = '1';
        setTimeout(() => addNext(c, 'Continue →', next), 400);
      }, 150);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 4 — What Merlin sees at the table
  // ══════════════════════════════════════════════════════════════════════
  function sceneEvilRevealed(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">What You Know</h2>
        <p class="tut-sub">Here's the same table — but through <strong>Merlin's eyes</strong>. No one else sees this.</p>
        <div class="tut-player-list" id="tut-cast-list">
          ${CAST.map((p, i) => castRow(p, { showAlignment: true, revealDelayIdx: i })).join('')}
        </div>
        <div class="tut-callout" id="tut-merlin-warn" style="opacity:0;transition:opacity 0.4s;margin-top:16px;">
          ⚠ Guide Good to victory — but subtly. If Evil figures out you're Merlin, the Assassin wins the game at the end.
        </div>
      </div>`;

    CAST.forEach((_, i) => {
      setTimeout(() => {
        const row = document.getElementById(`tpr-${i}`);
        if (!row) return;
        row.style.transition = 'opacity 0.35s, transform 0.35s';
        row.style.opacity = '1';
        row.style.transform = 'translateX(0)';
        if (i === CAST.length - 1) {
          setTimeout(() => {
            const warn = document.getElementById('tut-merlin-warn');
            if (warn) warn.style.opacity = '1';
            setTimeout(() => addNext(c, 'Continue →', next), 500);
          }, 400);
        }
      }, 200 + i * 180);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 5 — Team proposal & vote (Alice proposes David + You)
  // ══════════════════════════════════════════════════════════════════════
  function sceneTeamProposal(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Team Proposal</h2>
        <p class="tut-sub">The Leader picks a team for each quest. Everyone then votes on it.</p>
        <div class="tut-leader-row">
          <span class="tut-crown">👑</span>
          <span><strong>Alice</strong> is the Leader. She proposes:</span>
        </div>
        <div class="proposed-team" style="margin:16px 0;">
          <span class="team-chip">David</span>
          <span class="team-chip">You</span>
        </div>
        <div class="tut-callout" style="margin:0 0 8px;">
          🤫 Remember — you know David is Evil. But no one else does…
        </div>
        <div class="tut-vote-prompt">Do you approve this team?</div>
        <div class="vote-btns" id="tut-vote-btns" style="margin-top:12px;">
          <button class="vote-btn approve-btn" id="tut-approve">✓ Approve</button>
          <button class="vote-btn reject-btn" id="tut-reject">✗ Reject</button>
        </div>
        <div id="tut-vote-log" style="margin-top:16px;"></div>
        <div id="tut-vote-outcome" style="display:none;"></div>
      </div>`;

    function handleVote(myVote) {
      document.getElementById('tut-vote-btns').innerHTML =
        `<div class="voted-msg">You voted <strong>${myVote === 'approve' ? '✓ Approve' : '✗ Reject'}</strong> — revealing all votes…</div>`;

      const votes = [
        { name: 'You',    vote: myVote },
        { name: 'Alice',  vote: 'approve' },
        { name: 'Bob',    vote: 'approve' },
        { name: 'Claire', vote: 'approve' },
        { name: 'David',  vote: 'approve' },
      ];
      const approves = votes.filter(v => v.vote === 'approve').length;

      const log = document.getElementById('tut-vote-log');
      let shown = 0;
      let html = '<div class="vote-roster">';

      const revealNext = () => {
        html += `<div class="vote-row ${votes[shown].vote}">
          <span>${esc(votes[shown].name)}</span>
          <span class="vote-tag">${votes[shown].vote === 'approve' ? '✓ Approve' : '✗ Reject'}</span>
        </div>`;
        log.innerHTML = html + '</div>';
        shown++;
        if (shown < votes.length) {
          setTimeout(revealNext, 380);
        } else {
          const outcomeEl = document.getElementById('tut-vote-outcome');
          outcomeEl.style.display = 'block';
          outcomeEl.className = 'tut-outcome-banner good';
          outcomeEl.innerHTML = `✓ Team Approved — ${approves} vs ${votes.length - approves}. A majority of yes votes sends the team on the quest.`;
          setTimeout(() => addNext(c, 'On to the Quest →', next), 500);
        }
      };
      setTimeout(revealNext, 200);
    }

    document.getElementById('tut-approve').addEventListener('click', () => handleVote('approve'), { once: true });
    document.getElementById('tut-reject').addEventListener('click',  () => handleVote('reject'),  { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 6 — Quest voting & card reveal (You + David; David fails it)
  // ══════════════════════════════════════════════════════════════════════
  function sceneQuestVote(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">The Quest</h2>
        <p class="tut-sub">You and <strong>David</strong> are on the quest. Each of you votes in secret.</p>
        <div class="tut-callout">Good players can only play <strong>Pass</strong>. Evil players may choose to Fail.</div>
        <div class="quest-vote-btns" style="margin-top:20px;" id="tut-qbtns">
          <button class="qvote-btn pass-btn" id="tut-qpass">✔ Pass</button>
          <button class="qvote-btn fail-btn" id="tut-qfail" disabled style="opacity:0.35;cursor:not-allowed;">✘ Fail</button>
        </div>
        <div id="tut-qresult"></div>
      </div>`;

    document.getElementById('tut-qpass').addEventListener('click', () => {
      document.getElementById('tut-qbtns').innerHTML =
        '<div class="voted-msg">✔ You played Pass — David is voting…</div>';

      setTimeout(() => {
        const res = document.getElementById('tut-qresult');
        res.innerHTML = `
          <div class="fail-cards" id="tut-cards">
            <div class="fail-card face-down" id="tcard-0">?</div>
            <div class="fail-card face-down" id="tcard-1">?</div>
          </div>
          <div id="tut-csum" style="opacity:0;text-align:center;margin-top:12px;line-height:1.5;transition:opacity 0.4s;"></div>`;

        setTimeout(() => {
          const c0 = document.getElementById('tcard-0');
          if (c0) { c0.classList.remove('face-down'); c0.classList.add('pass','flip-in'); c0.textContent = '✔'; }
        }, 700);

        setTimeout(() => {
          const c1 = document.getElementById('tcard-1');
          if (c1) { c1.classList.remove('face-down'); c1.classList.add('fail','flip-in'); c1.textContent = '✘'; }
        }, 2100);

        setTimeout(() => {
          const sum = document.getElementById('tut-csum');
          if (sum) {
            sum.innerHTML = '<strong style="color:#ff6b6b;font-size:1.1rem;">Quest Failed!</strong><br>'
              + '<span style="color:#8a7a5a;font-size:0.88rem;">David secretly played a Fail card.<br>One Fail is all it takes — but the votes are anonymous, so only YOU know it was him.</span>';
            sum.style.opacity = '1';
            setTimeout(() => addNext(c, 'Continue →', next), 600);
          }
        }, 3600);
      }, 1000);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 7 — Discussion (alignment tags + strategic multiple choice)
  // ══════════════════════════════════════════════════════════════════════
  function sceneDiscussion(c, next) {
    const messages = [
      { from: 'Bob',    evil: false, text: 'David was on that quest. That Fail came from him.' },
      { from: 'David',  evil: true,  text: 'Wasn\'t me. It could just as easily have been a bluffed vote count.' },
      { from: 'Alice',  evil: false, text: 'I wasn\'t even on the team — it was David or… well.' },
      { from: 'Claire', evil: true,  text: 'Honestly, Bob is pointing fingers awfully fast. That\'s suspicious too.' },
    ];

    const choices = [
      {
        text: '"I\'m Merlin — I can SEE that David is Evil. Vote him out!"',
        correct: false,
        feedback: '❌ You just revealed yourself. Even if Good wins every quest now, the Assassin knows exactly who to kill. Evil wins.',
      },
      {
        text: '"The numbers don\'t lie — David was on the failed quest. I don\'t trust him."',
        correct: true,
        feedback: '✅ Exactly. You steered suspicion using public evidence anyone could cite — without hinting that you secretly know.',
      },
      {
        text: 'Stay completely silent every round so nobody suspects you of anything.',
        correct: false,
        feedback: '❌ Too passive. Merlin\'s entire value is nudging Good toward the truth. Saying nothing wastes your knowledge — and never talking is itself suspicious.',
      },
    ];

    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Discussion</h2>
        <p class="tut-sub">After each quest, players debate — who played that Fail? The tags show what <strong>only you</strong> (Merlin) know.</p>
        <div class="tut-chat" id="tut-chat"></div>
        <div id="tut-mc-area" style="display:none;">
          <p class="tut-sub" style="margin-top:20px;margin-bottom:10px;">You know David is Evil. What's the most <strong>strategic</strong> thing to say?</p>
          <div id="tut-mc-options">
            ${choices.map((ch, i) => `
              <button class="tut-mc-option" data-i="${i}">${esc(ch.text)}</button>`).join('')}
          </div>
          <div id="tut-mc-feedback" style="display:none;"></div>
        </div>
      </div>`;

    const chat = document.getElementById('tut-chat');
    let i = 0;
    const showNextMsg = () => {
      if (i >= messages.length) {
        setTimeout(() => {
          document.getElementById('tut-mc-area').style.display = 'block';
          wireChoices();
        }, 300);
        return;
      }
      const m = messages[i++];
      const bubble = document.createElement('div');
      bubble.className = 'tut-bubble';
      bubble.innerHTML = `
        <span class="tut-bubble-from">${esc(m.from)}
          <span class="tut-align-tag ${m.evil ? 'evil' : 'good'}">${m.evil ? '💀 secretly Evil' : '⚔ secretly Good'}</span>
        </span>
        <span class="tut-bubble-text">${esc(m.text)}</span>`;
      chat.appendChild(bubble);
      chat.scrollTop = chat.scrollHeight;
      setTimeout(showNextMsg, 1400);
    };

    function wireChoices() {
      const feedbackEl = document.getElementById('tut-mc-feedback');
      document.querySelectorAll('.tut-mc-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const ch = choices[parseInt(btn.dataset.i, 10)];
          document.querySelectorAll('.tut-mc-option').forEach(b => b.classList.remove('correct', 'wrong'));
          btn.classList.add(ch.correct ? 'correct' : 'wrong');
          feedbackEl.style.display = 'block';
          feedbackEl.className = `tut-mc-feedback ${ch.correct ? 'good' : 'evil'}`;
          feedbackEl.textContent = ch.feedback;
          if (ch.correct && !document.getElementById('tut-mc-continue')) {
            const nb = addNext(c.querySelector('.tut-scene'), 'Continue →', next);
            nb.id = 'tut-mc-continue';
          }
        });
      });
    }

    setTimeout(showNextMsg, 300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 8 — Fast-forward then assassination
  // ══════════════════════════════════════════════════════════════════════
  function sceneAssassination(c, next) {
    const sizes = [2, 3, 2, 3, 3];
    const results = ['fail', 'pass', 'pass', 'pass', null];

    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Good wins… almost.</h2>
        <p class="tut-sub">The quests continued. After four rounds:</p>
        <div class="tut-track-row" style="margin:20px 0;" id="tut-atrack">
          ${sizes.map((s,i) => `<div class="ct-dot" id="tad-${i}"><span>${s}</span></div>`).join('')}
        </div>
        <div id="tut-assassin-scene" style="display:none;">
          <div class="tut-assassin-box">
            <div class="tut-asn-icon">🗡</div>
            <div class="tut-asn-title">The Assassination</div>
            <div class="tut-asn-body">Good completed 3 quests — but now the Assassin gets one final shot. Claire has been watching you all game.</div>
          </div>
          <div class="tut-target-row" id="tut-target-row" style="opacity:0;transition:opacity 0.4s,transform 0.4s;transform:scale(0.95)">
            <div class="tut-target-chip evil">
              Claire 🗡 → You (Merlin)
            </div>
          </div>
          <div id="tut-gameover" style="display:none;" class="tut-gameover-box evil">
            <div class="go-icon">💀</div>
            <div class="go-title">Evil Wins!</div>
            <div class="go-reason">The Assassin correctly identified Merlin.<br><small style="color:#8a7a5a">Good completed the quests, but Merlin's influence was too visible.</small></div>
          </div>
        </div>
      </div>`;

    let i = 0;
    const stepTrack = () => {
      if (results[i] === null) {
        setTimeout(() => {
          const asn = document.getElementById('tut-assassin-scene');
          if (asn) asn.style.display = 'block';
          setTimeout(() => {
            const tr = document.getElementById('tut-target-row');
            if (tr) { tr.style.opacity = '1'; tr.style.transform = 'scale(1)'; }
            setTimeout(() => {
              const go = document.getElementById('tut-gameover');
              if (go) go.style.display = 'block';
              setTimeout(() => addNext(c, 'Continue →', next), 600);
            }, 1800);
          }, 1200);
        }, 500);
        return;
      }
      const dot = document.getElementById(`tad-${i}`);
      if (dot && results[i]) {
        dot.classList.add(results[i]);
        dot.innerHTML = results[i] === 'pass' ? '✔' : '✘';
      }
      i++;
      setTimeout(stepTrack, 700);
    };
    setTimeout(stepTrack, 400);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 9 — Completion checklist + role spotlights
  // ══════════════════════════════════════════════════════════════════════
  const ROLE_SPOTLIGHTS = {
    'Percival': {
      allegiance: 'good',
      allegianceText: 'Good — Loyal to Arthur',
      desc: 'You see two players marked as "Merlin or Morgana" — but not which is which. One is your greatest ally, the other a trap.',
      known: [
        { text: 'Alice — Merlin or Morgana?', css: 'unknown' },
        { text: 'Claire — Merlin or Morgana?', css: 'unknown' },
      ],
      tips: [
        'Watch which of the two nudges the game toward Good — that\'s probably the real Merlin.',
        'Protect Merlin\'s identity: if you figure it out, act as a decoy so the Assassin targets you instead.',
        'Never say which two players you see — that helps Evil narrow down Merlin.',
      ],
    },
    'Minion of Mordred': {
      allegiance: 'evil',
      allegianceText: 'Evil — Minions of Mordred',
      desc: 'You know your fellow Evil players. Sabotage quests, sow doubt, and protect the Assassin\'s ability to find Merlin.',
      known: [
        { text: 'Claire — Fellow Evil (Assassin)', css: 'evil' },
      ],
      tips: [
        'You can play Fail on quests — but failing every quest you\'re on makes you obvious. Sometimes Pass to build trust.',
        'Deflect suspicion onto Good players. Chaos helps Evil.',
        'Pay attention to who talks like they know too much — that\'s Merlin. Feed your read to the Assassin.',
      ],
    },
  };

  function showRoleSpotlight(roleName, backTo) {
    const s = ROLE_SPOTLIGHTS[roleName];
    const body = document.getElementById('tut-body');
    body.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Playing as ${esc(roleName)}</h2>
        <div class="tut-card-wrap">
          <div class="tut-role-card revealed">
            <div class="tut-card-allegiance ${s.allegiance}">${s.allegianceText}</div>
            ${roleArt(roleName, 'large')}
            <div class="tut-card-role-name">${esc(roleName)}</div>
            <div class="tut-card-role-desc">${s.desc}</div>
            <div class="tut-card-known">
              <div class="tut-card-known-title">You can see:</div>
              ${s.known.map(k => `<div class="tut-known-entry ${k.css}">${esc(k.text)}</div>`).join('')}
            </div>
          </div>
        </div>
        <div class="tut-callout" style="text-align:left;">
          <strong style="display:block;margin-bottom:8px;">How to play it well:</strong>
          ${s.tips.map(t => `<div style="margin-bottom:6px;">• ${esc(t)}</div>`).join('')}
        </div>
      </div>`;
    body.scrollTop = 0;
    addNext(body.querySelector('.tut-scene'), '← Back to summary', backTo);
  }

  function sceneComplete(c, next) {
    const items = [
      'How quests work',
      'How voting works',
      'How discussion works',
      'What Merlin does',
      'Why the Assassin matters',
    ];

    c.innerHTML = `
      <div class="tut-scene tut-complete">
        <div class="tut-complete-crest">⚔️</div>
        <h2 class="tut-title">You're Ready!</h2>
        <p class="tut-sub">You now know:</p>
        <div class="tut-checklist" id="tut-checklist">
          ${items.map((item, i) => `
            <div class="tut-check-item" id="tci-${i}">
              <span class="tut-check-icon">✓</span>
              <span>${item}</span>
            </div>`).join('')}
        </div>
        <div class="tut-roles-more" id="tut-roles-more" style="opacity:0;transition:opacity 0.4s;">
          <p class="tut-sub" style="margin-bottom:10px;">Curious about other roles?</p>
          <div class="tut-role-spotlight-btns">
            <button class="secondary-btn" id="tut-try-percival">🛡 Play as Percival</button>
            <button class="secondary-btn" id="tut-try-minion">🌑 Play as a Minion</button>
          </div>
        </div>
        <div class="tut-final-btns" id="tut-final-btns" style="opacity:0;transition:opacity 0.4s;">
          <button class="primary-btn" id="tut-go-home">Start Your First Game →</button>
          <button class="secondary-btn" id="tut-replay" style="margin-top:10px;">Replay Tutorial</button>
        </div>
      </div>`;

    items.forEach((_, i) => {
      const el = document.getElementById(`tci-${i}`);
      if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(-16px)'; }
    });

    items.forEach((_, i) => {
      setTimeout(() => {
        const el = document.getElementById(`tci-${i}`);
        if (!el) return;
        el.style.transition = 'opacity 0.35s, transform 0.35s';
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
        if (i === items.length - 1) {
          setTimeout(() => {
            const more = document.getElementById('tut-roles-more');
            const btns = document.getElementById('tut-final-btns');
            if (more) more.style.opacity = '1';
            if (btns) btns.style.opacity = '1';
          }, 350);
        }
      }, 200 + i * 220);
    });

    setTimeout(() => {
      const backToSummary = () => enterScene(TOTAL - 1);
      document.getElementById('tut-go-home')?.addEventListener('click', () => showScreen('home'));
      document.getElementById('tut-replay')?.addEventListener('click', () => { maxVisited = 0; enterScene(0); });
      document.getElementById('tut-try-percival')?.addEventListener('click', () => showRoleSpotlight('Percival', backToSummary));
      document.getElementById('tut-try-minion')?.addEventListener('click', () => showRoleSpotlight('Minion of Mordred', backToSummary));
    }, 0);
  }

  // ── Scene registry ────────────────────────────────────────────────────
  const SCENES = [
    sceneWelcome,        // 0
    sceneWinConditions,  // 1
    sceneMeetPlayers,    // 2
    sceneRoleReveal,     // 3
    sceneEvilRevealed,   // 4
    sceneTeamProposal,   // 5
    sceneQuestVote,      // 6
    sceneDiscussion,     // 7
    sceneAssassination,  // 8
    sceneComplete,       // 9
  ];

  // ── Entry + header nav ────────────────────────────────────────────────
  document.getElementById('btn-tutorial')?.addEventListener('click', () => {
    showScreen('tutorial');
    maxVisited = 0;
    enterScene(0);
  });

  document.getElementById('tut-exit')?.addEventListener('click', () => showScreen('home'));
  document.getElementById('tut-prev')?.addEventListener('click', () => {
    if (currentScene > 0) enterScene(currentScene - 1);
  });
  document.getElementById('tut-next-nav')?.addEventListener('click', () => {
    if (currentScene < maxVisited) enterScene(currentScene + 1);
  });
})();
