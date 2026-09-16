/**
 * Quest cards: what each role may play, and what happens when they may not.
 *
 * A refused card used to be dropped in silence. The client had already switched
 * itself to "you voted", the server had recorded nothing, and the quest sat at
 * "1/2 voted" with no way forward — the phase never reached quest-vote-ready,
 * so the leader could never reveal and the game was over as a game.
 *
 * The rule here is not "refuse fewer cards". It is that a refusal must always
 * reach the player who made it, and every accepted card must be acknowledged,
 * so the client never has to guess whether its vote landed.
 */

const registerHandlers = require('../server/socketHandlers');
const { gameState }    = require('../server/state');
const { questCardRejection, canPlayQuestCard } = require('../server/roles');
const { makeIo, connectSocket, buildRoom, startGame, clearRooms } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

let io;
beforeEach(() => { clearRooms(); ({ io } = makeIo()); registerHandlers(io); });

const makePlayers = n => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `P${i + 1}` }));

function onQuest(roles, campaign = 0) {
  const players = makePlayers(roles.length);
  const room = buildRoom('R1', players, { state: 'playing' });
  startGame(room);
  room.players.forEach((p, i) => { p.role = roles[i]; });
  room.phase = 'quest-vote';
  room.currentCampaign = campaign;
  room.questVotes = {};
  const sockets = players.map(p => { const s = connectSocket(io, p.id); s.join('R1'); return s; });
  const find = r => room.players.find(p => p.role === r);
  const sock = id => sockets.find(s => s.id === id);
  return { room, sock, find };
}

