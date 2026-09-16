# Role Portrait Images

Drop a portrait in here, add one line to `client.js`, and it appears on every
screen that shows that role.

---

## 1. Filenames

Role name, lowercased, spaces replaced with hyphens. This is derived in code
(`roleImagePath()` in `public/client.js`), so the name must match exactly.

| Role | Filename | Status |
|------|----------|--------|
| Merlin | `merlin.png` | ✅ have |
| Percival | `percival.png` | ✅ have |
| Loyal Servant | `loyal-servant.png` | ✅ have |
| Assassin | `assassin.png` | ✅ have |
| Morgana | `morgana.png` | ✅ have |
| Mordred | `mordred.png` | ✅ have |
| Oberon | `oberon.png` | ✅ have |
| Minion of Mordred | `minion-of-mordred.png` | ✅ have |
| Lady of the Lake | `lady-of-the-lake.png` | ✅ have |
| **Cleric** | `cleric.png` | ❌ needed |
| **Untrustworthy Servant** | `untrustworthy-servant.png` | ❌ needed |
| **Lunatic** | `lunatic.png` | ❌ needed |
| **Brute** | `brute.png` | ❌ needed |
| **Trickster** | `trickster.png` | ❌ needed |
| **Revealer** | `revealer.png` | ❌ needed |

`.png`, `.jpg`, `.jpeg` and `.webp` are all served. PNG is what the existing
nine use.

---

## 2. Dimensions

**Target: 390 × 485 px, PNG, 4:5 portrait (0.8 ratio).**

That matches the existing nine, which range from 375×480 to 401×486 — they are
*not* square, despite what an earlier version of this file claimed.

**But you do not need to hit this exactly.** Generate at whatever the image
model produces natively — 1024×1280 is ideal, 1024×1024 is fine — and the
resize/crop/compress step is mechanical and can be done on arrival. What
*cannot* be fixed afterwards is the composition, which is section 3.

If you do want to prepare them yourself: 4:5 aspect, longest edge ~485px,
under ~350KB (the existing files are 309–358KB).

---

## 3. Composition — the part that actually matters

Every portrait is **cropped to a circle**, and the two places it appears crop
by different amounts. The role-picker tile is the tighter of the two:

| Where | What survives of your image |
|-------|------------------------------|
| Role picker tile (84px) | centre **86% of width × 68% of height**, then circle-masked |
| Role reveal / tooltip (90px, 44px) | full width × centre **79% of height**, then circle-masked |

So in the picker, roughly **the top 16% and the bottom 16% of your image are
thrown away**, and then the corners are cut off by the circle.

Practical rules:

- **Head-and-shoulders, subject centred.** Not full-body — a full-body figure
  becomes an unrecognisable torso in an 84px circle.
- **Leave dead space at the top and bottom.** Anything in the top or bottom
  sixth of the frame will not be seen in the picker.
- **Keep the face inside a centred circle about 70% of the frame width.**
  That's the region guaranteed to survive both crops.
- **No text, no borders, no frames, no drop shadows.** They get sliced by the
  circle mask and look like a mistake.
- **Dark, low-contrast background.** It sits on near-black `#0d0d18` behind a
  gold ring; a bright or white background reads as a glowing disc.

---

## 4. Prompt block for the image model

Paste this above whatever you say about the individual character, alongside
the existing portraits as style reference:

> Painted fantasy character portrait in the same style as the reference images.
> Head-and-shoulders composition, subject centred and facing the viewer.
> Vertical 4:5 portrait aspect ratio. Dark, muted, desaturated background —
> deep shadow, no bright or white areas. Leave generous empty space above the
> head and below the shoulders, because the image will be cropped to a circle
> and the top and bottom sixth will be cut off. Keep the entire face well
> within the centre of the frame. No text, no lettering, no border, no frame,
> no watermark, no drop shadow.

Then one line per character:

| Role | Character direction | Palette in-app |
|------|--------------------|----------------|
| Cleric | A devout healer or priest of the realm; robes, a holy symbol, calm and certain. Good. | deep teal `#004d40 → #00695c` |
| Untrustworthy Servant | A loyal knight who is being watched; honest face, uneasy eyes, something hunted about them. Good, but marked. | olive green `#33691e → #558b2f` |
| Lunatic | A crazed, masked figure compelled to destroy; theatrical, unhinged, a broken grin. Evil. | purple→magenta `#4a148c → #880e4f` |
| Brute | A heavy armoured thug with an axe; brutal early, spent later. Evil. | brown `#3e2723 → #5d4037` |
| Trickster | A smiling deceiver, jester-like, a face that reads as innocent. Evil disguised as good. | indigo→violet `#1a237e → #4a148c` |
| Revealer | A figure wreathed in fire who will not stay hidden; defiant, exposed, burning. Evil. | ember orange `#bf360c → #e65100` |

The palette column is the gradient the app already uses behind that role's
fallback tile — matching it makes the portrait sit naturally where the emoji
tile used to be.

---

## 5. The one code change

Dropping the file in is **not** sufficient on its own. Roles without art skip
the `<img>` entirely and render an emoji tile instead — otherwise each one
fired two failed requests per render and left a hidden broken image.

So after adding a file, add that role to `ROLES_WITH_ART` near the top of
`public/client.js`:

```js
const ROLES_WITH_ART = new Set([
  'Merlin', 'Percival', 'Loyal Servant', 'Assassin',
  'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred',
  'Lunatic',            // ← add the role here once its file exists
]);
```

One line per role, and the portrait replaces the emoji everywhere that role
appears: the picker grid, the role reveal, the tooltips, and the end-of-game
reveal.

---

## 6. Visual reference

`_safe-zone-reference.jpg` in this folder shows the two crops drawn over the
existing Merlin portrait:

- **red bands** — discarded entirely in the role picker (top and bottom ~16%)
- **yellow box + circle** — what survives in the role picker, the tighter crop
- **blue box + circle** — what survives in the role reveal

Note that Merlin's decorative gold oval frame *is* sliced by the crop — it
survives only because at 84px it reads as an inner glow rather than a frame.
Don't rely on that.

(The leading underscore keeps this file out of the role-name namespace, so it
can never be mistaken for a portrait.)
