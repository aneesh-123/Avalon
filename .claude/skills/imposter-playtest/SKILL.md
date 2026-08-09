---
name: imposter-playtest
description: Start a live Imposter game with bot players and hand the user a ready-to-join browser. Use when the user wants to play, test, or click through the Imposter game — "run imposter", "spin up bots", "let me play imposter", "start a 7 player game with 2 imposters". Not for Avalon (use scripts/spawn-bots.js) and not for automated regression checks (use npm test).
---

# Imposter playtest

Puts the user into a live Imposter game against bot players in one step. The
user plays as a real player in their browser; bots fill every other seat and
play on their own.

## Steps

### 1. Clear anything still running

Bots and browsers from a previous run will fight over the lobby. Kill only the
bot processes — **never** a broad `node.exe` kill, which takes the dev server
(and the Browser pane) with it:

```bash
powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*spawn-imposter-bots*' } | ForEach-Object { taskkill /PID \$_.ProcessId /T /F }"
```

### 2. Start the server

Use `preview_start` with `avalon-server` (port 3000). It serves both games.

If it is already running **and any file under `server/` changed since it
started, restart it** — `preview_stop` then `preview_start`. Node does not
hot-reload; a stale server silently serves old game logic and wastes a whole
playthrough. Client files (`public/`) only need a browser refresh.

### 3. Spawn the bots

```bash
node scripts/spawn-imposter-bots.js --players=5 --seats-for-you=1 --url=http://localhost:3000 --discussion-secs=30
```

Run it in the background, then wait for the `JOIN URL:` line before continuing.

Flags — map whatever the user asked for onto these, and leave the rest at
default:

| Flag | Default | Notes |
| --- | --- | --- |
| `--players=N` | 5 | Total seats, 4–15 |
| `--seats-for-you=N` | 1 | Seats left open for humans |
| `--imposters=N` | 1 | 1–3; regulars must outnumber the imposter side |
| `--rounds=2` | 1 | Two clue rounds instead of one |
| `--roles=a,b` | none | `detective,confused,doubleagent,accomplice,jester` |
| `--hint=LEVEL` | category | `none,category,vague,related,first-letter,letter-count` |
| `--categories=A,B` | all | Exact names, e.g. `Food,Movies & TV` |
| `--custom-words=a,b` | none | Host-added words; enables the "Your Words" category |
| `--discussion-secs=N` | 25 | How long the host bot holds Discussion open |
| `--url=` | localhost:3001 | **Pass `http://localhost:3000`** to match the server above |

`--imposters=2` needs 5+ players and `--imposters=3` needs 7+, or the server
rejects the config — check before spawning rather than letting it fail.

### 4. Hand over the browser

Open the Browser pane at the `JOIN URL` from the script output
(`http://localhost:3000/?imp=CODE`). That lands on the join screen with the code
already filled in; the user only types a name.

Clear any stale session first, or auto-rejoin will drag them into an old game:

```js
localStorage.removeItem('imposter-session'); localStorage.removeItem('avalon-session');
```

Then tell the user the room code, **spelling out digits** (`3A0CA` reads as
"three-A-zero-C-A"). `0`/`O` and `1`/`I` are silent join failures because the
lookup is an exact object-key match.

### 5. Report and wait

State the room code, what settings are in play, and that bots ready up
automatically once the lobby fills. Then stop and wait — the user is going to
play and report UI problems.

## Default bot behaviour

Say this back to the user only if they ask, or if a run deviates from it:

- Reveal their card, then clue on their turn. Bots who know the word clue from
  that word's real `hint`/`related` entry; the Imposter bluffs with a hint from
  a **different** word in the same category.
- The host bot holds Discussion open for `--discussion-secs`, then starts the
  vote.
- Everyone votes at random among the players still on the ballot.
- A caught Imposter guesses a random word from the category (so it usually
  loses the final guess).
- On game over they idle so the reveal stays on screen.

If the user wants different behaviour — bots always voting for a specific
player, deliberately bad clues, an Imposter that guesses correctly — that is a
change to `autoplayLoop` in `scripts/spawn-imposter-bots.js`. Make it before
spawning, and mention that it now differs from the default.

## Cleaning up

Same targeted kill as step 1. Confirm the server survived:

```bash
powershell -Command "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*server.js*' }).Count"
```

## When fixing what the user reports

Imposter owns `public/imposter.js`, `server/imposter/`, the `imp-`/`#screen-imp-*`
CSS, and everything below the `IMPOSTER GAME SCREENS` marker in `index.html`.
Append new CSS to the end of that region rather than editing shared base rules.

Run `npm test` before pushing — the suite covers both games, and Avalon is the
regression net for the whole repo. If a fix is visible on screen, verify it with
a headless Playwright run and a screenshot rather than asking the user to check.
