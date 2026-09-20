# Turning on "Sign in with Google" for HatoLog

The app now has optional Google sign-in and cloud sync built in — it's just switched off until you connect it to a free Google service called **Firebase**. This lets any Heartopia player sign in with their own Google account and have their tracker/mastery data follow them between devices, instead of everyone sharing one local save.

**Important scope note first:** this only works once the app is hosted on a real website you control (Step 6 below gives you one for free). It will **not** work on the copy currently living inside the Claude artifact preview — Claude's preview sandbox blocks the scripts Google sign-in needs to run, by design, for every artifact. Once you deploy the files yourself with Firebase Hosting, sign-in works normally in any browser — and, with a bit more setup covered near the end of this guide, in the Windows (.exe) and Android (.apk) builds too, via a "sign in in your real browser, then jump back to the app" flow.

## What you'll end up with

- A free Firebase project (a small backend Google provides at no cost for this scale of app)
- A "Sign in with Google" button that appears in the app's header
- Each signed-in player's tracker/mastery data stored under their own account, synced automatically as they use the app
- A real public web address for the app (e.g. `https://your-project.web.app`)

Takes about 15–20 minutes the first time, no coding required — just following steps and copy-pasting a few values.

## Step 1: Create a Firebase project

1. Go to https://console.firebase.google.com and sign in with any Google account.
2. Click **Add project** (or **Create a project**).
3. Name it anything (e.g. `hatolog`). Click through the prompts — you can decline Google Analytics, it's not needed here.
4. Wait for the project to finish provisioning, then click **Continue**.

## Step 2: Enable Google as a sign-in method

1. In the left sidebar, go to **Build → Authentication**.
2. Click **Get started**.
3. Under the **Sign-in method** tab, click **Google** in the provider list, toggle it **Enable**, pick a support email (your own is fine), and **Save**.

## Step 3: Create the database (Firestore)

1. In the left sidebar, go to **Build → Firestore Database**.
2. Click **Create database**. Choose any nearby region. Start in **production mode**.
3. Once it's created, go to the **Rules** tab and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

4. Click **Publish**. This makes sure each player can only read and write their *own* saved data — nobody can see or overwrite anyone else's.

## Step 4: Get your web app config

1. Click the gear icon near **Project Overview** (top left) → **Project settings**.
2. Scroll to **Your apps**, click the **</>** (web) icon to register a new web app.
3. Give it any nickname (e.g. `web`), skip Firebase Hosting setup at this point if asked, click **Register app**.
4. You'll see a code block with a `firebaseConfig` object like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "hatolog.firebaseapp.com",
  projectId: "hatolog",
  storageBucket: "hatolog.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

Keep this tab open — you'll copy these six values in the next step.

## Step 5: Paste the config into the app

1. Open `index.html` (the app file) in any text editor.
2. Search for `FIREBASE_CONFIG` — you'll find this near the bottom of the file:

```js
var FIREBASE_CONFIG = {
  apiKey: "", authDomain: "", projectId: "",
  storageBucket: "", messagingSenderId: "", appId: ""
};
```

3. Fill in the six empty strings with the matching values from Step 4, e.g.:

```js
var FIREBASE_CONFIG = {
  apiKey: "AIzaSy...", authDomain: "hatolog.firebaseapp.com", projectId: "hatolog",
  storageBucket: "hatolog.appspot.com", messagingSenderId: "123456789", appId: "1:123456789:web:abcdef123456"
};
```

4. There's a second, much smaller file in the same folder called `auth-bridge.html` — it has the exact same `FIREBASE_CONFIG` block near the top. Paste the same six values in there too (this file is what makes sign-in work from the Windows/Android builds later — see Step 8).
5. Save both files. That's it for the website itself — the sign-in button will now appear automatically once `index.html` is served over the web (not opened directly from your computer as a local file, and not the current Claude preview link — see Step 6).

## Step 6: Put it on the web with Firebase Hosting

