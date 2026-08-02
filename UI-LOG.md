# UI Log

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