const LUNATIC_GAME = ['Lunatic', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana'];
const BRUTE_GAME   = ['Brute',   'Merlin', 'Loyal Servant', 'Assassin', 'Morgana'];

// ── The stall itself ──────────────────────────────────────────────────────

describe('a refused card never strands the quest', () => {
  test('the Lunatic cannot pass — and is told so, rather than dropped', () => {
    const { room, sock, find } = onQuest(LUNATIC_GAME);
    const lun = find('Lunatic'), mer = find('Merlin');
    room.proposedTeam = [lun.id, mer.id];

    sock(mer.id).trigger('quest-vote', { vote: 'pass' });
    sock(lun.id).trigger('quest-vote', { vote: 'pass' });

    expect(gameState(room).questVoteCount).toBe(1);               // still refused
    expect(sock(lun.id).last('quest-vote-rejected').reason).toMatch(/Lunatic/);
    expect(sock(lun.id).received('quest-vote-ok')).toBe(false);
  });

  test('and can then finish the quest with the card they do have', () => {
    const { room, sock, find } = onQuest(LUNATIC_GAME);
    const lun = find('Lunatic'), mer = find('Merlin');
    room.proposedTeam = [lun.id, mer.id];

    sock(mer.id).trigger('quest-vote', { vote: 'pass' });
    sock(lun.id).trigger('quest-vote', { vote: 'pass' });   // refused
    sock(lun.id).trigger('quest-vote', { vote: 'fail' });   // their only legal card

    expect(gameState(room).questVoteCount).toBe(2);
    expect(room.phase).toBe('quest-vote-ready');             // the leader can reveal
    expect(sock(lun.id).last('quest-vote-ok').vote).toBe('fail');
  });

  test('the Brute cannot fail quest 4, is told why, and passes instead', () => {
    const { room, sock, find } = onQuest(BRUTE_GAME, 3);
    const br = find('Brute'), mer = find('Merlin');
    room.proposedTeam = [br.id, mer.id];

    sock(mer.id).trigger('quest-vote', { vote: 'pass' });
    sock(br.id).trigger('quest-vote', { vote: 'fail' });
    expect(gameState(room).questVoteCount).toBe(1);
    expect(sock(br.id).last('quest-vote-rejected').reason).toMatch(/Brute/);

    sock(br.id).trigger('quest-vote', { vote: 'pass' });
    expect(gameState(room).questVoteCount).toBe(2);
    expect(room.phase).toBe('quest-vote-ready');
  });

  test('the Brute may still sabotage quests 1 to 3', () => {
    [0, 1, 2].forEach(campaign => {
      const { room, sock, find } = onQuest(BRUTE_GAME, campaign);
      const br = find('Brute');
      room.proposedTeam = [br.id, find('Merlin').id];
      sock(br.id).trigger('quest-vote', { vote: 'fail' });
      expect(sock(br.id).received('quest-vote-rejected')).toBe(false);
      expect(room.questVotes[br.id]).toBe('fail');
    });
  });

  test('a good player failing is refused out loud too', () => {
    const { room, sock, find } = onQuest(LUNATIC_GAME);
    const mer = find('Merlin');
    room.proposedTeam = [mer.id, find('Lunatic').id];
    sock(mer.id).trigger('quest-vote', { vote: 'fail' });
    expect(sock(mer.id).last('quest-vote-rejected').reason).toMatch(/Evil/);
    expect(gameState(room).questVoteCount).toBe(0);
  });
});

// ── The acknowledgement ───────────────────────────────────────────────────

describe('every accepted card is acknowledged', () => {
  test('an ordinary pass is acked, so the client need not assume', () => {
    const { room, sock, find } = onQuest(LUNATIC_GAME);
    const mer = find('Merlin');
    room.proposedTeam = [mer.id, find('Lunatic').id];
    sock(mer.id).trigger('quest-vote', { vote: 'pass' });
    expect(sock(mer.id).last('quest-vote-ok')).toEqual({ vote: 'pass' });
  });

  test('the ack goes only to the voter — it would otherwise leak the card', () => {
    const { room, sock, find } = onQuest(LUNATIC_GAME);
    const mer = find('Merlin'), lun = find('Lunatic');
    room.proposedTeam = [mer.id, lun.id];
    sock(mer.id).trigger('quest-vote', { vote: 'pass' });
    expect(sock(lun.id).received('quest-vote-ok')).toBe(false);
    expect(sock(find('Assassin').id).received('quest-vote-ok')).toBe(false);
  });

  test('changing a card re-acks, and does not double-count', () => {
    const { room, sock, find } = onQuest(LUNATIC_GAME);
    const ass = find('Assassin');
    room.proposedTeam = [ass.id, find('Merlin').id];
    sock(ass.id).trigger('quest-vote', { vote: 'pass' });
    sock(ass.id).trigger('quest-vote', { vote: 'fail' });
    expect(gameState(room).questVoteCount).toBe(1);
    expect(room.questVotes[ass.id]).toBe('fail');
    expect(sock(ass.id).last('quest-vote-ok').vote).toBe('fail');
  });
});

// ── The rule itself ───────────────────────────────────────────────────────

describe('questCardRejection is the single source of the rule', () => {
  const P = role => ({ id: 'x', name: 'X', role });
  const ALL_ROLES = [
    'Merlin', 'Loyal Servant', 'Percival', 'Cleric', 'Untrustworthy Servant',
    'Assassin', 'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred',
    'Lunatic', 'Brute', 'Trickster', 'Revealer',
  ];

  test('canPlayQuestCard agrees with it in every case', () => {
    [0, 3].forEach(campaign => {
      const r = { currentCampaign: campaign, players: [] };
      ALL_ROLES.forEach(role => ['pass', 'fail'].forEach(vote => {
        expect(canPlayQuestCard(r, P(role), vote))
          .toBe(questCardRejection(r, P(role), vote) === null);
      }));
    });
  });

  test('every role has at least one card it can legally play', () => {
    [0, 1, 2, 3, 4].forEach(campaign => {
      const r = { currentCampaign: campaign, players: [] };
      ALL_ROLES.forEach(role => {
        const legal = ['pass', 'fail'].filter(v => canPlayQuestCard(r, P(role), v));
        expect(legal.length).toBeGreaterThan(0);   // otherwise the quest deadlocks
      });
    });
  });

  test('a nonsense card is refused with a reason, not a crash', () => {
    const r = { currentCampaign: 0, players: [] };
    expect(questCardRejection(r, P('Merlin'), 'maybe')).toBeTruthy();
    expect(questCardRejection(r, null, 'pass')).toBeTruthy();
    expect(questCardRejection(r, P('Merlin'), undefined)).toBeTruthy();
  });

  test('every refusal reads as a sentence a player can act on', () => {
    const r = { currentCampaign: 0, players: [] };
    [
      questCardRejection(r, P('Merlin'), 'fail'),
      questCardRejection(r, P('Lunatic'), 'pass'),
      questCardRejection({ currentCampaign: 4, players: [] }, P('Brute'), 'fail'),
    ].forEach(reason => {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(20);
      expect(reason).toMatch(/\.$/);
    });
  });
});
