# UI Log — Avalon

Running record of UX decisions from interactive polish sessions. The point is
that settled questions stay settled — including the ones where the answer was
"leave it alone."

Append newest at the bottom. Keep entries short: what changed, why, and what was
considered and rejected.

Format:

```
## YYYY-MM-DD — Screen or area
**Change:** what was done
**Why:** the reasoning or the user's words
**Rejected:** alternatives considered and why they lost (omit if none)
```

---

## 2026-08-02 — Session start

**Change:** Nothing yet. Established parallel-work split — Avalon and Imposter
polished concurrently in separate worktrees, both branched from
`claude/admiring-hypatia-2qxd5`. File ownership rules in `CLAUDE.md`.

**Rejected:** Building Secret Hitler as a third parallel stream. It's a new-game
build rather than UI polish, and it would have had to touch every shared file
(`index.html`, `style.css`, `server.js`, room routing) while two other streams
were editing them. Deferred until Avalon and Imposter are merged.

**Rejected:** Running the two streams as subagents inside one session. There's a
single browser pane per session, so the user couldn't watch the app they're
giving feedback on, and two agents writing `style.css` in one worktree would
clobber each other.

## 2026-08-02 — Lobby: shareable invite link

**Change:** Host's lobby gained a "Copy invite link" button producing
`<origin>/?room=CODE`. Guests opening that link land directly on the join screen
with the code prefilled, so the only thing they type is a name.

**Why:** Reading a 5-character code aloud is the slowest part of starting a
game, and it's error-prone over a group chat.

**Rejected:** Auto-joining straight from the link without a name prompt. The
server keys identity on name plus token, and silent joins would make the lobby
fill with unnamed players. One field is a fair price.

**Rejected:** Clipboard API alone. It needs a secure context, and on game night
people reach the host over a LAN IP on plain http — which isn't one. Falls back
to a hidden textarea + `execCommand`, then to `prompt()` so the link is never
stranded.

**Note:** Following a fresh invite clears any saved session for a *different*
room, otherwise the auto-rejoin on connect would drag the guest back to the room
they last played. Reopening a link for the room you're already in still resumes.

## 2026-09-12 — Absence stops interrupting the table

**Change:** Removed the full-screen pause overlay. Presence now rides inside the
`phase-update` payload (`disconnected`), and a new status bar under the meta row
says who the game is waiting on and why — *"Waiting on Dan to vote"* — with a
"disconnected" tag only when the person holding things up is actually away.

**Why:** The overlay changed the UI for everyone and turned a dropped phone into
the table nagging someone to rejoin. Its only job was preventing actions while a
player couldn't act — and it never did that: no server handler checked
`room.disconnected`. The completion gates already require every player's vote,
so the protection was structural all along and the modal was pure interruption.

**Rejected:** Keeping a smaller pause banner. If nothing is blocked, a
disconnect is a footnote; the status bar stays silent unless the game genuinely
cannot advance.

**Note:** "Leave game" lived only on that overlay. It now sits in the status bar,
keeping its two-tap confirm.

## 2026-09-12 — Shot clock

**Change:** Optional per-room rule (lobby toggle, default off). Any player can
call for a clock during team-select or team-vote; at a majority a visible
countdown starts. The blocked action happening cancels it.

- **team-select expiry** — proposal skipped, leadership passes, **counts as a
  rejection**.
- **team-vote expiry** — missing votes filled as **approve**, marked as
  clock-filled in the tally.
- **quest-vote** — no clock, ever.

**Why:** Rounds stalled with no way to apply pressure.

**Rejected:** Defaulting missing team votes to reject. Five consecutive
rejections hands evil the game, so an absent player could lose it for Good
without anyone choosing that. Approve has no equivalent doomsday counter.

**Rejected:** A clock on quest votes. Only evil players get a Fail button, so
any default either neuters a slow evil player or leaks alignment from the
outcome. There is no honest default.

**Decision (user):** Clock expiry on team-select *does* count toward the five
rejections. Without it the clock has no teeth.

## 2026-09-12 — Buttons that stopped working until refresh

**Change:** The client now handles the full socket lifecycle. It re-registers on
*every* connect rather than only the first, force-resyncs state afterwards,
shows a "Reconnecting…" banner while down, and recovers automatically when the
server reports a `desync`.

**Why:** Socket.IO reconnects under a new socket id. Until the server re-mapped
it, every action hit `getRoomOf(socket.id) === undefined` and was dropped
silently — a dead button indistinguishable from a working one. The server's
`request-sync` handler existed but the client never called it.

**Note:** Those silent `if (!room) return;` guards now emit `desync` instead of
vanishing, so the client can repair itself rather than the player refreshing.

## 2026-09-12 — Server crash from one malformed payload

**Change:** `create-room` validates the campaign table; `propose-team` guards
the lookup.

**Why:** Found while testing — a `create-room` with `campaignsConfig: null` was
stored happily, then dereferenced during `propose-team`, throwing an unhandled
exception that **killed the process and every game on it**. Serious for a public
deployment: any client could end everyone's game night with one bad payload.

**Still open:** There is no process-level guard, so a different unhandled throw
could still take the server down. Worth considering before going public.

## 2026-09-12 — Role dealing is genuinely random (verified, no change)

