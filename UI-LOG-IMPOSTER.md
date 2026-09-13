# UI Log — Imposter

UX decisions from interactive polish sessions on the Imposter game. The point is
that settled questions stay settled — including the ones where the answer was
"leave it alone."

Kept separate from `UI-LOG-AVALON.md` so the two parallel streams never append
to the same line range and conflict on merge. Append newest at the bottom. Keep
entries short: what changed, why, and what was considered and rejected.

Format:

```
## YYYY-MM-DD — Screen or area
**Change:** what was done
**Why:** the reasoning or the user's words
**Rejected:** alternatives considered and why they lost (omit if none)
```

---

## 2026-09-13 — Word reroll ("this word is too hard")

**Change:** A table that draws an unclueable word can vote for a different one,
in both the online game and one-phone pass-and-play. A majority (more than half)
swaps the word and restarts the round.

**Why:** Aneesh: the bank's words are hard to clue, and rather than only tuning
the words, let the table throw one back. Wanted in both versions of the app.

**Decisions settled:**

- **Roles do not change on a reroll — only the word.** A re-deal would let an
  imposter vote their way out of the role. Nobody learns anything from keeping
  roles: the imposter did not know the old word and does not know the new one.
- **The window closes at the first clue** of the opening round. After that a
  clue on the board was given about a word, and swapping it makes that clue a
  lie. Also closed in later elimination rounds and for a host-chosen custom word
  (there is nothing to draw from, and it is the host's word, not the bank's).
- **Capped at 3 per game**, so the vote cannot become a way to stall.
- **The rejected word cannot come back** — `pickWord` takes an `excludeWord`.
- **Online: who asked is public**, shown by name, like the ejection vote. It
  leaks nothing and the table is talking anyway.
- **One phone: who asked is private.** Each player votes from inside their own
  card, so only the running count shows. Free privacy on a shared device, and it
  stops the table talking someone out of it.
- After a carried reroll everyone is put back on their card with a note naming
  the word that was thrown back — the card changed under people who already read
  it, so say why rather than silently re-hiding it.

**Rejected:** re-dealing roles along with the word (exploitable, above); leaving
the vote open all game (invalidates clues already given); a host-only "new word"
button (the point is that the table decides).

**Bug found and fixed on the way:** `preparePlacard()` crashed on its second
call — it wrote to `#imp-placard-name`, which lives *inside* `#imp-placard`,
before replacing that element's `innerHTML` with a label carrying no id. Latent
since the placard only ever rendered once per game; the reroll is the first
thing to call it twice, and the throw aborted the handler before the screen
switched. The name now goes in with the template instead.

## 2026-09-13 — Reroll: louder button, and an explicit "new word" message

**Change:** Two follow-ups from watching it run.

1. The "Too hard to clue? Ask for a different word" control was too easy to
   skim past. Given a filled wash and a brighter border (`#c9a96e22` on
   `#c9a96e88`, was transparent on `#c9a96e55`), slightly larger text and
   padding. Still deliberately quieter than the gold primary button — it is an
   escape hatch, not the main action.
2. One phone: a carried reroll used to reset the grid silently, which read as
   the app losing everyone's progress rather than the table getting its way.
   It now shows a **New Word** overlay — "A new word has been given because too
   many people found *X* too hard to clue… Roles have not changed, only the
   word" — dismissed with **OK — pass the phone around**.

**Why:** Aneesh, after seeing a live game: make the box a bit more obvious, and
say out loud why the word changed before the phone goes round again.

**Decision:** the online game does **not** get the extra OK tap. It already
drops every player back on their own placard, and that screen now carries the
same sentence as a banner — an extra dismissal there would be a tap for
nothing, since each player has to tap their card anyway. Wording is shared
between the two so they read as one feature.
