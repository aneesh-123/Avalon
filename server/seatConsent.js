// Table consent for seats that change hands. Shared by Avalon, Imposter and
// Secret Hitler.
//
// A phone can hold more than one player (public/seats.js), and a player whose
// phone died can take their seat back from another device by name. Both are
// also exactly how someone would cheat: take over a seat to read its role, or
// run a second player from their own phone. So neither happens on one
// person's say-so. Everyone else at the table is asked, and it goes ahead
// only if all of them allow it. One "no" stops it.
//
// What needs asking:
//   · 'add'      — a new player joins from a phone already seated in the room.
//   · 'takeover' — a seat in a game in progress is reclaimed by name from a
//                  device that doesn't hold its token.
// A player getting back in on their own phone (token match) is never asked.
//
// Devices are told apart by `handshake.auth.device`, an id every page on one
// phone shares (seats.js). A phone holding several seats votes once.
//
// Each game calls consent.attach(socket) on connection. Then, in a handler:
//   if (!consent.gate(socket, { game, code, name, kind, players, retry })) return;
// gate() returns true when the action may go ahead now: nobody else to ask,
// or the table already said yes. Otherwise it asks, returns false, and calls
// retry() once everyone has allowed it, so the handler re-checks everything
// against the room as it is by then.
const { guardedOn, isLiveSocket, later } = require('./safeSocket');

const ASK_TIMEOUT_MS = 2 * 60 * 1000;
const byIo = new WeakMap();

function consentFor(io) {
  if (byIo.has(io)) return byIo.get(io);

  const pending = new Map();   // request id -> request
  const grants  = new Map();   // socket id -> { game, code, name }
  let seq = 0;

  const deviceOf = id => {
    const d = io?.sockets?.sockets?.get?.(id)?.handshake?.auth?.device;
    return typeof d === 'string' && d ? d.slice(0, 64) : null;
  };

  // Whether a socket shares its phone with a live player in this room.
  function sharesPhone(socket, players) {
    const dev = deviceOf(socket.id);
    return !!dev && players.some(p => p.id !== socket.id && isLiveSocket(io, p.id) && deviceOf(p.id) === dev);
  }

  function close(req, outcome, extra = {}) {
    if (pending.get(req.id) !== req) return;
    pending.delete(req.id);
    req.voters.forEach(v => v.sockets.forEach(id => io.to(id).emit('seat:consent-closed', { id: req.id })));
    const s = req.socket;
    if (outcome === 'approved') {
      grants.set(req.socketId, { game: req.game, code: req.code, name: req.name.toLowerCase() });
      s?.emit('seat:consent-closed', { id: req.id, approved: true });
      try { req.retry(); } finally { grants.delete(req.socketId); }
    } else {
      s?.emit('seat:consent-denied', { id: req.id, name: req.name, ...extra });
    }
  }

  function waitingOn(req) {
    return [...req.voters.entries()].filter(([k]) => !req.yes.has(k)).map(([, v]) => v.names.join(' & '));
  }

  function update(req) {
    if (pending.get(req.id) !== req) return;
    if (!req.voters.size || req.voters.size === req.yes.size) { close(req, 'approved'); return; }
    req.socket.emit('seat:consent-wait', { id: req.id, name: req.name, kind: req.kind, waitingOn: waitingOn(req) });
  }

  function gate(socket, { game, code, name, kind, players, retry }) {
    const g = grants.get(socket.id);
    if (g && g.game === game && g.code === code && g.name === String(name).toLowerCase()) return true;

    const myDevice = deviceOf(socket.id);
    // One vote per phone. A socket with no device id counts as its own phone.
    const voters = new Map();
    for (const p of players) {
      if (p.id === socket.id || !isLiveSocket(io, p.id)) continue;
      const dev = deviceOf(p.id);
      if (myDevice && dev === myDevice) continue;   // the asking phone itself
      const key = dev || 'sock:' + p.id;
      const v = voters.get(key) || { names: [], sockets: new Set() };
      v.names.push(p.name);
      v.sockets.add(p.id);
      voters.set(key, v);
    }
    if (!voters.size) return true;   // nobody else here to ask

    // A new ask from the same socket replaces its old one.
    pending.forEach(r => { if (r.socketId === socket.id) close(r, 'replaced'); });

    const via = myDevice
      ? players.find(p => p.id !== socket.id && isLiveSocket(io, p.id) && deviceOf(p.id) === myDevice)?.name || null
      : null;
    const req = { id: 'sc' + (++seq), socket, socketId: socket.id, game, code, name, kind, via, voters, yes: new Set(), retry };
    pending.set(req.id, req);
    voters.forEach(v => v.sockets.forEach(id =>
      io.to(id).emit('seat:consent-ask', { id: req.id, game, name, kind, via })));
    update(req);
    later(ASK_TIMEOUT_MS, () => close(req, 'timeout', { reason: 'timeout' }));
    return false;
  }

  // Every game calls this for each new socket; only the first one counts.
  const attached = new WeakSet();
  function attach(socket) {
    if (attached.has(socket)) return;
    attached.add(socket);
    const on = guardedOn(socket, 'seat-consent');

    on('seat:consent-answer', ({ id, yes }) => {
      const req = pending.get(id);
      if (!req) return;
      const entry = [...req.voters.entries()].find(([, v]) => v.sockets.has(socket.id));
      if (!entry) return;
      if (yes !== true) { close(req, 'denied', { by: entry[1].names.join(' & ') }); return; }
      req.yes.add(entry[0]);
      update(req);
    });

    on('seat:consent-cancel', () => {
      pending.forEach(r => { if (r.socketId === socket.id) close(r, 'cancelled', { reason: 'cancelled' }); });
    });

    on('disconnect', () => {
      pending.forEach(r => {
        if (r.socketId === socket.id) { close(r, 'cancelled', { reason: 'cancelled' }); return; }
        // A voter who left can't answer; the rest of the table decides.
        for (const [key, v] of r.voters) {
          if (!v.sockets.delete(socket.id) || v.sockets.size) continue;
          r.voters.delete(key);
          r.yes.delete(key);
          update(r);
        }
      });
    });
  }

  const api = { gate, sharesPhone, attach };
  byIo.set(io, api);
  return api;
}

module.exports = { consentFor };
