// tutorial.js — Interactive first-time tutorial (no server needed)
//
// Built to teach in about two minutes, so it follows a few rules:
//   • Goal first. Players learn what winning looks like before any mechanics.
//   • One idea per step, two sentences at most. Everything else is in the
//     "Ask" helper (avalon-help.js), which is one tap away the whole time.
//   • Do, don't read. Each rule is taught by the player acting it out:
//     flip your card, vote, play a quest card, pick what to say.
//   • Mistakes are safe and explained, then you try again.
//   • End with a three-line recap of the whole game.
(function () {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Progress + back/forward navigation ────────────────────────────────
  const TOTAL = 7;
  let currentScene = 0;
  let maxVisited   = 0;   // furthest scene reached — "Next ›" can jump up to here

  function updateHeader() {
    const prog = document.getElementById('tut-progress');
    if (prog) prog.textContent = `${currentScene + 1} / ${TOTAL}`;
    const prev = document.getElementById('tut-prev');
    const next = document.getElementById('tut-next-nav');
    if (prev) prev.disabled = currentScene === 0;
    if (next) next.disabled = currentScene >= maxVisited || currentScene >= TOTAL - 1;
  }

  // ── Continue button helper ────────────────────────────────────────────
  function addNext(container, label, cb) {
    // A timer from a step the player already left must not add its button here.
    if (!container.isConnected) return document.createElement('button');
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
    // Each step renders into its own stage, so leaving a step detaches it and
    // any of its timers still pending can see they're stale.
    const stage = document.createElement('div');
    body.appendChild(stage);
    SCENES[n](stage, () => enterScene(n + 1));
  }

  // Fade a list of elements in one after another, then run done().
  function stagger(ids, gap, done) {
    ids.forEach((id, i) => setTimeout(() => {
      const el = document.getElementById(id);
      if (el) { el.style.opacity = '1'; el.style.transform = 'none'; }
      if (i === ids.length - 1 && done) setTimeout(done, gap);
    }, 150 + i * gap));
  }
  const hidden = 'style="opacity:0;transform:translateY(8px);transition:opacity .35s,transform .35s"';

  // ══════════════════════════════════════════════════════════════════════
  // 1 — The goal
  // ══════════════════════════════════════════════════════════════════════
  function sceneGoal(c, next) {
    const sizes = [2, 3, 2, 3, 3];
    c.innerHTML = `
      <div class="tut-scene tut-welcome">
        <h2 class="tut-title">Good vs Evil</h2>
        <p class="tut-sub">Everyone is secretly on a side.</p>
        <div class="tut-teams-row">
          <div class="tut-team good">
            <div class="tut-team-icon">⚔</div>
            <div class="tut-team-name">Good</div>
            <div class="tut-team-desc">Most players.<br>Don't know who's who.</div>
          </div>
          <div class="tut-vs">vs</div>
          <div class="tut-team evil">
            <div class="tut-team-icon">💀</div>
            <div class="tut-team-name">Evil</div>
            <div class="tut-team-desc">A few players.<br>Know each other.</div>
          </div>
        </div>
        <p class="tut-sub" id="tg-line" ${hidden}>There are <strong>5 quests</strong>. Good wants them to pass, Evil wants them to fail. <strong>First side to 3 wins.</strong></p>
        <div class="tut-track-row" id="tg-track" ${hidden}>
          ${sizes.map((s, i) => `<div class="ct-dot" id="tgd-${i}"><span>${s}</span></div>`).join('')}
        </div>
      </div>`;
    stagger(['tg-line', 'tg-track'], 500, () => {
      const marks = ['pass', 'fail', 'pass', 'pass'];
      marks.forEach((m, i) => setTimeout(() => {
        const dot = document.getElementById(`tgd-${i}`);
        if (dot) { dot.classList.add(m); dot.innerHTML = m === 'pass' ? '✔' : '✘'; }
        if (i === marks.length - 1) setTimeout(() => addNext(c, 'Deal me in →', next), 300);
      }, i * 380));
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2 — Your secret role (tap to flip)
  // ══════════════════════════════════════════════════════════════════════
  function sceneRole(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Your Secret Role</h2>
        <p class="tut-sub">You're playing with Alice, Bob, Claire and David. Tap your card.</p>
        <div class="tut-card-wrap">
          <div class="tut-role-card" id="tut-role-card">
            <div class="tut-card-crest">⚜️</div>
            <div class="tut-card-hint">Tap to reveal</div>
          </div>
        </div>
        <div class="tut-callout" id="tr-note" ${hidden}>
          You're <strong>Merlin</strong>: Good, and the only Good player who knows who's Evil. Everyone else on Good sees nobody.
        </div>
      </div>`;

    document.getElementById('tut-role-card').addEventListener('click', () => {
      const card = document.getElementById('tut-role-card');
      card.style.transition = 'opacity 0.15s';
      card.style.opacity = '0';
      setTimeout(() => {
        card.classList.add('revealed');
        card.innerHTML = `
          <div class="tut-card-allegiance good">Good — Loyal to Arthur</div>
          ${roleArt('Merlin', 'large')}
          <div class="tut-card-role-name">Merlin</div>
          <div class="tut-card-known">
            <div class="tut-card-known-title">You can see:</div>
            <div class="tut-known-entry evil">Claire — Evil</div>
            <div class="tut-known-entry evil">David — Evil</div>
          </div>`;
        card.style.transition = 'opacity 0.25s';
        card.style.opacity = '1';
        stagger(['tr-note'], 300, () => addNext(c, 'Continue →', next));
      }, 150);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3 — Vote on the team
  // ══════════════════════════════════════════════════════════════════════
  function sceneVote(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Vote on the Team</h2>
        <p class="tut-sub">Each round a <strong>Leader</strong> picks a team for the quest. Then everyone votes on it.</p>
        <div class="tut-leader-row">
          <span class="tut-crown">👑</span>
          <span><strong>Alice</strong> is Leader and picks:</span>
        </div>
        <div class="proposed-team" style="margin:12px 0;">
          <span class="team-chip">David</span>
          <span class="team-chip">You</span>
        </div>
        <div class="tut-callout" style="margin:0 0 8px;">🤫 You know David is Evil. Nobody else does.</div>
        <div class="vote-btns" id="tut-vote-btns" style="margin-top:12px;">
          <button class="vote-btn approve-btn" id="tut-approve">✓ Approve</button>
          <button class="vote-btn reject-btn" id="tut-reject">✗ Reject</button>
        </div>
        <div id="tut-vote-log" style="margin-top:14px;"></div>
        <div id="tut-vote-outcome" style="display:none;"></div>
      </div>`;

    function handleVote(myVote) {
      document.getElementById('tut-vote-btns').innerHTML = '';
      const votes = [
        { name: 'You',    vote: myVote },
        { name: 'Alice',  vote: 'approve' },
        { name: 'Bob',    vote: 'approve' },
        { name: 'Claire', vote: 'approve' },
        { name: 'David',  vote: 'approve' },
      ];
      const approves = votes.filter(v => v.vote === 'approve').length;
      document.getElementById('tut-vote-log').innerHTML = `<div class="vote-roster">${votes.map(v => `
        <div class="vote-row ${v.vote}">
          <span>${esc(v.name)}</span>
          <span class="vote-tag">${v.vote === 'approve' ? '✓ Approve' : '✗ Reject'}</span>
        </div>`).join('')}</div>`;
      const out = document.getElementById('tut-vote-outcome');
      out.style.display = 'block';
      out.className = 'tut-outcome-banner good';
      out.innerHTML = `✓ Approved ${approves}–${votes.length - approves}. Most people said yes, so the team goes.`
        + (myVote === 'reject' ? '<br><small>Good instinct, but you were outvoted. Everyone saw you reject, too.</small>' : '')
        + '<br><small>If 5 teams in a row get rejected, Evil wins.</small>';
      setTimeout(() => addNext(c, 'Go on the quest →', next), 400);
    }

    document.getElementById('tut-approve').addEventListener('click', () => handleVote('approve'), { once: true });
    document.getElementById('tut-reject').addEventListener('click',  () => handleVote('reject'),  { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4 — The quest (You + David; David fails it)
  // ══════════════════════════════════════════════════════════════════════
  function sceneQuest(c, next) {
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">The Quest</h2>
        <p class="tut-sub">The team secretly plays <strong>Pass</strong> or <strong>Fail</strong>. Good can only play Pass.</p>
        <div class="quest-vote-btns" style="margin-top:20px;" id="tut-qbtns">
          <button class="qvote-btn pass-btn" id="tut-qpass">✔ Pass</button>
          <button class="qvote-btn fail-btn" id="tut-qfail" disabled style="opacity:0.35;cursor:not-allowed;">✘ Fail</button>
        </div>
        <div id="tut-qresult"></div>
      </div>`;

    document.getElementById('tut-qpass').addEventListener('click', () => {
      document.getElementById('tut-qbtns').innerHTML =
        '<div class="voted-msg">✔ You played Pass. David plays his card…</div>';
      const res = document.getElementById('tut-qresult');
      res.innerHTML = `
        <div class="fail-cards">
          <div class="fail-card face-down" id="tcard-0">?</div>
          <div class="fail-card face-down" id="tcard-1">?</div>
        </div>
        <div id="tut-csum" style="opacity:0;text-align:center;margin-top:12px;line-height:1.5;transition:opacity 0.4s;"></div>`;
      const flip = (id, cls, mark, at) => setTimeout(() => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('face-down'); el.classList.add(cls, 'flip-in'); el.textContent = mark; }
      }, at);
      flip('tcard-0', 'pass', '✔', 700);
      flip('tcard-1', 'fail', '✘', 1500);
      setTimeout(() => {
        const sum = document.getElementById('tut-csum');
        if (!sum) return;
        sum.innerHTML = '<strong style="color:#ff6b6b;font-size:1.1rem;">Quest Failed!</strong><br>'
          + '<span style="color:#8a7a5a;font-size:0.9rem;">One Fail is enough. The cards are shuffled, so nobody sees who played it.</span>';
        sum.style.opacity = '1';
        setTimeout(() => addNext(c, 'Continue →', next), 400);
      }, 2200);
    }, { once: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5 — Talk it out (what should Merlin say?)
  // ══════════════════════════════════════════════════════════════════════
  function sceneTalk(c, next) {
    const choices = [
      {
        text: '"I\'m Merlin. I can see David is Evil!"',
        correct: false,
        feedback: 'That tells Evil exactly who Merlin is. At the end, the Assassin would pick you and Evil would win. Try again.',
      },
      {
        text: '"David was on the quest that failed. I don\'t trust him."',
        correct: true,
        feedback: 'Exactly. You pointed at something everyone saw, not at what only you know. That\'s how Merlin helps without getting caught.',
      },
      {
        text: 'Say nothing, so nobody suspects you.',
        correct: false,
        feedback: 'Too quiet. Your knowledge only helps Good if you nudge them. Try again.',
      },
    ];

    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">Talk It Out</h2>
        <p class="tut-sub">Now everyone argues about who played that Fail. Anyone can say anything, including lies.</p>
        <div class="tut-chat">
          <div class="tut-bubble"><span class="tut-bubble-from">David</span><span class="tut-bubble-text">Wasn't me! Why would I fail my own quest?</span></div>
        </div>
        <p class="tut-sub" style="margin-top:16px;margin-bottom:10px;">You know it was David. What do you say?</p>
        <div id="tut-mc-options">
          ${choices.map((ch, i) => `<button class="tut-mc-option" data-i="${i}">${esc(ch.text)}</button>`).join('')}
        </div>
        <div id="tut-mc-feedback" style="display:none;"></div>
      </div>`;

    const feedbackEl = document.getElementById('tut-mc-feedback');
    c.querySelectorAll('.tut-mc-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = choices[parseInt(btn.dataset.i, 10)];
        c.querySelectorAll('.tut-mc-option').forEach(b => b.classList.remove('correct', 'wrong'));
        btn.classList.add(ch.correct ? 'correct' : 'wrong');
        feedbackEl.style.display = 'block';
        feedbackEl.className = `tut-mc-feedback ${ch.correct ? 'good' : 'evil'}`;
        feedbackEl.textContent = ch.feedback;
        if (ch.correct && !document.getElementById('tut-mc-continue')) {
          addNext(c.querySelector('.tut-scene'), 'Continue →', next).id = 'tut-mc-continue';
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6 — The twist: the Assassin
  // ══════════════════════════════════════════════════════════════════════
  function sceneTwist(c, next) {
    const sizes = [2, 3, 2, 3, 3];
    const results = ['fail', 'pass', 'pass', 'pass'];
    c.innerHTML = `
      <div class="tut-scene">
        <h2 class="tut-title">One Last Twist</h2>
        <p class="tut-sub">Skip ahead: Good passes 3 quests. Good wins… almost.</p>
        <div class="tut-track-row" style="margin:18px 0;">
          ${sizes.map((s, i) => `<div class="ct-dot" id="tad-${i}"><span>${s}</span></div>`).join('')}
        </div>
        <div class="tut-assassin-box" id="tw-box" ${hidden}>
          <div class="tut-asn-icon">🗡</div>
          <div class="tut-asn-title">The Assassin gets one guess</div>
          <div class="tut-asn-body">Claire is the Assassin. If she can point to Merlin, Evil steals the win.</div>
        </div>
        <div class="tut-target-row" id="tw-target" ${hidden}>
          <div class="tut-target-chip evil">Claire 🗡 → You (Merlin)</div>
        </div>
        <div class="tut-gameover-box evil" id="tw-over" ${hidden}>
          <div class="go-icon">💀</div>
          <div class="go-title">Evil Wins!</div>
          <div class="go-reason">She spotted you. That's why Merlin has to stay subtle.</div>
        </div>
      </div>`;
    results.forEach((r, i) => setTimeout(() => {
      const dot = document.getElementById(`tad-${i}`);
      if (dot) { dot.classList.add(r); dot.innerHTML = r === 'pass' ? '✔' : '✘'; }
      if (i === results.length - 1) {
        stagger(['tw-box', 'tw-target', 'tw-over'], 1000, () => addNext(c, 'Continue →', next));
      }
    }, 300 + i * 350));
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7 — Recap
  // ══════════════════════════════════════════════════════════════════════
  function sceneDone(c) {
    c.innerHTML = `
      <div class="tut-scene tut-complete">
        <div class="tut-complete-crest">⚔️</div>
        <h2 class="tut-title">That's the Whole Game</h2>
        <div class="tut-recap">
          <div class="tut-recap-row" id="rc-0" ${hidden}><span class="tut-recap-n">1</span><span>The Leader picks a team. Everyone votes.</span></div>
          <div class="tut-recap-row" id="rc-1" ${hidden}><span class="tut-recap-n">2</span><span>The team secretly plays Pass or Fail.</span></div>
          <div class="tut-recap-row" id="rc-2" ${hidden}><span class="tut-recap-n">3</span><span>First to 3 quests wins. Then the Assassin gets one guess at Merlin.</span></div>
        </div>
        <p class="tut-sub" id="rc-ask" ${hidden}>Stuck on something mid-game? Tap <strong>💬 Ask</strong> and ask in your own words.</p>
        <div class="tut-final-btns" id="rc-btns" ${hidden}>
          <button class="primary-btn" id="tut-go-home">Start a Game →</button>
          <button class="secondary-btn" id="tut-ask-end" style="margin-top:10px;">💬 Ask a question</button>
          <button class="tut-nav-btn" id="tut-replay" style="margin-top:14px;">↺ Replay tutorial</button>
        </div>
      </div>`;
    stagger(['rc-0', 'rc-1', 'rc-2', 'rc-ask', 'rc-btns'], 220);
    document.getElementById('tut-go-home').addEventListener('click', () => showScreen('home'));
    document.getElementById('tut-ask-end').addEventListener('click', () => window.avalonAsk?.open());
    document.getElementById('tut-replay').addEventListener('click', () => { maxVisited = 0; enterScene(0); });
  }

  // ── Scene registry ────────────────────────────────────────────────────
  const SCENES = [sceneGoal, sceneRole, sceneVote, sceneQuest, sceneTalk, sceneTwist, sceneDone];

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
