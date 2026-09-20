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

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");

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
    "X-Content-Type-Options": "nosniff"
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
  let url = decodeURIComponent((req.url || "/").split("?")[0]);

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

server.listen(PORT, () => {
  console.log("HatoLog is being served on port " + PORT + " (build " + currentHash() + ")");
});
