# Trivia Night — UI log

Decisions from building and polishing Trivia Night. Append here (not the
Avalon or Imposter logs) when a UI question is settled, including things
deliberately rejected.

## 2026-09-29 — first build

- **Theme follows Avalon, not Imposter.** Gold `#c9a96e` on near-black, navy
  card gradients, Cinzel headings. Each team's color is an accent only (crest
  ring, name, left border on the scoreboard), never a background.
- **Two modes, picked first on the create screen.** "With a host" (a quizmaster
  reads aloud and runs the buzzer) and "No host" (multiple choice on every
  phone, app keeps score). Mode is the first choice because it changes
  everything else on the screen.
- **The quizmaster does not play for a team** — they see every answer. Taking
  over hosting mid-game removes you from your team for the same reason.
- **Teams: one phone per team or a phone each.** Joining is QR/link then name,
  then pick or start a team. Anyone on a team can buzz or answer for it; the
  first buzz or first answer from the team is the team's.
- **Buzzers stay locked until the host taps "Open buzzers".** Tapping early
  shakes the button, shows "Too early!" and ignores taps on that phone for one
  second — a false-start penalty, enforced on the phone only.
- **Buzz on pointerdown, not click.** Click fires on release, which is slower
  than most buzzer races are decided by.
- **Wrong answer reopens the buzzers straight away** for the teams that are
  still in; the host does not have to re-read. When every team has missed,
  the answer is revealed automatically.
- **Themed rounds: the round count follows the picked categories**, so every
  category chosen actually comes up. The summary warns if the host lowers the
  rounds below the number of categories.
- **Host mode questions can be hidden from phones** ("Show questions on
  players' phones", on by default) for a pure-buzzer game.
- **No penalty for wrong answers** in either mode — it is a party game.
- Rejected for now: sounds (autoplay rules make them unreliable on iOS), a
  separate TV/big-screen view.
