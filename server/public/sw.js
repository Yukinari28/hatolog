// Offline cache for HatoLog.
//
// The app is one big HTML file, so there's no dependency graph to manage: cache
// that file, serve it instantly, and quietly check for a newer one in the
// background. Someone opening the app gets the copy they already have (fast, and
// works with no signal), and if a newer one arrived the page is told so it can
// offer a reload rather than yanking the page out from under them mid-timer.

var CACHE = "hh-app-v3";
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

  // The page itself: newest first. A reload asks the server (a cheap 304 when
  // nothing changed, thanks to the ETag), so an update shows up on the very
  // next reload instead of one reload late. The saved copy is only used when
  // the network is down or too slow to answer within a few seconds.
  if (isPage(req)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(APP).then(function (hit) {
          var net = fetch(APP, { cache: "no-cache" }).then(function (res) {
            if (res && res.ok) c.put(APP, res.clone());
            return res && res.ok ? res : null;
          }).catch(function () { return null; });
          var offline = function () {
            return new Response("<h1>Offline</h1><p>Open the app once with a connection and it will work offline after that.</p>",
                                { headers: { "Content-Type": "text/html; charset=utf-8" } });
          };
          if (!hit) return net.then(function (r) { return r || offline(); });
          var slow = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 4000); });
          return Promise.race([net, slow]).then(function (r) { return r || hit; });
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

// Clicking a timer notification brings HatoLog back to the front (or opens it).
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) if ("focus" in list[i]) return list[i].focus();
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});

// A timer alert pushed by HatoLog's server (website build). Shown even when
// no HatoLog tab is awake; Windows plays its notification sound with it.
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  var title = d.title || "HatoLog", now = Date.now();
  // An open HatoLog tab may already have shown this same alert; don't repeat it.
  e.waitUntil(self.registration.getNotifications().then(function (list) {
    var dup = list.some(function (n) { return n.title === title && n.data && now - n.data.at < 90000; });
    if (dup) return;
    return self.registration.showNotification(title, {
      body: d.body || "",
      icon: "icon-192.png",
      badge: "favicon-32.png",
      tag: "hh-push-" + now,
      data: { at: now },
      silent: false
    });
  }));
});
