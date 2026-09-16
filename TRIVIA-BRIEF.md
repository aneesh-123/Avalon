# Trivia Night — design brief

Written at the end of the Avalon session that designed it, so the session that
*builds* it doesn't have to reconstruct the reasoning. Nothing here is built
yet. Read `CLAUDE.md` first for the architecture and the file-ownership rules —
this document only covers decisions specific to trivia.

## What it is

A third game behind the same picker as Avalon and Imposter. A host reads or
displays a question, players buzz in on their phones, first correct answer
scores. Rounds accumulate into a scoreboard.

## Decisions already made

**Buzzers are timestamped on the device, not the server.**
This is the one genuinely load-bearing decision. If the server timestamps
buzzes on arrival, the winner is whoever has the better connection — a player
on hotel wifi loses a race they won in the room. So the client stamps
`performance.now()` at the moment of the tap, sends that, and the server ranks
by the stamped time rather than arrival order.

The cost is that the client can lie. Two mitigations, in order of preference:
- Establish a per-client clock offset when the round opens (the server sends
  `t0`, the client echoes it back, the round-trip halves into an offset), so
  the stamps are comparable across devices.
- Close the buzz window a beat *after* the first buzz arrives (~150ms) and rank
  everything in that window, rather than taking the literal first packet.

Don't let a client submit a buzz timestamped before the question was revealed —
that's the only forgery that actually matters.

**Two modes, and host mode ships first.**
- *Host mode*: a human reads questions aloud from their own list or a pack, and
  taps who got it right. The app is a buzzer and a scoreboard. This is most of
  the value and none of the risk.
- *Computer-run mode*: the app supplies the questions and judges the answers.
  Much more work, and it's the mode where everything can go wrong.

Build host mode first and completely. Computer-run mode is a second phase.

**If an LLM is involved, it judges — it does not score.**
Free-text answers are the one place a model genuinely helps: deciding that
"FDR" and "Franklin Delano Roosevelt" and "roosevelt" are the same answer is
tedious to hand-code and easy for a model. But the model returns a
match / no-match judgement on one answer against one expected answer, and the
engine owns the score, the tie-breaks, and the win condition. Same principle
Avalon follows: **the server is authoritative; the model is an input.**

Do not let a model generate questions on the fly into a live game without a
human seeing them first. Two failure modes, both observed in this class of app:
- **Repeats.** A model asked for "a trivia question about geography" converges
  hard on the same few questions. Any generated pack needs dedupe against
  everything already asked in the room, and ideally against previous rooms.
- **Confidently false trivia.** A wrong answer key is worse than no question,
  because the app will mark a correct player wrong and there's no appeal. If
  questions are generated, they need a stored answer key written at generation
  time, not re-derived at judging time.

The safe version of computer-run mode is a curated question bank checked into
the repo, with the model only doing answer matching.

## Where it goes in the codebase

Follow the Imposter precedent exactly — it's the template for "a second game in
this app":

- `public/trivia.js`, screens under a `<!-- TRIVIA -->` marker in
  `public/index.html`, CSS rules prefixed `triv-` appended to the end of
  `public/style.css`.
- `server/trivia/` for game logic, `server/trivia/rooms.js` for the room store.
- Socket events prefixed `triv:` (`triv:create-room`, `triv:buzz`).
- Invite links must carry `&game=trivia` — room codes live in separate stores
  per game, so a bare code is ambiguous.
- No build step, no framework, no UI library. Hardcoded hex colors; the palette
  is gold `#c9a96e` on near-black.

## Things worth stealing from Avalon

These were all built and debugged in the Avalon session and the same problems
will appear in trivia:

- **Reconnect identity.** Players survive a dropped connection via a token
  (`claim-slot` / `rejoin-room`), not a socket id. A reconnect gets a *new*
  socket id; any handler that looks a player up by socket id silently no-ops
  after a reconnect, which presents as "the buttons stopped working". Client
  re-registers and calls `request-sync` on reconnect, and the server emits
  `desync` rather than returning silently when it can't place a socket.
- **One room at a time.** `leaveOtherRooms(socket, keepCode)` — without it, a
  player who joins a second game renders one game while the lobby shows another.
- **Malformed payloads kill the process.** An unhandled throw in a socket
  handler takes down the server and every game on it. Validate payload shape at
  the boundary. (There is still no process-level guard; adding one would be a
  genuine improvement.)
- **Persistence.** Rooms save to Supabase via `server/db.js` and restore on
  boot. Save on lobby changes too, not just game state — Avalon shipped a bug
  where lobbies weren't persisted and every room died on restart.

## Test expectations

CI runs jest plus `scripts/smoke-test.js` on every push. Trivia needs at least
one integration test that boots a real Socket.IO server and plays a round
through real clients — it's the only layer that catches wire-level breakage.
Buzz ordering specifically deserves a test with deliberately skewed client
clocks.