**Change:** None — checked on request.

`assignRoles` uses a correct Fisher-Yates shuffle. Ran 200,000 five-player deals
and tallied seat×role frequency: chi-square **28.62 on 16 df**, against a p=0.001
critical value of ~39.3. Uniform. Seat-to-seat repeat rate across consecutive
games also matched expectation.

The perception is a real statistical intuition trap: with 5 players, the chance
that *at least one person* repeats their role from the previous game is
1 − (4/5)^5 ≈ **67%**. Two games in three will feel "not random" while being
exactly random.

## 2026-09-13 — Six new roles

**Change:** Added Cleric and Untrustworthy Servant (good), Lunatic, Brute,
Trickster and Revealer (evil).

**Why:** More variety without touching the alignment model.

Each one fits an existing seam, which is why they were cheap:

| Role | Where it lives |
| --- | --- |
| Cleric | `buildKnown` — learns if the first leader is good or evil |
| Untrustworthy Servant | `buildKnown` — the Assassin is shown them |
| Lunatic | `canPlayQuestCard` — cannot pass |
| Brute | `canPlayQuestCard` — cannot fail after quest 3 |
| Trickster | `ladyReading` — the Lady always reads them good |
| Revealer | `gameState` — outed publicly once three quests resolve |

**Note:** `startGame` now calls `beginGame()` *before* sending role information.
The Cleric's fact is about the first leader, and `currentLeaderIndex` did not
exist until after roles went out.

**Note:** The good/evil test was hardcoded as `isEvil(role)` in seven places.
Two of those became `canPlayQuestCard` and `ladyReading`. This is deliberate
groundwork: Lancelot needs alignment to be mutable per-player, and shrinking the
number of places that derive it from the role name is most of that work.

**Rejected:** Lancelot itself. It is the only proposed role whose allegiance
changes mid-game, which means `player.alignment` has to become real state. Worth
doing as its own step rather than smuggling it in here.

**Note:** Only the original eight roles have painted portraits. The new six use
their emoji on a gradient instead of requesting an image that isn't there —
previously that was twelve 404s per render and a hidden broken image.

## 2026-09-13 — Role descriptions in the picker

**Change:** Every role now carries its description. Hover reveals it on pointer
devices; an ⓘ button reveals it on touch. Below the grid, a summary strip lists
only the roles you have actually chosen, one line each.

**Why:** The picker previously showed a description *only* for locked and filler
roles — Merlin, Assassin, Loyal Servant, Minion. The four roles you actually
have to decide about were the only ones you could not read about, because
clicking them toggled them instead.

**Rejected:** Showing all descriptions inline. Fourteen roles of body text is
exactly the wall the request was trying to avoid.

**Note:** ⓘ is a separate hit target with `stopPropagation`, so reading about a
role can never toggle it by accident. Verified.

## 2026-09-13 — Quick start

**Change:** After choosing a player count, one button accepts the recommended
setup and jumps to the name field. The sections stay visible and editable
underneath. A live one-line preview shows what it will pick.

**Why:** The evil count and quest table were *already* computed correctly by
`defaultEvilCount()` and `defaultTeamSizes()`. Setup was not a configuration
problem — it was four "Continue" taps past defaults that were right to begin
with.

**Note:** Roles were the one thing with no default (`activeToggles.clear()`).
Quick start seeds Percival + Morgana, adding Mordred at 7+.

## 2026-09-13 — Quest requirements are visible before the quest

**Change:** The campaign track marks quests needing two fails, every dot carries
a tooltip with team size and fails needed, and the phase header spells it out
during team selection.

**Why:** Team size was shown; fails-needed was not, appearing only in the
history popup *after* a quest resolved. At 7+ players quest 4 needs two fails —
the most strategically important fact on the board — and nothing said so until
it was over.

## 2026-09-15 — QR code to join

**Change:** The lobby now shows a QR code as the primary way in, captioned
"Scan to join". Copy-link demotes to "Or copy the invite link" underneath.

**Why:** Copy-link needs a channel — paste into a group chat, everyone unlocks
a phone, finds the message, taps. A QR needs nothing: hold up the screen and
five people point cameras at it. For people in the same room, which is the whole
use case, it is strictly faster.

**Rejected:** Vendoring a client-side QR library into `public/`. `CLAUDE.md`
says no bundler and no UI library, and a hand-rolled encoder is not worth it —
QR needs Reed-Solomon error correction and masking to be correct. Generating
server-side and serving SVG keeps the client a plain `<img>`.

**Rejected:** A third-party QR image API. It would leak every room's invite URL
to someone else's server, and add an outage we do not control.

**Note:** The client passes the URL to encode rather than the server deriving
it. Only the client knows the origin players actually reached the app on — a
LAN IP on game night, Render in production, localhost in dev.

**Note:** `/qr` refuses to encode anything whose host is not the requesting
host. Without that the endpoint is an open QR generator pointing anywhere, which
is a phishing primitive given people scan these without reading them.

**Note:** On localhost the lobby says so explicitly rather than showing a code
that silently resolves to the scanner's own machine.

**Note:** `qrcode` is declared in `dependencies`, not installed ad hoc. It runs
at server boot, so a missing declaration would fail Render's `npm ci` deploy.
