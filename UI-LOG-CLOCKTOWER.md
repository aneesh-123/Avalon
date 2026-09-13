# UI Log — Clocktower

UX and design decisions for Blood on the Clocktower. Kept separate from
`UI-LOG-AVALON.md` and `UI-LOG-IMPOSTER.md` so the parallel streams never append
to the same line range and conflict on merge.

Format:

```
## YYYY-MM-DD — Screen or area
**Change:** what was done
**Why:** the reasoning or the user's words
**Rejected:** alternatives considered and why they lost (omit if none)
```

---

## 2026-08-27 — Phase 0 skeleton

**Change:** Built a playable Trouble Brewing game with the nine characters whose
information is fully deterministic — Washerwoman, Investigator, Chef, Empath,
Undertaker, Monk, Soldier, Ravenkeeper, Butler, Saint, Scarlet Woman, Imp. Full
day/night cycle, nominations, voting with ghost votes, execution, win conditions.

**Why:** The server plays the Storyteller. Shipping the honest characters first
gives a complete, playable loop before any lie-generation exists, so the hard
part lands behind an interface that already works.

**Rejected:** Supporting the full 5–20 player range now. Counts above 9 need a
second and third Minion, and the only deterministic Minion in Trouble Brewing is
the Scarlet Woman. Capped at 5–9 rather than shipping a broken deal.

**Rejected:** Appending Clocktower rules to `style.css`. It's a new game with
~200 rules, and the shared stylesheet is where the three streams would collide.
Clocktower gets its own `botc.css`, linked separately.

## 2026-08-27 — Per-viewer game state

**Change:** `botc:phase-update` is built per player rather than broadcast — each
socket receives only its own character, private information, and night prompt.

**Why:** Avalon and Imposter can broadcast one sanitized game object because
almost everything is public once revealed. Clocktower's whole game is asymmetric
private information, so a shared payload would leak. Verified in a live 5-player
game that no player's view carried another player's character.

## 2026-08-27 — Colour

**Change:** Candle-amber `#d8973c` as the accent, against Avalon's gold
`#c9a96e` and Imposter's violet `#b06ec9`.

**Why:** Close enough to the house gold to belong to the same app, distinct
enough that the picker reads as three different games.

## 2026-08-27 — All phases: full Trouble Brewing

**Change:** Completed the script — all 22 characters, 5–15 players. Adds the
Poisoner and Drunk (impairment), the Recluse, Spy and Fortune Teller
(registration), and the Virgin, Slayer, Mayor, Baron and Librarian.

**Why:** Requested as a single build rather than staged phases.

### How the server lies

**Change:** When a player's ability malfunctions, the server builds them a
*fake board* — a reshuffle of the same character multiset — and answers their
questions completely truthfully from it.

**Why:** A naive wrong answer is detectable. It can name a character that
cannot be in play, or imply a composition that is impossible. Running the lie
through the same generator as the truth makes it structurally indistinguishable,
keeps it coherent across nights (the board is cached, not resampled), and gives
every ability false-info support without a line of per-character lying code.

**Rejected:** Per-ability bespoke lie generators (pick a different number, pick
a random character). Detectable, and it would need rewriting for every new
character.

**Note:** The fake board must *swap* the viewer's believed character into their
seat, never overwrite it. Overwriting duplicates one character and deletes
another, producing a board whose composition is impossible — exactly the tell
the design exists to avoid. Caught by a test asserting multiset equality.

**Note:** The Drunk's fake board is built from a pool where their true character
is replaced by their believed one. Their false world is internally consistent:
one where they really are the Washerwoman and no Drunk exists.

### Registration

**Change:** The Recluse and Spy commit once per game to whether they
misregister, rather than being resolved per question.

**Why:** A human Storyteller varies it for drama. Automated, varying it means a
Recluse who pings the Investigator but not the Empath, which reads as a broken
app rather than a twist. Committing once keeps the classic "the Recluse pinged"
scenario while staying self-consistent.

### Storyteller view

**Change:** An opt-in grimoire, host-only, showing every character, who is
poisoned, whose ability is broken, and each impaired player's fake board.

**Why:** Once the server lies, the game is unverifiable from a player's seat by
construction — a poisoned Empath reading "2" is identical to a true one. Without
this, no bug in the lie engine could ever be observed. It also becomes the
foundation for a future hybrid mode where a human picks among candidate lies.

**Rejected:** Making it always available. It leaks the entire game, so it is
gated behind a lobby toggle and the host, or the game being over.

### Known deviations from tabletop Clocktower

- The day ends on a host button rather than when nominations are exhausted.
- Voting is a simple yes/no with a hidden tally. Real Clocktower votes clockwise
  from the nominee with hands rising in view, which is tactically significant.
- No whisper support — private conversation happens in the room, not the app.
- The Mayor's night bounce fires on a coin flip rather than Storyteller judgment.

### Not included

No LLM call. The lie engine is entirely rules-based. `boardFor()` in engine.js is
the seam where a model would choose *which* fake board is most interesting; it
would replace none of the surrounding machinery.
