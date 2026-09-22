#!/usr/bin/env node
// Adds the "hatolog://authcallback" deep-link intent-filter to the app's
// main Activity, plus the permissions the crop/weed alerts need, so Android can hand control back to this app once someone
// finishes signing in with Google in their real browser (Chrome Custom Tabs).
//
// This has to run AFTER `npx cap add android` (which generates the android/
// folder fresh every time — it's git-ignored, see .gitignore) and before the
// Gradle build. The GitHub Actions workflow calls this automatically; run it
// yourself with `node patch-android-manifest.js` from this folder if you're
// ever building locally instead.

const fs = require("fs");
const path = require("path");

const manifestPath = path.join(__dirname, "android", "app", "src", "main", "AndroidManifest.xml");

if (!fs.existsSync(manifestPath)) {
  console.error("AndroidManifest.xml not found at " + manifestPath + " — run `npx cap add android` first.");
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, "utf8");

// Alerts have to survive the app being backgrounded or closed, which on modern
// Android means two things: POST_NOTIFICATIONS (a runtime permission from 13 up,
// which the app asks for the first time you turn alerts on), and the exact-alarm
// permissions — without those, Doze can hold a crop-ready alert back by minutes.
const PERMISSIONS = [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.USE_EXACT_ALARM",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  // Lets the app ask the OS directly (one system dialog, no trip to Settings)
  // to stop battery-optimizing it — without this, many phones (Xiaomi, Samsung,
  // Oppo/Realme and friends especially) silently kill the process in the
  // background and cancelled-looking alerts never fire while the app is closed.
  "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
];

function addPermissions(doc) {
  const anchor = "<application";
  const idx = doc.indexOf(anchor);
  if (idx === -1) return doc;
  let block = "";
  PERMISSIONS.forEach(function (name) {
    if (doc.indexOf(name) === -1) {
      block += "    <uses-permission android:name=\"" + name + "\" />\n";
    }
  });
  if (!block) return doc;
  console.log("Added " + block.trim().split("\n").length + " notification permission(s) to AndroidManifest.xml.");
  return doc.slice(0, idx) + block + "\n    " + doc.slice(idx);
}

if (xml.indexOf("hatolog") !== -1) {
  console.log("AndroidManifest.xml already has the hatolog:// intent-filter.");
  const withPerms = addPermissions(xml);
  if (withPerms !== xml) fs.writeFileSync(manifestPath, withPerms);
  process.exit(0);
}

const intentFilter =
  "        <intent-filter>\n" +
  "            <action android:name=\"android.intent.action.VIEW\" />\n" +
  "            <category android:name=\"android.intent.category.DEFAULT\" />\n" +
  "            <category android:name=\"android.intent.category.BROWSABLE\" />\n" +
  "            <data android:scheme=\"hatolog\" android:host=\"authcallback\" />\n" +
  "        </intent-filter>\n";

// Capacitor's default template has exactly one <activity> (MainActivity) — insert
// the intent-filter right before its closing tag.
const closeTag = "</activity>";
const idx = xml.indexOf(closeTag);
if (idx === -1) {
  console.error("Couldn't find </activity> in AndroidManifest.xml — the deep link was not added. " +
    "If this project's manifest structure has changed, this script may need updating.");
  process.exit(1);
}

xml = xml.slice(0, idx) + intentFilter + xml.slice(idx);
xml = addPermissions(xml);
fs.writeFileSync(manifestPath, xml);
console.log("Added the hatolog:// deep-link intent-filter to AndroidManifest.xml.");
