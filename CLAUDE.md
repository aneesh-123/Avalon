# Game Night — Avalon & Imposter

A party-game web app. One Node/Express server, Socket.IO for realtime, static
client in `public/`. Two games share the app behind an opening game-picker
screen: **Avalon** (The Resistance: Avalon) and **Imposter**.

## Running it

```bash
npm start          # server on http://localhost:3000
npm test           # jest, tests/
node scripts/spawn-bots.js --players=5 --seats-for-you=1
```

`spawn-bots.js` opens headed Playwright windows that create a room, join, ready
up, and play with randomized choices — leaving `--seats-for-you` seats open for
a human. Useful flags: `--players=N`, `--night-round=1`, `--roles=a,b`,
`--evil=N`, `--url=`. Set `BOTS_HEADLESS=1` to run without windows.

Requires `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (gitignored).
Rooms persist to Supabase and are restored on boot — see `server/db.js`.

## Architecture

| Layer | Avalon | Imposter |
| --- | --- | --- |
| Client logic | `public/client.js`, `public/tutorial.js` | `public/imposter.js` |
| Server logic | `server/socketHandlers.js`, `gameEngine.js`, `roles.js`, `state.js` | `server/imposter/` |
| Room store | `server/rooms.js` | `server/imposter/rooms.js` |
| Socket events | bare names (`create-room`, `team-vote`) | `imp:` prefix (`imp:create-room`) |
| CSS prefix | `#screen-*`, game-specific classes | `imp-` prefix, `#screen-imp-*` |

Shared by both: `public/index.html` (every screen lives here), `public/style.css`,
`server.js`, `server/db.js`.

Screens are `<div class="screen">` blocks toggled by an `active` class; only one
is visible at a time.

## Parallel work — file ownership

Avalon and Imposter are being worked on **concurrently in separate worktrees**.
Both branch from `claude/admiring-hypatia-2qxd5`. To keep the merge clean, stay
inside your lane:

**If you own Avalon**, you may edit `public/client.js`, `public/tutorial.js`,
`server/socketHandlers.js`, `gameEngine.js`, `roles.js`, `state.js`, `rooms.js`.
Never touch `public/imposter.js` or `server/imposter/`.

**If you own Imposter**, you may edit `public/imposter.js` and `server/imposter/`.
Never touch `public/client.js`, `public/tutorial.js`, or the Avalon server files.

**In the shared files**, edit only your own game's region:

- `public/index.html` — Imposter owns everything under the
  `<!-- ═══ IMPOSTER GAME SCREENS ═══ -->` marker. Avalon owns everything above it.
  Neither should restructure the game-picker block at the top.
- `public/style.css` — Imposter owns `imp-` prefixed rules and `#screen-imp-*`.
  Avalon owns the rest. **Append new rules to the end of your own region rather
  than editing shared base rules** (`.screen`, `.btn`, `:root` variables) —
  changing a shared rule is the one thing guaranteed to conflict.
- `server.js`, `server/db.js` — neither side should need changes. If you do, say
  so rather than editing silently.

Rebase on the base branch whenever you land a chunk. Don't let the branches
diverge for days.

## Conventions

- No build step and no framework — plain ES modules, vanilla DOM, hand-written
  CSS. Don't introduce a bundler or a UI library.
- Colors come from CSS custom properties defined in `:root`. Use them rather
  than hardcoding hex values.
- Server is authoritative for all game state. The client renders what it's told
  and never decides outcomes — role assignment, vote tallies, and win conditions
  are server-side only.
- Player identity survives reconnects via a token (`claim-slot` / `rejoin-room`).
  Preserve that when touching connection logic.

## UI iteration

`UI-LOG.md` records UX decisions made during interactive polish sessions,
including things deliberately rejected or left alone. Read it before proposing
UI changes so settled questions don't get reopened; append to it when a decision
is made.
