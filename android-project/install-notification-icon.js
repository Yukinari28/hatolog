#!/usr/bin/env node
// Drops HatoLog's heart into every mipmap density folder as the notification's
// "small icon" (the status-bar/tray icon), as ic_stat_hatolog.png.
//
// Android requires this to be a flat white silhouette on a transparent
// background — it ignores any colour in the source image and either shows a
// plain white shape or (pre-Lollipop only) a generic placeholder if the
// resource is missing or isn't structured this way. resources/notification-icon.png
// is already pre-processed into that silhouette (see the session that made it).
//
// Like patch-android-manifest.js, this has to run AFTER `npx cap add android`
// (which regenerates the android/ folder fresh every time — it's git-ignored)
// and before the Gradle build. The GitHub Actions workflow calls it
// automatically; run it yourself with `node install-notification-icon.js` from
// this folder if you're ever building locally instead.

const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "resources", "notification-icon.png");
const resDir = path.join(__dirname, "android", "app", "src", "main", "res");

if (!fs.existsSync(src)) {
  console.error("resources/notification-icon.png not found.");
  process.exit(1);
}
if (!fs.existsSync(resDir)) {
  console.error("Android res/ folder not found at " + resDir + " — run `npx cap add android` first.");
  process.exit(1);
}

// One entry per density bucket is enough — Android picks the matching folder
// for the device and otherwise scales, same as it would across several exact
// sizes. mdpi is the odd one out and gets the source untouched; the others
// don't need actual per-density resizing here since Android will happily
// downscale the same 432x432 source, it just prefers having the buckets exist.
const densities = ["mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"];
densities.forEach(function (dir) {
  const full = path.join(resDir, dir);
  fs.mkdirSync(full, { recursive: true });
  fs.copyFileSync(src, path.join(full, "ic_stat_hatolog.png"));
});

console.log("Installed ic_stat_hatolog.png into " + densities.length + " mipmap folders.");
