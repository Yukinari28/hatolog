// Offline cache for HatoLog.
//
// The app is one big HTML file, so there's no dependency graph to manage: cache
// that file, serve it instantly, and quietly check for a newer one in the
// background. Someone opening the app gets the copy they already have (fast, and
// works with no signal), and if a newer one arrived the page is told so it can
// offer a reload rather than yanking the page out from under them mid-timer.

var CACHE = "hh-app-v2";
var APP = "./index.html";

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.add(new Request(APP, { cache: "reload" }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isPage(req) {
  return req.mode === "navigate" ||
         (req.method === "GET" && (req.headers.get("accept") || "").indexOf("text/html") !== -1);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  // Version checks must always go to the network, or the app would be asking a
  // cache whether the cache is stale.
  if (req.url.indexOf("/version.json") !== -1) return;
  // Live feeds (banners, announcements, redeem codes) are never answered from
  // the cache — the server already caches them sensibly on its side.
  if (req.url.indexOf("/api/") !== -1) return;

  // Data files: network first so updates show up, the cached copy only when
  // offline. (Cache-first here used to pin the very first copy forever.)
  if (/\.json(\?|$)/.test(req.url)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return fetch(req, { cache: "no-cache" }).then(function (res) {
          if (res && res.ok && res.type === "basic") c.put(req, res.clone());
          return res;
        }).catch(function () {
          return c.match(req).then(function (hit) { return hit || Response.error(); });
        });
      })
    );
    return;
  }

  if (isPage(req)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(APP).then(function (hit) {
          var net = fetch(APP, { cache: "no-cache" }).then(function (res) {
            if (res && res.ok) {
              c.put(APP, res.clone());
              if (hit) announceIfChanged(hit, res.clone());
            }
            return res;
          }).catch(function () { return null; });
          // A cached copy wins on speed; with nothing cached we have to wait.
          return hit || net.then(function (r) {
            return r || new Response("<h1>Offline</h1><p>Open the app once with a connection and it will work offline after that.</p>",
                                     { headers: { "Content-Type": "text/html; charset=utf-8" } });
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res && res.ok && res.type === "basic") c.put(req, res.clone());
          return res;
        });
      });
    })
  );
});

// Compares what we just served against what the network returned, and tells any
// open page when the two differ.
function announceIfChanged(oldRes, newRes) {
  Promise.all([oldRes.text(), newRes.text()]).then(function (both) {
    if (both[0].length === both[1].length && both[0] === both[1]) return;
    self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
      cs.forEach(function (c) { c.postMessage({ type: "hh-update-ready" }); });
    });
  }).catch(function () {});
}

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "hh-skip-waiting") self.skipWaiting();
});
