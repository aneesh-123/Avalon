# Game Night for iPhone

The website's games, packaged as an iPhone app with [Capacitor](https://capacitorjs.com).
The app carries its own copy of `public/` (so it opens instantly) plus an
app-only layer in `mobile/app/` (home screen, share sheet, haptics, keep-awake,
"connecting" banner). Games still run on the live server.

No Mac is needed: `codemagic.yaml` at the repo root builds, signs and uploads
to TestFlight on Codemagic's Macs.

## Commands (run inside `mobile/`)

```bash
npm ci
npm run build:web      # copy public/ into www/ for the app
npm run sync           # build:web + copy into the Xcode project
npm run preview        # build:web + serve www/ on :5173 for a browser preview
```

`GAME_SERVER_URL` picks the server the app talks to (default: the
`LIVE_SERVER` in `scripts/build-web.js`). For a local preview, run the server
with `APP_DEV_ORIGINS=http://localhost:5173` and build with
`GAME_SERVER_URL=http://localhost:3000`.

## How the website and the app share code

- `public/app-config.js` holds `GN_SERVER` / `GN_PUBLIC`. On the website both
  mean "this page's own address"; the app build overwrites the file.
- `server.js` allows cross-origin connections only from the app's own origin
  (`capacitor://localhost`).
- A game appears on the app's home screen through its `#pick-…` button in the
  website's picker. Games still being built show as "Coming soon" until that
  button exists and isn't hidden (see `GAMES` in `app/app.js`).

## Before the App Store

- Bundle id `com.gamenight.partygames` (in `capacitor.config.json`,
  the Xcode project and `codemagic.yaml`) must match the one registered in
  App Store Connect.
- The live server must stay awake (Render's paid plan), or the first player
  of the day waits about a minute.
