# Role Portrait Images

Drop portrait images here and they will automatically appear on role cards.

## File naming convention

Use the role name, lowercase, spaces replaced with hyphens:

| Role | Filename |
|------|----------|
| Merlin | `merlin.jpg` |
| Percival | `percival.jpg` |
| Loyal Servant | `loyal-servant.jpg` |
| Assassin | `assassin.jpg` |
| Morgana | `morgana.jpg` |
| Mordred | `mordred.jpg` |
| Oberon | `oberon.jpg` |
| Minion of Mordred | `minion-of-mordred.jpg` |
| Lady of the Lake | `lady-of-the-lake.jpg` |
| Cleric | `cleric.png` |
| Untrustworthy Servant | `untrustworthy-servant.png` |
| Lunatic | `lunatic.png` |
| Brute | `brute.png` |
| Trickster | `trickster.png` |
| Revealer | `revealer.png` |

## One extra step for the newer roles

Dropping a file in is **not** enough on its own any more. Roles without art skip
the `<img>` entirely and render their emoji tile instead — otherwise every one
of them fired two failed requests per render and left a hidden broken image.

So after adding a file, add that role to `ROLES_WITH_ART` near the top of
`public/client.js`:

```js
const ROLES_WITH_ART = new Set([
  'Merlin', 'Percival', 'Loyal Servant', 'Assassin',
  'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred',
  'Lunatic',            // ← add the role here once its file exists
]);
```

One line, and the portrait replaces the emoji everywhere that role appears.

## Supported formats

`.jpg`, `.jpeg`, `.png`, `.webp` — all work. If no image is found the role's
emoji/gradient art is used as fallback, so you can add images one at a time.

## Recommended size

Square crops work best. 400×400px is plenty; keep files under 200KB for fast
mobile loading (use https://squoosh.app to compress).
