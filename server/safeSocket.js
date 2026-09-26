// Guards shared by the Avalon and Imposter socket handlers.
//
// Socket.IO runs every listener inside a process.nextTick, so an exception in
// one is uncaught — it takes the whole Node process down, and with it every
// game on the server. A single client emitting `join-room` with no payload was
// enough. Every handler goes through `guardedOn` so a bad message costs that
// one message, never the server.

function guardedOn(socket, label) {
  return (event, fn) => socket.on(event, (payload, ...rest) => {
    try {
      // Handlers destructure their payload; a missing or non-object one would
      // throw before any validation runs. 'disconnect' passes a reason string,
      // which no handler reads, so normalising it is harmless.
      fn(payload && typeof payload === 'object' ? payload : {}, ...rest);
    } catch (e) {
      console.error(`[${label}] handler '${event}' failed:`, e);
    }
  });
}

// A display name as the server will store it: a trimmed string, inner runs of
// whitespace collapsed, capped at 20 characters. Returns '' for anything that
// is not a usable name, which the caller turns into an error.
const MAX_NAME = 20;
function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

// Whether a socket id still belongs to a live connection. Unknown (a test
// double with no socket registry) counts as not live, which keeps the old
// permissive behaviour there.
function isLiveSocket(io, id) {
  const reg = io?.sockets?.sockets;
  return !!(reg && typeof reg.has === 'function' && reg.has(id));
}

// How long a room survives with every player disconnected. Phones drop their
// socket whenever the app is backgrounded or the screen locks, so a table that
// all glance at a text at once — or break for dinner — used to find their game
// deleted. An explicit "Leave game" from everyone still deletes immediately.
const EMPTY_ROOM_GRACE_MS = 30 * 60 * 1000;

function later(ms, fn) {
  const t = setTimeout(fn, ms);
  if (typeof t?.unref === 'function') t.unref();   // never hold the process open
  return t;
}

module.exports = { guardedOn, cleanName, isLiveSocket, EMPTY_ROOM_GRACE_MS, later, MAX_NAME };
