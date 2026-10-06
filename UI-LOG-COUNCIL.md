# UI log: The Council

UX decisions for The Council, kept separate from the other games' logs so
they never conflict on merge.

## 2026-10-06: first playable demo (Version A)

- Readability first: big bold text, high-contrast panels, no faint text over
  the background. Gold is yellow, People is blue, traitor is red, loyal is
  green, whispers are purple, so each thing has one color everywhere.
- Gold and People are shown as two big meters with 5 pips each, and both
  answers on a card always say "−1 Gold" / "−1 People" so nobody has to
  remember numbers.
- The result screen shows the math line by line (base 1, trap +1, sabotage
  +2, total), and only the number of sabotages, never who.
- Your role is hidden behind a "Tap to see your role" button after the
  reveal, so a phone left on the table doesn't give it away.
- A phone that goes dark doesn't end a vote early; the host gets a
  "Continue without them" button instead.
- Left alone for now: Version B (some wrong whispers), sounds, art.

## 2026-10-06: tutorial and practice bots

- Added an 8-step hands-on tutorial ("📖 Learn to play" on the Council home),
  built the same way as Avalon's: goal first, one idea per step, you tap
  through a real-looking round (flip your role, pick the cheaper answer, pick
  a partner, vote, help, get sabotaged, choose what to say), and wrong taps
  are explained before you try again. It reuses the game's own meters, card
  and buttons so the real game looks familiar afterwards.
- Bots: Aneesh said **no "Add a bot" button in the lobby**. Bots only come
  from a practice link, `/?game=council&bots=4` (add `&name=You` to skip the
  name box). They show with a 🤖 next to their name.
