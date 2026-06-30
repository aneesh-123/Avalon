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

  // ── Progress ──────────────────────────────────────────────────────────
  const TOTAL = 9;
  function updateProgress(n) {
    const el = document.getElementById('tut-progress');
    if (el) el.textContent = `Step ${n + 1} of ${TOTAL}`;
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
    updateProgress(n);
    const body = document.getElementById('tut-body');
    body.innerHTML = '';
    body.scrollTop = 0;
    SCENES[n](body, () => enterScene(n + 1));
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
            <div class="tut-team-desc">Complete missions to win</div>
          </div>
          <div class="tut-vs">vs</div>
          <div class="tut-team evil">
            <div class="tut-team-icon">💀</div>
            <div class="tut-team-name">Evil</div>
            <div class="tut-team-desc">Sabotage them to win</div>
          </div>
        </div>
        <p class="tut-note">⏱ About 3 minutes. No reading required.</p>
      </div>`;
    addNext(c, 'Start →', next);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 1 — Win conditions (animated quest track)
  // ══════════════════════════════════════════════════════════════════════
  function sceneWinConditions(c, next) {
    const sizes = [2, 3, 2, 3, 3];
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">How to Win</h2>

        <div class="tut-win-block">
          <div class="tut-win-label good">⚔ Good wins 3 quests</div>
          <div class="tut-track-row" id="tut-track-g">
            ${sizes.map((s,i) => `<div class="ct-dot" id="tgd-${i}"><span>${s}</span></div>`).join('')}
          </div>
        </div>

        <div class="tut-win-block" id="tut-evil-block" style="opacity:0;transition:opacity 0.5s;">
          <div class="tut-win-label evil">💀 Evil fails 3 quests…</div>
          <div class="tut-track-row" id="tut-track-e">
            ${sizes.map((s,i) => `<div class="ct-dot" id="ted-${i}"><span>${s}</span></div>`).join('')}
          </div>
          <div class="tut-win-label evil tut-or-label">…or identifies Merlin after Good wins.</div>
        </div>

        <div class="tut-callout" id="tut-twist" style="opacity:0;transition:opacity 0.5s;">
          ⚡ Even if Good completes 3 quests, the Assassin gets one final shot at Merlin.
        </div>
      </div>`;

    // Animate Good dots passing one by one
    let i = 0;
    const passGood = () => {
      const dot = document.getElementById(`tgd-${i}`);
      if (dot) { dot.classList.add('pass'); dot.innerHTML = '✔'; }
      i++;
      if (i < 3) {
        setTimeout(passGood, 650);
      } else {
        // Fade in Evil section
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
              // Fade in twist callout, then show Continue
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
  // SCENE 2 — Role reveal (tap to flip)
  // ══════════════════════════════════════════════════════════════════════
  function sceneRoleReveal(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Your Secret Role</h2>
        <p class="tut-sub">Every player gets a hidden role. Yours is…</p>
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
        card.innerHTML = `
          <div class="tut-card-allegiance good">Good — Loyal to Arthur</div>
          ${roleArt('Merlin', 'large')}
          <div class="tut-card-role-name">Merlin</div>
          <div class="tut-card-role-desc">You secretly know who the Evil players are. Stay hidden — if Evil's Assassin identifies you at the end, they still win.</div>`;
        card.style.transition = 'opacity 0.25s';
        card.style.opacity = '1';
        setTimeout(() => addNext(c, 'Continue →', next), 400);
      }, 150);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 3 — What Merlin sees
  // ══════════════════════════════════════════════════════════════════════
  function sceneEvilRevealed(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">What You Know</h2>
        <p class="tut-sub">As Merlin, you see the Evil players — but no one else does.</p>
        <div class="tut-player-list" id="tut-cast-list">
          ${CAST.map((p, i) => `
            <div class="tut-player-row ${p.evil ? 'evil' : 'good'}" id="tpr-${i}" style="opacity:0;transform:translateX(-16px)">
              <span class="tut-player-name">${p.name === 'You' ? '⭐ You' : esc(p.name)}</span>
              <span class="tut-player-tag ${p.name === 'You' ? 'you' : p.evil ? 'evil' : 'good'}">
                ${p.name === 'You' ? 'Merlin' : p.evil ? '💀 Evil' : '⚔ Good'}
              </span>
            </div>`).join('')}
        </div>
        <div class="tut-callout" id="tut-merlin-warn" style="opacity:0;transition:opacity 0.4s;margin-top:16px;">
          ⚠ Guide Good to victory — but if you reveal yourself, the Assassin wins.
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
  // SCENE 4 — Team proposal & vote
  // ══════════════════════════════════════════════════════════════════════
  function sceneTeamProposal(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Team Proposal</h2>
        <p class="tut-sub">The Leader picks a team for each quest. Everyone then votes.</p>
        <div class="tut-leader-row">
          <span class="tut-crown">👑</span>
          <span><strong>Alice</strong> is the Leader. She proposes:</span>
        </div>
        <div class="proposed-team" style="margin:16px 0;">
          <span class="team-chip">Alice</span>
          <span class="team-chip">You</span>
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
        { name: 'Claire', vote: 'reject'  },
        { name: 'David',  vote: 'reject'  },
      ];
      const approves = votes.filter(v => v.vote === 'approve').length;
      const approved = approves > votes.length / 2;

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
          outcomeEl.className = `tut-outcome-banner ${approved ? 'good' : 'evil'}`;
          outcomeEl.innerHTML = approved
            ? '✓ Team Approved! — 3 vs 2'
            : '✗ Team Rejected — but for this tutorial, it passes anyway.';
          setTimeout(() => addNext(c, 'On to the Quest →', next), 500);
        }
      };
      setTimeout(revealNext, 200);
    }

    document.getElementById('tut-approve').addEventListener('click', () => handleVote('approve'), { once: true });
    document.getElementById('tut-reject').addEventListener('click',  () => handleVote('reject'),  { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 5 — Quest voting & card reveal
  // ══════════════════════════════════════════════════════════════════════
  function sceneQuestVote(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">The Quest</h2>
        <p class="tut-sub">You and Alice are on the quest. Vote secretly.</p>
        <div class="tut-callout">Good players can only play <strong>Pass</strong>. Evil players may choose to Fail.</div>
        <div class="quest-vote-btns" style="margin-top:20px;" id="tut-qbtns">
          <button class="qvote-btn pass-btn" id="tut-qpass">✔ Pass</button>
          <button class="qvote-btn fail-btn" id="tut-qfail" disabled style="opacity:0.35;cursor:not-allowed;">✘ Fail</button>
        </div>
        <div id="tut-qresult"></div>
      </div>`;

    document.getElementById('tut-qpass').addEventListener('click', () => {
      document.getElementById('tut-qbtns').innerHTML =
        '<div class="voted-msg">✔ You played Pass — Alice is voting…</div>';

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
              + '<span style="color:#8a7a5a;font-size:0.88rem;">David secretly played a Fail card.<br>One Fail is all it takes.</span>';
            sum.style.opacity = '1';
            setTimeout(() => addNext(c, 'Continue →', next), 600);
          }
        }, 3600);
      }, 1000);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 6 — Discussion
  // ══════════════════════════════════════════════════════════════════════
  function sceneDiscussion(c, next) {
    const messages = [
      { from: 'Bob',    text: 'David was on that quest. That Fail came from him.' },
      { from: 'David',  text: 'Wasn\'t me. Could\'ve been Alice for all we know.' },
      { from: 'Alice',  text: 'I played Pass! I\'m clearly on Good\'s side.' },
      { from: 'Claire', text: 'Easy to say that. Bob is pointing fingers awfully fast.' },
    ];

    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Discussion</h2>
        <p class="tut-sub">After each quest, players debate — who played that Fail card?</p>
        <div class="tut-chat" id="tut-chat"></div>
        <div id="tut-suspect-area" style="display:none;">
          <p class="tut-sub" style="margin-top:20px;margin-bottom:10px;">Who seems most suspicious to you?</p>
          <div class="tut-player-list" id="tut-suspects">
            ${['Alice','Bob','Claire','David'].map(name => `
              <div class="tut-player-row good clickable" data-name="${name}">
                <span class="tut-player-name">${esc(name)}</span>
                <span class="tut-tap-hint">→</span>
              </div>`).join('')}
          </div>
        </div>
        <div id="tut-suspect-result" style="display:none;"></div>
      </div>`;

    const chat = document.getElementById('tut-chat');
    let i = 0;
    const showNext = () => {
      if (i >= messages.length) {
        setTimeout(() => {
          document.getElementById('tut-suspect-area').style.display = 'block';
          document.getElementById('tut-suspects').querySelectorAll('.clickable').forEach(row => {
            row.addEventListener('click', () => {
              const name = row.dataset.name;
              const isEvil = name === 'Claire' || name === 'David';
              document.getElementById('tut-suspect-area').style.display = 'none';
              const resEl = document.getElementById('tut-suspect-result');
              resEl.style.display = 'block';
              resEl.innerHTML = `
                <div class="tut-suspect-reveal ${isEvil ? 'evil' : 'good'}">
                  <strong>${esc(name)}</strong> is ${isEvil ? '💀 Evil — good instinct!' : '⚔ actually Good.'}
                  ${!isEvil ? '<br><small style="color:#6a5a3a">Deception is working. That\'s the game.</small>' : ''}
                </div>
                <div class="tut-callout" style="margin-top:12px;">
                  Players use mission results, vote patterns, and conversation to unmask Evil. Merlin knows — but can't say.
                </div>`;
              addNext(c, 'Continue →', next);
            }, { once: true });
          });
        }, 300);
        return;
      }
      const m = messages[i++];
      const bubble = document.createElement('div');
      bubble.className = 'tut-bubble';
      bubble.innerHTML = `<span class="tut-bubble-from">${esc(m.from)}</span><span class="tut-bubble-text">${esc(m.text)}</span>`;
      chat.appendChild(bubble);
      chat.scrollTop = chat.scrollHeight;
      setTimeout(showNext, 1400);
    };
    setTimeout(showNext, 300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCENE 7 — Fast-forward then assassination
  // ══════════════════════════════════════════════════════════════════════
  function sceneAssassination(c, next) {
    const sizes = [2, 3, 2, 3, 3];
    // results: fail, pass, pass, pass — ends after quest 4
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
        // done animating — show assassination
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
  // SCENE 8 — Completion checklist
  // ══════════════════════════════════════════════════════════════════════
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
        <div class="tut-final-btns" id="tut-final-btns" style="opacity:0;transition:opacity 0.4s;">
          <button class="primary-btn" id="tut-go-home">Start Your First Game →</button>
          <button class="secondary-btn" id="tut-replay" style="margin-top:10px;">Replay Tutorial</button>
        </div>
      </div>`;

    // Set initial state for animation
    items.forEach((_, i) => {
      const el = document.getElementById(`tci-${i}`);
      if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(-16px)'; }
    });

    // Stagger in
    items.forEach((_, i) => {
      setTimeout(() => {
        const el = document.getElementById(`tci-${i}`);
        if (!el) return;
        el.style.transition = 'opacity 0.35s, transform 0.35s';
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
        if (i === items.length - 1) {
          setTimeout(() => {
            const btns = document.getElementById('tut-final-btns');
            if (btns) btns.style.opacity = '1';
          }, 350);
        }
      }, 200 + i * 220);
    });

    // Buttons wired after render
    setTimeout(() => {
      document.getElementById('tut-go-home')?.addEventListener('click', () => showScreen('home'));
      document.getElementById('tut-replay')?.addEventListener('click', () => enterScene(0));
    }, 0);
  }

  // ── Scene registry ────────────────────────────────────────────────────
  const SCENES = [
    sceneWelcome,
    sceneWinConditions,
    sceneRoleReveal,
    sceneEvilRevealed,
    sceneTeamProposal,
    sceneQuestVote,
    sceneDiscussion,
    sceneAssassination,
    sceneComplete,
  ];

  // ── Entry ─────────────────────────────────────────────────────────────
  document.getElementById('btn-tutorial')?.addEventListener('click', () => {
    showScreen('tutorial');
    enterScene(0);
  });

  document.getElementById('tut-exit')?.addEventListener('click', () => showScreen('home'));
})();
