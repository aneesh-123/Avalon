// council-tutorial.js — hands-on tutorial for The Council (no server needed).
//
// Same rules as Avalon's tutorial (tutorial.js):
//   • Goal first: what winning looks like before any mechanics.
//   • One idea per step, two sentences at most.
//   • Do, don't read: the player taps through a real-looking round, built from
//     the game's own cn- pieces, so the real game looks familiar afterwards.
//   • Mistakes are safe and explained, then you try again.
//   • End with a three-line recap.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (!$('screen-cn-tutorial')) return;

  const TOTAL = 8;
  const PEOPLE = ['Priya', 'Jordan', 'Sam', 'Maya'];
  let current = 0, maxVisited = 0;
  let partner = 'Sam';   // whoever you pick turns out to be a traitor

  function updateHeader() {
    $('cn-tut-progress').textContent = `${current + 1} / ${TOTAL}`;
    $('cn-tut-prev').disabled = current === 0;
    $('cn-tut-next').disabled = current >= maxVisited || current >= TOTAL - 1;
  }

  function addNext(container, label, cb) {
    if (!container.isConnected) return document.createElement('button');
    const btn = document.createElement('button');
    btn.className = 'primary-btn cn-big-btn cn-tut-next';
    btn.textContent = label || 'Continue →';
    btn.addEventListener('click', cb, { once: true });
    container.appendChild(btn);
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return btn;
  }

  function enter(n) {
    if (n >= TOTAL) { showScreen('cn-home'); return; }
    current = n;
    maxVisited = Math.max(maxVisited, n);
    updateHeader();
    const body = $('cn-tut-body');
    body.innerHTML = '';
    window.scrollTo(0, 0);
    const stage = document.createElement('div');
    stage.className = 'cn-tut-scene';
    body.appendChild(stage);
    SCENES[n](stage, () => enter(n + 1));
  }

  const hidden = 'style="opacity:0;transform:translateY(8px);transition:opacity .35s,transform .35s"';
  function stagger(ids, gap, done) {
    ids.forEach((id, i) => setTimeout(() => {
      const el = $(id);
      if (el) { el.style.opacity = '1'; el.style.transform = 'none'; }
      if (i === ids.length - 1 && done) setTimeout(done, gap);
    }, 150 + i * gap));
  }

  function meter(kind, value) {
    const icon = kind === 'gold' ? '🪙' : '👥';
    const label = kind === 'gold' ? 'Gold' : 'People';
    const pips = Array.from({ length: 5 }, (_, i) =>
      `<span class="cn-pip${i < value ? ' on' : ''}${value <= 2 && i < value ? ' low' : ''}"></span>`).join('');
    return `<div class="cn-meter ${kind}${value <= 2 ? ' danger' : ''}" id="cn-tut-meter-${kind}">
      <div class="cn-meter-top"><span class="cn-meter-icon">${icon}</span><span class="cn-meter-name">${label}</span><span class="cn-meter-num">${value}</span></div>
      <div class="cn-pips">${pips}</div></div>`;
  }
  const meters = (gold, people) => `<div class="cn-meters">${meter('gold', gold)}${meter('people', people)}</div>`;

  const CARD = {
    icon: '🐺', title: 'Wolf Winter', text: 'Wolves are taking sheep from every farm.',
    gold: 'Pay the hunters', people: 'Let the farmers fend for themselves',
  };
  const feedback = (el, good, text) => {
    el.hidden = false;
    el.className = `cn-tut-feedback ${good ? 'good' : 'bad'}`;
    el.textContent = text;
  };

  // ══ 1 — The goal ═══════════════════════════════════════════════════════
  function sceneGoal(c, next) {
    c.innerHTML = `
      <h2 class="cn-tut-title">Save the Kingdom</h2>
      <p class="cn-tut-sub">The kingdom starts with <b>5 Gold</b> and <b>5 People</b>.</p>
      ${meters(5, 5)}
      <div class="cn-tut-teams" id="cg-teams" ${hidden}>
        <div class="cn-tut-team loyal"><span>🛡️</span><strong>Loyal</strong><em>Most players. Don't know who's who.</em></div>
        <div class="cn-tut-team traitor"><span>🗡️</span><strong>Traitors</strong><em>A few players. Know each other.</em></div>
      </div>
      <p class="cn-tut-sub" id="cg-line" ${hidden}>Keep both above 0 for <b>5 rounds</b> and the loyal side wins. If either hits <b>0</b>, the traitors win.</p>`;
    stagger(['cg-teams', 'cg-line'], 600, () => addNext(c, 'Deal me in →', next));
  }

  // ══ 2 — Your secret role ═══════════════════════════════════════════════
  function sceneRole(c, next) {
    c.innerHTML = `
      <h2 class="cn-tut-title">Your Secret Role</h2>
      <p class="cn-tut-sub">You're playing with ${PEOPLE.join(', ')}. Tap your card.</p>
      <button class="cn-panel cn-tut-flip" id="cn-tut-card"><span class="cn-role-big">👑</span><span class="cn-tut-flip-hint">Tap to reveal</span></button>
      <div class="cn-tut-callout" id="cr-note" ${hidden}>Two of the other four are <b>traitors</b>. You don't know which. They know each other.</div>`;
    $('cn-tut-card').addEventListener('click', () => {
      const card = $('cn-tut-card');
      card.outerHTML = `<div class="cn-panel cn-role-card loyal">
          <div class="cn-role-big">🛡️</div>
          <h2>You are LOYAL</h2>
          <p>Keep <b>Gold</b> and <b>People</b> above 0 for 5 rounds.</p>
        </div>`;
      stagger(['cr-note'], 400, () => addNext(c, 'Continue →', next));
    }, { once: true });
  }

  // ══ 3 — The problem, and the whisper ═══════════════════════════════════
  function sceneProblem(c, next) {
    const opt = side => `<button class="cn-option cn-tut-option ${side}" data-side="${side}">
        <span class="cn-option-icon">${side === 'gold' ? '🪙' : '👥'}</span>
        <span class="cn-option-text">${esc(CARD[side])}</span>
        <span class="cn-option-cost">−1 ${side === 'gold' ? 'Gold' : 'People'}</span></button>`;
    c.innerHTML = `
      <h2 class="cn-tut-title">A Problem Comes Up</h2>
      <p class="cn-tut-sub">Every round brings a problem with two answers. Each costs 1.</p>
      <div class="cn-card">
        <div class="cn-card-icon">${CARD.icon}</div>
        <h2 class="cn-card-title">${CARD.title}</h2>
        <p class="cn-card-text">${CARD.text}</p>
        ${opt('gold')}${opt('people')}
      </div>
      <div class="cn-whisper has">🤫 <strong>Your spy whispers:</strong> the <b class="gold">GOLD</b> answer is a <b>trap</b> this round. It costs 1 extra.</div>
      <p class="cn-tut-ask">Which answer is cheaper? Tap it.</p>
      <div id="cp-feedback" hidden></div>`;
    const fb = $('cp-feedback');
    c.querySelectorAll('.cn-tut-option').forEach(btn => btn.addEventListener('click', () => {
      c.querySelectorAll('.cn-tut-option').forEach(b => b.classList.remove('right', 'wrong'));
      const good = btn.dataset.side === 'people';
      btn.classList.add(good ? 'right' : 'wrong');
      if (!good) { feedback(fb, false, 'That\'s the trap. It would cost 2 Gold, not 1. Try again.'); return; }
      feedback(fb, true, 'Right. Only you and one other phone got this whisper. Anyone can say they heard one, so others have to trust you.');
      if (!$('cp-next')) addNext(c, 'Continue →', next).id = 'cp-next';
    }));
  }

  // ══ 4 — You're the leader ══════════════════════════════════════════════
  function sceneLead(c, next) {
    c.innerHTML = `
      <h2 class="cn-tut-title">You're the Leader</h2>
      <p class="cn-tut-sub">The leader picks an answer and <b>one partner</b> to carry it out. The lead moves around the table.</p>
      <div class="cn-panel cn-leader">
        <p class="cn-label">1. The answer</p>
        <div class="cn-pick-row"><button class="cn-pick gold" disabled>🪙 Gold</button><button class="cn-pick people on" disabled>👥 People</button></div>
        <p class="cn-label">2. Pick your partner</p>
        <div class="cn-chips">${PEOPLE.map(n => `<button class="cn-chip pick" data-name="${n}">${n}</button>`).join('')}</div>
        <p class="cn-muted" id="cl-hint">You have no idea who's a traitor yet. Pick anyone.</p>
        <button class="primary-btn cn-big-btn btn-unready" id="cl-propose" disabled>Propose this plan</button>
      </div>`;
    const go = $('cl-propose');
    c.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => {
      c.querySelectorAll('[data-name]').forEach(x => x.classList.toggle('on', x === b));
      partner = b.dataset.name;
      go.disabled = false;
      go.classList.remove('btn-unready');
    }));
    go.addEventListener('click', () => { if (!go.disabled) next(); });
  }

  const planLine = () => `<div class="cn-plan">
      <span class="cn-plan-who">👑 You + ${esc(partner)}</span>
      <span class="cn-plan-what people">👥 ${esc(CARD.people)} <em>(−1 People)</em></span></div>`;

  // ══ 5 — Everyone votes ═════════════════════════════════════════════════
  function sceneVote(c, next) {
    c.innerHTML = `
      <h2 class="cn-tut-title">Everyone Votes</h2>
      <p class="cn-tut-sub">The plan goes ahead only if <b>more than half</b> approve. A tie fails.</p>
      <div class="cn-panel">
        ${planLine()}
        <div class="cn-vote-row" id="cv-btns">
          <button class="cn-vote yes" id="cv-yes">👍 Approve</button>
          <button class="cn-vote no" id="cv-no">👎 Reject</button>
        </div>
        <div id="cv-out"></div>
      </div>
      <div class="cn-tut-callout" id="cv-note" ${hidden}>If <b>3 plans in a row</b> are rejected, the kingdom panics and loses <b>1 Gold and 1 People</b>.</div>`;
    const vote = mine => {
      $('cv-btns').remove();
      const others = PEOPLE.filter(n => n !== partner);
      const no = mine ? [others[1]] : ['You', others[1]];
      const yes = (mine ? ['You'] : []).concat([partner, others[0], others[2]]);
      $('cv-out').innerHTML = `<div class="cn-lastvote pass"><strong>✅ Plan approved ${yes.length}–${no.length}</strong>
          <span>Yes: ${yes.map(esc).join(', ')}</span><span>No: ${no.map(esc).join(', ')}</span></div>
        ${mine ? '' : '<p class="cn-muted">You rejected your own plan? It passed anyway, and everyone saw your vote.</p>'}`;
      stagger(['cv-note'], 400, () => addNext(c, 'Carry out the plan →', next));
    };
    $('cv-yes').addEventListener('click', () => vote(true), { once: true });
    $('cv-no').addEventListener('click', () => vote(false), { once: true });
  }

  // ══ 6 — Help or sabotage ═══════════════════════════════════════════════
  function sceneAct(c, next) {
    c.innerHTML = `
      <h2 class="cn-tut-title">Help or Sabotage</h2>
      <p class="cn-tut-sub">You and ${esc(partner)} secretly choose. <b>Loyal players can only help.</b></p>
      ${meters(5, 5)}
      <div class="cn-panel" id="ca-panel">
        ${planLine()}
        <div class="cn-vote-row" id="ca-btns">
          <button class="cn-vote yes" id="ca-help">🤝 Help</button>
          <button class="cn-vote no cn-tut-locked" disabled>🗡️ Sabotage</button>
        </div>
      </div>
      <div id="ca-result"></div>`;
    $('ca-help').addEventListener('click', () => {
      $('ca-btns').outerHTML = `<p class="cn-wait">You chose <b>Help</b>. ${esc(partner)} is choosing…</p>`;
      setTimeout(() => {
        const out = $('ca-result');
        if (!out) return;
        out.innerHTML = `
          <div class="cn-result bad"><span>🗡️</span><h2>SABOTAGED!</h2><p>1 betrayal</p></div>
          <div class="cn-panel cn-math">
            <p>Base cost: <b>1</b></p>
            <p>🗡️ Sabotage: <b>+2</b></p>
            <p><span class="cn-total">Lost <b>3 People</b></span></p>
          </div>
          <div class="cn-tut-callout" id="ca-note" ${hidden}>The game only says <b>how many</b> sabotaged, never who. You helped, so you know it was <b>${esc(partner)}</b>. Everyone else only knows it was you or ${esc(partner)}.</div>`;
        const m = $('cn-tut-meter-people');
        if (m) m.outerHTML = meter('people', 2);
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        stagger(['ca-note'], 600, () => addNext(c, 'Continue →', next));
      }, 1400);
    }, { once: true });
  }

  // ══ 7 — Talk it out ════════════════════════════════════════════════════
  function sceneTalk(c, next) {
    const choices = [
      { text: `"I helped, so it was ${partner}. Keep ${partner} off the next plan."`, good: true,
        say: `Right. ${partner} will say the exact same thing about you, so the table has to decide who to believe. That's the game.` },
      { text: `"Let's give ${partner} another chance next round."`, good: false,
        say: `${partner} would just sabotage again. With People at 2, one more could end the game. Try again.` },
      { text: 'Say nothing, so nobody suspects you.', good: false,
        say: `Then ${partner} gets to blame you, and the loyal players lose their best clue. Try again.` },
    ];
    c.innerHTML = `
      <h2 class="cn-tut-title">Talk It Out</h2>
      <p class="cn-tut-sub">Now everyone argues about who sabotaged. Anyone can say anything, including lies.</p>
      <div class="cn-tut-bubble"><span>${esc(partner)}</span>Wasn't me! I helped. It must have been you.</div>
      <p class="cn-tut-ask">You know the truth. What do you say?</p>
      <div class="cn-tut-choices">${choices.map((ch, i) => `<button class="cn-tut-choice" data-i="${i}">${esc(ch.text)}</button>`).join('')}</div>
      <div id="ct-feedback" hidden></div>`;
    const fb = $('ct-feedback');
    c.querySelectorAll('.cn-tut-choice').forEach(btn => btn.addEventListener('click', () => {
      const ch = choices[+btn.dataset.i];
      c.querySelectorAll('.cn-tut-choice').forEach(b => b.classList.remove('right', 'wrong'));
      btn.classList.add(ch.good ? 'right' : 'wrong');
      feedback(fb, ch.good, ch.say);
      if (ch.good && !$('ct-next')) addNext(c, 'Continue →', next).id = 'ct-next';
    }));
  }

  // ══ 8 — Recap ══════════════════════════════════════════════════════════
  function sceneDone(c) {
    c.innerHTML = `
      <div class="cn-tut-done">
        <div class="cn-role-big">👑</div>
        <h2 class="cn-tut-title">That's the Whole Game</h2>
        <div class="cn-tut-recap">
          <p id="cd-0" ${hidden}><span>1</span>The leader picks an answer and a partner. Everyone votes.</p>
          <p id="cd-1" ${hidden}><span>2</span>The two secretly help or sabotage. A sabotage costs +2.</p>
          <p id="cd-2" ${hidden}><span>3</span>Survive 5 rounds and loyal wins. Gold or People at 0 and traitors win.</p>
        </div>
        <div id="cd-btns" ${hidden}>
          <button class="primary-btn cn-big-btn" id="cd-play">Start a Game →</button>
          <button class="secondary-btn cn-tut-replay" id="cd-replay">↺ Replay tutorial</button>
        </div>
      </div>`;
    stagger(['cd-0', 'cd-1', 'cd-2', 'cd-btns'], 250);
    $('cd-play').addEventListener('click', () => showScreen('cn-home'));
    $('cd-replay').addEventListener('click', () => { maxVisited = 0; enter(0); });
  }

  const SCENES = [sceneGoal, sceneRole, sceneProblem, sceneLead, sceneVote, sceneAct, sceneTalk, sceneDone];

  function start() { showScreen('cn-tutorial'); maxVisited = 0; partner = 'Sam'; enter(0); }
  $('cn-btn-tutorial')?.addEventListener('click', start);
  $('cn-tut-exit').addEventListener('click', () => showScreen('cn-home'));
  $('cn-tut-prev').addEventListener('click', () => { if (current > 0) enter(current - 1); });
  $('cn-tut-next').addEventListener('click', () => { if (current < maxVisited) enter(current + 1); });
  window.councilTutorial = { start };
})();
