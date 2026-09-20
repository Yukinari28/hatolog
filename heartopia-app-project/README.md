# HatoLog — turning the web app into a real .exe and .apk

The web version already works as a full app in your browser:
https://claude.ai/code/artifact/b76d1d23-c2f0-4caf-8707-7ee4e5df3505

This folder builds two more copies of the *same* app: a Windows program (`.exe`) and an
Android install file (`.apk`). Actually compiling those needs an Android SDK and a Windows
build environment that aren't available where Claude runs — so instead, this uses
**GitHub Actions**, a free build service, to do the compiling for you. You don't need to
install anything or write any code. Just follow the steps below once.

## What you need

- A free GitHub account. If you don't have one, go to https://github.com/signup and create
  one (just an email and password).

## One-time setup (about 5 minutes)

1. Go to https://github.com/new
2. Name the repository anything you like (e.g. `hatolog`). Leave it **Public**
   or **Private**, either is fine. Click **Create repository**.
3. On the new repository's page, click **"uploading an existing file"** (a blue link near
   the middle of the page).
4. Open this folder on your computer and drag **all of its contents** (the `.github`
   folder, `electron` folder, `android-project` folder, `README.md`, `.gitignore`) into the
   upload box. GitHub will upload the whole folder structure for you.
5. Scroll down and click **Commit changes**.

That's it — uploading the files automatically starts the build.

## Getting your files

1. On your repository's page, click the **Actions** tab near the top.
2. You'll see a run called "Build Windows EXE and Android APK" — click it. It takes a
   few minutes (Android usually finishes before Windows).
3. Once it shows a green checkmark, scroll down to the **Artifacts** section at the
   bottom of that page. You'll see two downloads:
   - **windows-exe** — unzip it to get `HatoLog Setup.exe` (installer) and a
     portable `.exe` you can run without installing.
   - **android-apk** — unzip it to get `app-debug.apk`. Copy this to your Android phone
     and tap it to install (Android will ask you to allow installing from this source —
     that's expected for an app that isn't on the Play Store).

## Making changes later

If you ever want to update the app (say, if Claude gives you a new `index.html` with more
game data), just replace `electron/index.html` and `android-project/www/index.html` in
your GitHub repository (open the file on github.com and use the pencil/edit icon, or
delete and re-upload it), commit the change, and the Actions build will run again
automatically. Grab the new files from the Actions tab the same way.

## If a build fails

Click the red ✕ run in the Actions tab, then the failed job, to see the error log. Paste
that error back to Claude and it can adjust the project files — Android tooling and GitHub
Actions do change over time, so an occasional tweak may be needed.

## What's inside this folder

- `electron/` — a small wrapper (Electron) that shows the app in its own desktop window.
- `android-project/` — a small wrapper (Capacitor) that shows the app in its own Android
  app icon.
- `.github/workflows/build.yml` — the instructions GitHub's free build servers follow to
  produce the `.exe` and `.apk`.
- `auth-bridge.html` — a small page you deploy alongside the website version (see
  `GOOGLE-SIGNIN-SETUP.md`) that lets Google sign-in work from the `.exe`/`.apk` builds by
  opening the person's real browser instead of the app's own window.
- Both wrappers bundle a full offline copy of the app, so the Windows and Android versions
  work without an internet connection (your tracker data still only lives on that one
  device — see the app's "Backup & sync" tab to move it between devices, or set up Google
  sign-in per `GOOGLE-SIGNIN-SETUP.md` for automatic cloud sync).

## Live updates

The app can be hosted once and load into both builds from there, so a deploy
updates the website, the Windows app and the Android app together — see
`README-RAILWAY.md`.
