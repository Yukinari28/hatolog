// Serves the HatoLog app. No dependencies on purpose — Railway's Node
// image and this one file are the whole deployment.
//
// Everything in public/ is served as-is. The two things that matter beyond that:
//
//   * index.html is sent with no-cache, so a browser (and the service worker)
//     always asks whether there's a newer one rather than sitting on a copy for
//     a week. The file is ~2.5MB but gzips to a fraction of that, so this is
//     cheap; assets that never change could be cached hard, but there aren't any
//     — the app is a single file with its images inlined.
//   * /version.json reports a hash of the current index.html, which is how the
//     app decides whether the copy it's running is stale.
//
// Basic hardening below (rate limiting, security headers, method/path
// sanity): this is a static-file server sitting behind Railway's own network
// layer, not a substitute for it. It won't stop a large distributed flood by
// itself — nothing this small can — but it does stop a single bad actor (or
// a naive bot/scanner) from hammering the process, and it closes off the
// obvious low-effort attack surface (arbitrary methods, path traversal,
// unbounded memory growth from the mitigations themselves).

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");

// ---- rate limiting -------------------------------------------------------
// Fixed-window counter per client IP: cheap (one Map lookup per request), no
// per-entry timers, and the whole window resets at once rather than growing
// forever. Generous enough for normal browsing (a page load fetches this one
// HTML file plus a handful of small requests) while still cutting off a
// single client hammering the server.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 240; // per IP, per window
const RATE_LIMIT_MAX_CLIENTS = 50000; // hard cap so a flood of spoofed/unique
                                       // IPs can't grow this map without bound
let rateLimitMap = new Map();
let rateLimitWindowStart = Date.now();

function clientIp(req) {
  // Railway terminates TLS and proxies to this process, so the real client
  // address is the first hop in X-Forwarded-For, not the socket's peer.
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  if (now - rateLimitWindowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap = new Map();
    rateLimitWindowStart = now;
  }
  if (rateLimitMap.size >= RATE_LIMIT_MAX_CLIENTS && !rateLimitMap.has(ip)) {
    // Under a distributed flood of unique IPs, holding the line here (rather
    // than growing unbounded) matters more than tracking every last one.
    return true;
  }
  const count = (rateLimitMap.get(ip) || 0) + 1;
  rateLimitMap.set(ip, count);
  return count > RATE_LIMIT_MAX;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

// Hash of index.html, recomputed whenever the file changes on disk so a redeploy
// doesn't need a restart to be noticed.
let indexHash = "";
let indexMtime = 0;
function currentHash() {
  const file = path.join(ROOT, "index.html");
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs !== indexMtime) {
      indexMtime = st.mtimeMs;
      indexHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
      gzCache.clear();
    }
  } catch (e) {
    indexHash = "";
  }
  return indexHash;
}

// Gzipping a 2.5MB page on every request is the one thing here that would cost
// real CPU, and the answer never changes between deploys — so it's compressed
// once and the result kept. Keyed by file path; cleared when the file changes.
const gzCache = new Map();

function send(req, res, status, body, type, cache, key) {
  const headers = {
    "Content-Type": type,
    "Cache-Control": cache,
    // The desktop and Android builds fetch this from their own origin.
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    // Clickjacking protection: the app has no reason to be framed by another
    // site. "self" rather than "none" only in case it's ever embedded on the
    // same origin (e.g. a future in-app webview pointed at its own domain).
    "Content-Security-Policy": "frame-ancestors 'self'",
    "X-Frame-Options": "SAMEORIGIN",
    // Nothing here needs the browser handing out location/camera/mic/etc.
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Railway serves this over HTTPS only; tells browsers to remember that
    // for this host instead of ever silently trying plain HTTP.
    "Strict-Transport-Security": "max-age=15552000; includeSubDomains"
  };
  const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "") &&
                    /text|json|javascript|svg/.test(type);
  if (wantsGzip && Buffer.isBuffer(body) && body.length > 1024) {
    const hit = key ? gzCache.get(key) : null;
    if (hit) {
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      res.writeHead(status, headers);
      return res.end(hit);
    }
    zlib.gzip(body, (err, gz) => {
      if (err) { res.writeHead(status, headers); res.end(body); return; }
      if (key) gzCache.set(key, gz);
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      res.writeHead(status, headers);
      res.end(gz);
    });
    return;
  }
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  // Nothing here is more than a few KB or needs a body, and every real
  // request is a GET — HEAD is let through for uptime checks.
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(req, res, 405, Buffer.from("Method not allowed"), "text/plain; charset=utf-8", "no-store");
  }

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    const headers = { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" };
    res.writeHead(429, headers);
    return res.end("Too many requests — try again in a moment.");
  }

  let url;
  try {
    url = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (e) {
    // A malformed %-escape in the URL — not a path worth spending any more
    // effort resolving.
    return send(req, res, 400, Buffer.from("Bad request"), "text/plain; charset=utf-8", "no-store");
  }
  if (url.length > 512) {
    return send(req, res, 414, Buffer.from("URI too long"), "text/plain; charset=utf-8", "no-store");
  }

  if (url === "/health") {
    return send(req, res, 200, Buffer.from("ok"), "text/plain; charset=utf-8", "no-store");
  }

  if (url === "/version.json") {
    const body = Buffer.from(JSON.stringify({ hash: currentHash(), at: Date.now() }));
    return send(req, res, 200, body, TYPES[".json"], "no-store");
  }

  if (url === "/" || url === "") url = "/index.html";

  // Nothing is allowed to climb out of public/.
  const file = path.join(ROOT, path.normalize(url).replace(/^(\.\.[\/\\])+/, ""));
  if (!file.startsWith(ROOT)) {
    return send(req, res, 403, Buffer.from("Forbidden"), "text/plain; charset=utf-8", "no-store");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      // Anything unrecognised falls through to the app itself, so a stray path
      // or a refresh on a deep link still lands somewhere useful.
      return fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
        if (e2) return send(req, res, 404, Buffer.from("Not found"), "text/plain; charset=utf-8", "no-store");
        send(req, res, 200, html, TYPES[".html"], "no-cache", "index");
      });
    }
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] || "application/octet-stream";
    // index.html and the service worker must never be held in a cache, or an
    // update would take days to reach anyone.
    const cache = (ext === ".html" || path.basename(file) === "sw.js")
      ? "no-cache"
      : "public, max-age=604800";
    send(req, res, 200, data, type, cache, file + ":" + currentHash());
  });
});

// Slowloris-style attacks work by opening connections and trickling bytes in
// just fast enough to never time out on Node's (fairly generous) defaults,
// tying up sockets for as long as possible. Nothing legitimate here — a
// static file server with no uploads — ever needs anywhere near this long.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 8_000;
server.maxHeadersCount = 50;

server.listen(PORT, () => {
  console.log("HatoLog is being served on port " + PORT + " (build " + currentHash() + ")");
});
