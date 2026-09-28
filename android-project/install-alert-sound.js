#!/usr/bin/env node
// Puts HatoLog's alert tune into the APK as res/raw/heartopia.wav, and raises
// the build number to 2 so the app knows this APK has it (the page then uses
// a notification channel that rings with the tune instead of the phone's
// default sound).
//
// Like the other install scripts, this runs AFTER `npx cap add android` and
// before the Gradle build; the GitHub Actions workflow calls it.

const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "resources", "heartopia.wav");
const rawDir = path.join(__dirname, "android", "app", "src", "main", "res", "raw");
const gradle = path.join(__dirname, "android", "app", "build.gradle");

if (!fs.existsSync(src)) { console.error("resources/heartopia.wav not found."); process.exit(1); }
if (!fs.existsSync(gradle)) { console.error("android/app/build.gradle not found — run `npx cap add android` first."); process.exit(1); }

fs.mkdirSync(rawDir, { recursive: true });
fs.copyFileSync(src, path.join(rawDir, "heartopia.wav"));

let g = fs.readFileSync(gradle, "utf8");
if (!/versionCode\s+\d+/.test(g)) { console.error("versionCode not found in build.gradle."); process.exit(1); }
g = g.replace(/versionCode\s+\d+/, "versionCode 2");
fs.writeFileSync(gradle, g);
console.log("Alert tune installed; versionCode set to 2.");
