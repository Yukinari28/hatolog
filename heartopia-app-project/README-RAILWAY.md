# Live updates via Railway

The app is one self-contained HTML file. Host that file once, point the Windows
and Android builds at it, and a deploy becomes the update — no rebuilds, no
reinstalls, no store review.

```
        you push to GitHub
                │
        ┌───────┴────────┐
        │                │
   Railway deploy   GitHub Actions
        │           (only needed when the
        │            wrapper code changes)
        ▼
  your Railway URL ──────► website visitors
        │
        ├──────────────► Windows .exe   (loads the URL)
        └──────────────► Android .apk   (loads the URL)
```

All three read the same deployment, so they update together.

## 1. Deploy the server

1. Push this repository to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. Set the service's **Root Directory** to `server`. Railway detects Node and
   runs `npm start`; there are no dependencies to install.
4. **Settings → Networking → Generate Domain.** You'll get something like
   `hatolog-production.up.railway.app`. That's your URL.

Check it: `https://<your-url>/health` returns `ok`, and `/version.json` returns
the current build hash.

## 2. Point the apps at it

Replace `REPLACE-ME.up.railway.app` with your domain in **two** files:

| File | Line |
|---|---|
| `electron/main.js` | `const APP_URL = ...` |
| `android-project/capacitor.config.json` | `server.url` |

Then rebuild both once, through the existing GitHub Actions workflow. This is
the last rebuild you need for app content.

## 3. Ship an update

Copy the new `index.html` into `server/public/`, commit, push. Railway redeploys
in under a minute and everyone has it:

- **Open tabs** poll for a new build every 15 minutes and whenever the tab is
  focused, then offer a "Reload" banner rather than interrupting a running timer.
- **Closed apps** pick it up on next launch.

`server/public/index.html` is the single source of truth: the build workflow
copies it into both wrappers automatically, so their offline fallback is never
stale.

## How offline works

The page installs a service worker (`server/public/sw.js`) that keeps a copy of
the app. After one successful load, the site, the .exe and the .apk all work with
no connection. The worker serves the cached copy immediately and checks for a
newer one in the background.

The Windows build additionally ships a bundled copy, used only if a machine has
never once reached the server.

## Things worth knowing

- **Saved data is tied to the URL.** Timers, tracker progress and settings live
  in browser storage keyed to the origin. Moving the Android build from its
  bundled files to your Railway URL starts it fresh once. Don't change the domain
  after people are using it — or if you must, do it before there's anything to
  lose.
- **Google Play** dislikes apps that load their content remotely. Fine for an APK
  you hand out directly; a problem if you ever list it.
- **Cost.** This serves one static file. It should sit inside Railway's free
  allowance, though Railway meters by uptime rather than requests, so check your
  plan's included hours.
- **The published artifact is unaffected** — it has no service worker and updates
  when it's republished, as before.
