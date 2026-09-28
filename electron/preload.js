const { contextBridge, ipcRenderer } = require("electron");

// Exposes a small, safe bridge the app's cloud-sync code uses to (1) open the
// Google sign-in page in the person's real browser, since Google blocks its
// sign-in popup from running inside this app's own window, and (2) receive the
// sign-in result back once the browser hands control to this app via a
// "hatolog://" link.
contextBridge.exposeInMainWorld("hhElectron", {
  openExternalSignIn: function (url) {
    ipcRenderer.send("hh-open-external", url);
  },
  // Opens a community link in the person's real browser. Without this a link
  // click would navigate the app's own window away from the app.
  openExternal: function (url) {
    ipcRenderer.send("hh-open-external", url);
  },
  // Hands the main process every upcoming crop-ready and weed-wave instant, so
  // Windows raises them itself even if this window has been closed to the tray.
  scheduleAlerts: function (items) {
    ipcRenderer.send("hh-schedule-alerts", items);
  },
  // The tray raises alerts silently and asks the page to play HatoLog's tune.
  onPlayChime: function (callback) {
    ipcRenderer.send("hh-chime-ready");
    ipcRenderer.on("hh-play-chime", function () { callback(); });
  },
  onAuthCallback: function (callback) {
    ipcRenderer.on("hh-auth-callback", function (event, data) {
      callback(data);
    });
  }
});
