# Secret Hitler — UI log

Decisions from building and polishing the Secret Hitler game mode. Append here
(not the other games' logs) when a UI question is settled, including things
deliberately rejected.

## 2026-09-29 — first build

- **Theme follows Avalon.** Gold `#c9a96e` on near-black, navy cards, Cinzel
  headings. The parties get one accent each (blue `#7fb0e8`, red `#e8806c`),
  used for borders and text, never as a full background.
- **All names in one file.** `public/secret-theme.js` holds the game's name,
  party and role names, offices, the Ja/Nein words and power names, so the
  mode can be renamed for the App Store without touching game code. Icons are
  neutral (dove, skull, theatre mask) — no historical imagery.
- **Join by QR or invite link**, same as Avalon. The host lines up the lobby
  list with the real seating (up/down arrows, or shuffle), because the
  presidency passes around the table in that order.
- **One game screen that changes with the phase**: policy tracks and the
  election tracker on top, then what just happened, then the action card for
  this phone, then the table and a log. Only the phone that has to act gets
  buttons; everyone else sees who they are waiting on.
- **Role card pops up once when roles are dealt**; "My role" reopens it.
  Fascists see their teammates' icons beside their names in the table list for
  the whole game; an investigator sees the party they found.
- **Two taps for anything secret or irreversible**: pick a card or a player,
  then confirm. Execution also asks "This can't be undone".
- **Votes can be changed until the last one is in**, then all are revealed as
  chips with each name.
- **Dead players** are struck through and told to stay quiet; they get no
  buttons.
- **Game over shows every role**, and "Play again" keeps the same seats.
- Rejected for now: a shared TV board, sounds, timers on discussion.
