const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);
const isEvil    = r => EVIL_ROLES.has(r);
const isMordred = r => r === 'Mordred';
const isMorgana = r => r === 'Morgana';
const isMerlin  = r => r === 'Merlin';
const isOberon  = r => r === 'Oberon';

function buildKnown(room, player) {
  const known = [];
  room.players.forEach(other => {
    if (other.id === player.id) return;
    const r = other.role;
    if (isMerlin(player.role)) {
      if (isEvil(r) && !isMordred(r)) known.push({ id: other.id, name: other.name, label: 'evil', css: 'known-evil' });
    } else if (player.role === 'Percival') {
      if (isMerlin(r) || isMorgana(r)) known.push({ id: other.id, name: other.name, label: 'Merlin or Morgana?', css: 'known-merlin' });
    } else if (isEvil(player.role) && !isOberon(player.role)) {
      if (isEvil(r) && !isOberon(r)) known.push({ id: other.id, name: other.name, label: 'evil ally', css: 'known-evil' });
    }
  });
  return known;
}

// Generates the spoken script for the optional physical "night round" ritual.
// Purely flavor text — the exclusions mirror buildKnown() above, since the
// digital roles already carry this information regardless of this script.
function buildNightRoundScript(roleConfig) {
  const { evilCount, goodSpecials = [], evilSpecials = [] } = roleConfig;
  const hasPercival = goodSpecials.includes('Percival');
  const hasMorgana  = evilSpecials.includes('Morgana');
  const hasMordred  = evilSpecials.includes('Mordred');
  const hasOberon   = evilSpecials.includes('Oberon');

  const steps = ['Everyone, close your eyes and hold a fist out in front of you.'];

  if (evilCount > 1) {
    if (hasOberon) {
      steps.push('Minions of Mordred — everyone evil EXCEPT Oberon — open your eyes and look around to see your fellow minions. Oberon: keep your eyes closed! You stay hidden from the other minions, and you do not learn who they are.');
    } else {
      steps.push('Minions of Mordred, open your eyes and look around to see your fellow minions.');
    }
    steps.push('Minions of Mordred, close your eyes.');
  }

  if (hasPercival) {
    if (hasMorgana) {
      steps.push('Merlin and Morgana, put your thumbs up. Percival, open your eyes and see the two raised thumbs — one is Merlin, one is Morgana, but you cannot tell which.');
      steps.push('Percival, close your eyes. Merlin and Morgana, put your thumbs down.');
    } else {
      steps.push('Merlin, put your thumb up. Percival, open your eyes and see who Merlin is.');
      steps.push('Percival, close your eyes. Merlin, put your thumb down.');
    }
  }

  // Merlin sees all evil except Mordred — Oberon raises a thumb too (eyes still closed).
  const evilThumbs = hasMordred
    ? 'Everyone evil EXCEPT Mordred, put your thumbs up — Mordred stays hidden from Merlin.'
    : 'Everyone evil, put your thumbs up.';
  steps.push(`${evilThumbs}${hasOberon ? ' (Oberon: thumb up too, but keep your eyes closed.)' : ''} Merlin, open your eyes and see the raised thumbs — this is the evil among you.`);
  steps.push('Merlin, close your eyes. Everyone evil, put your thumbs down.');
  steps.push('Everyone, open your eyes. The Night Round is complete — let the quests begin!');
  return steps;
}

function buildRoleList(playerCount, roleConfig) {
  const { evilCount, goodSpecials, evilSpecials } = roleConfig;
  const goodCount   = playerCount - evilCount;
  const loyalCount  = goodCount  - 1 - goodSpecials.length;
  const minionCount = evilCount  - 1 - evilSpecials.length;
  return [
    'Merlin', ...goodSpecials, ...Array(Math.max(0, loyalCount)).fill('Loyal Servant'),
    'Assassin', ...evilSpecials, ...Array(Math.max(0, minionCount)).fill('Minion of Mordred'),
  ];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignRoles(room) {
  const roles = shuffle(buildRoleList(room.playerCount, room.roleConfig));
  room.players.forEach((p, i) => { p.role = roles[i]; });
  const assassin = room.players.find(p => p.role === 'Assassin');
  if (assassin) room.assassinId = assassin.id;
}

module.exports = { EVIL_ROLES, isEvil, isMordred, isMorgana, isMerlin, isOberon, buildKnown, buildRoleList, buildNightRoundScript, assignRoles };
