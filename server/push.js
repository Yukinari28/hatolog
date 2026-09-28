// Web Push for the website build: the page hands its upcoming timer alerts
// to the server, and the server sends each one to the browser's push service
// when it's due. The browser then shows a normal Windows notification (with
// its sound) even when HatoLog's tab is asleep, minimised or closed.
//
// No dependencies: VAPID signing (ES256) and payload encryption (RFC 8291,
// aes128gcm) are done with node's own crypto.
//
// Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url) when set.
// Without them a pair is made at start-up and kept in a file beside this one;
// a redeploy then makes a new pair, and open pages re-subscribe on their own.

const crypto = require("crypto");
const https = require("https");
const fs = require("fs");
const path = require("path");

const KEY_FILE = path.join(__dirname, ".vapid.json");
const SUBS_FILE = path.join(__dirname, ".push-subs.json");
const CONTACT = "https://hatolog.up.railway.app";
const MAX_SUBS = 20000;
const MAX_ITEMS = 48;
const LATE_MS = 5 * 60 * 1000;   // an alert missed by more than this (server was down) is dropped

// Only real browser push services, so this can't be pointed at any other host.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/,
                    /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  }
  try { return JSON.parse(fs.readFileSync(KEY_FILE, "utf8")); } catch (e) {}
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));
  const keys = { pub, priv: jwk.d };
  try { fs.writeFileSync(KEY_FILE, JSON.stringify(keys)); } catch (e) {}
  console.log("Push: made a new VAPID key pair. Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to keep it across deploys.");
  return keys;
}
const KEYS = loadKeys();
const PUB_RAW = unb64u(KEYS.pub);
const SIGN_KEY = crypto.createPrivateKey({
  key: { kty: "EC", crv: "P-256", d: KEYS.priv, x: b64u(PUB_RAW.subarray(1, 33)), y: b64u(PUB_RAW.subarray(33, 65)) },
  format: "jwk"
});

function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u(Buffer.from(JSON.stringify(o)));
  const data = enc({ typ: "JWT", alg: "ES256" }) + "." +
               enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT });
  const sig = crypto.sign("sha256", Buffer.from(data), { key: SIGN_KEY, dsaEncoding: "ieee-p1363" });
  return "vapid t=" + data + "." + b64u(sig) + ", k=" + KEYS.pub;
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

function encrypt(keys, payload) {
  const uaPub = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  const asPub = ecdh.generateKeys();
  const secret = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(4096, 16); head.writeUInt8(asPub.length, 20);
  return Buffer.concat([head, asPub, body]);
}

// endpoint -> { sub, items:[{at,title,body}] }
let subs = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SUBS_FILE, "utf8")))) subs.set(k, v);
} catch (e) {}
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(SUBS_FILE, JSON.stringify(Object.fromEntries(subs)), () => {});
}, 30 * 1000).unref();

function send(sub, msg) {
  let body;
  try { body = encrypt(sub.keys, Buffer.from(JSON.stringify(msg))); } catch (e) { return; }
  const u = new URL(sub.endpoint);
  const req = https.request({
    hostname: u.hostname, path: u.pathname + u.search, method: "POST", timeout: 15000,
    headers: {
      "Authorization": vapidHeader(sub.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": body.length,
      "TTL": "600",
      "Urgency": "high"
    }
  }, (res) => {
    res.resume();
    if (res.statusCode === 404 || res.statusCode === 410) { subs.delete(sub.endpoint); dirty = true; }
    else if (res.statusCode >= 400) console.warn("Push: " + u.hostname + " answered " + res.statusCode);
  });
  req.on("timeout", () => req.destroy());
  req.on("error", () => {});
  req.end(body);
}

setInterval(() => {
  const now = Date.now();
  for (const entry of subs.values()) {
    const due = entry.items.filter((i) => i.at <= now);
    if (!due.length) continue;
    entry.items = entry.items.filter((i) => i.at > now);
    dirty = true;
    const fresh = due.filter((i) => now - i.at < LATE_MS);
    if (!fresh.length) continue;
    const msg = fresh.length === 1
      ? { title: fresh[0].title, body: fresh[0].body }
      : { title: fresh.length + " alerts", body: fresh.map((i) => i.title).join(" · ") };
    send(entry.sub, msg);
  }
}, 5000).unref();

function validSub(s) {
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1024 || !s.keys) return false;
  if (typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string") return false;
  let u;
  try { u = new URL(s.endpoint); } catch (e) { return false; }
  return u.protocol === "https:" && PUSH_HOSTS.some((rx) => rx.test(u.hostname));
}

const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

// POST /api/push/schedule  { sub, items:[{at,title,body}] } — replaces that browser's list.
function schedule(data) {
  if (!data || !validSub(data.sub)) return 400;
  const now = Date.now();
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter((i) => i && typeof i.at === "number" && i.at > now - 1000 && i.at < now + 60 * 86400000)
    .slice(0, MAX_ITEMS)
    .map((i) => ({ at: i.at, title: clip(i.title, 120), body: clip(i.body, 240) }));
  const sub = { endpoint: data.sub.endpoint, keys: { p256dh: clip(data.sub.keys.p256dh, 200), auth: clip(data.sub.keys.auth, 100) } };
  if (!items.length) subs.delete(sub.endpoint);
  else {
    if (!subs.has(sub.endpoint) && subs.size >= MAX_SUBS) return 503;
    subs.set(sub.endpoint, { sub, items });
  }
  dirty = true;
  return 200;
}

// POST /api/push/test  { sub } — one alert straight away, for the settings button.
// At most one per browser every 15 seconds, however often the button is pressed.
const lastTest = new Map();
function test(data) {
  if (!data || !validSub(data.sub)) return 400;
  const now = Date.now(), prev = lastTest.get(data.sub.endpoint) || 0;
  if (now - prev < 15000) return 429;
  if (lastTest.size > MAX_SUBS) lastTest.clear();
  lastTest.set(data.sub.endpoint, now);
  send(data.sub, { title: "HatoLog alerts are on", body: "Timer alerts will pop up here, even with HatoLog minimised." });
  return 200;
}

module.exports = { publicKey: KEYS.pub, schedule, test };