You need `index.html` served from a real `https://` address for Google sign-in to work at all (Google blocks it on `file://` pages and on Claude's artifact preview).

1. Install Node.js if you don't already have it: https://nodejs.org (any recent version).
2. Open a terminal / command prompt and run:
   ```
   npm install -g firebase-tools
   firebase login
   ```
   (This opens a browser window to sign in with the same Google account.)
3. In a folder containing your finished `index.html` **and** `auth-bridge.html`, run:
   ```
   firebase init hosting
   ```
   - Pick **Use an existing project** and select the project you made in Step 1.
   - When asked for your "public directory", type `.` (a single period) so both files in the current folder get deployed.
   - Answer **No** to "configure as a single-page app".
   - Answer **No** to overwriting `index.html` if it asks (you want to keep your file).
4. Deploy:
   ```
   firebase deploy
   ```
5. It prints a **Hosting URL** like `https://hatolog.web.app` — that's your app's real, permanent address, and `https://hatolog.web.app/auth-bridge.html` is the sign-in bridge page you'll need in Step 8. Share the main link with other players; anyone who opens it can sign in with their own Google account and get their own saved data.

Whenever you update `index.html` later (new recipes, fixes, etc.), just run `firebase deploy` again from that folder to push the update live.

## Making Google sign-in work in the Windows (.exe) and Android (.apk) builds

Those two builds show the app inside their own embedded window, and Google refuses to run its sign-in popup inside an embedded window at all — that's a Google security policy, not something a setting can turn off. So instead, the app now opens `auth-bridge.html` (Step 6) in the person's **real** browser (their normal Chrome/Edge, or Chrome Custom Tabs on Android), lets them sign in there, and gets handed back to the app automatically through a link that starts with `hatolog://`. This is already wired up in the project — you just need to point it at your deployed bridge page.

7. In the `heartopia-app-project` folder you downloaded earlier, open **both** `electron/index.html` and `android-project/www/index.html` in a text editor. In each one, find `AUTH_BRIDGE_URL` (right under `FIREBASE_CONFIG`, same spot as before) and set it to your deployed bridge page from Step 6, e.g.:
   ```js
   var AUTH_BRIDGE_URL = "https://hatolog.web.app/auth-bridge.html";
   ```
   Also make sure `FIREBASE_CONFIG` in both of those files matches the one you filled in on your main `index.html` — easiest way is to just replace each file's entire contents with your finished `index.html`, then add this one `AUTH_BRIDGE_URL` line.
8. Save both files, then re-upload the whole `heartopia-app-project` folder to your GitHub repository (same as the first time — see this project's own `README.md` for the exact steps) and let the Actions build run again. Everything else — registering the `hatolog://` link on Windows, and the deep link on Android — happens automatically as part of that build; there's nothing else to configure.
9. Grab the new `.exe`/`.apk` from the Actions tab once the build finishes (green checkmark → Artifacts). Tapping "Sign in with Google" in either build now opens your phone's or PC's normal browser to `auth-bridge.html`, and finishing sign-in there jumps straight back into the app, already signed in.

**Heads up on reliability:** this pattern (external browser → custom link back to the app) is the standard, Google-approved way to do this, but it does depend on the OS correctly routing the `hatolog://` link back to your installed app — this works out of the box on Android, and on Windows once the app has actually been *installed* via the built `.exe` installer (not just run directly). If a build ever behaves oddly here after a Windows/Android tooling update, that's the first thing to check.

## Troubleshooting

- **No sign-in button appears:** double check the six `FIREBASE_CONFIG` values are filled in exactly as copied (no extra quotes or spaces), and that you're viewing the file over `https://` (Firebase Hosting), not opening it directly from disk.
- **"Sign-in didn't go through" alert (website):** usually means a popup blocker stopped it — allow popups for your Hosting domain and try again.
- **Windows/Android button says sign-in "isn't finished setting up yet":** `AUTH_BRIDGE_URL` is still empty in that build's `index.html` — see Step 7.
- **Browser opens for sign-in but never returns to the Windows app:** the `.exe` needs to have been installed (via the installer GitHub Actions builds), not run as a loose, unpackaged file — Windows only registers the `hatolog://` link during install.
- **Data doesn't seem to sync between two devices:** make sure both are signed in with the *same* Google account, and give it a couple of seconds after making a change — saves are batched briefly before uploading.
