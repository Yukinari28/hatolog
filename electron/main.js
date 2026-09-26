const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, shell } = require("electron");
const path = require("path");

const PROTOCOL = "hatolog";

// Where the app itself lives. Set this to your Railway URL (no trailing slash)
// and the installed .exe picks up every deploy on its next launch — no rebuild,
// no reinstall. Leave it empty and the app runs the copy bundled beside this
// file, exactly as it did before.
//
// It can also be overridden at runtime, which is handy for testing a staging
// deploy without building anything:  set HH_APP_URL in the environment.
const APP_URL = process.env.HH_APP_URL || "https://hatolog.up.railway.app";

// A window that has loaded the site once keeps working offline, because the page
// installs a service worker that holds on to a copy. The bundled file is only
// there for the very first run on a machine that has never reached the site.
function remoteReachable() {
  if (!APP_URL || APP_URL.indexOf("REPLACE-ME") !== -1) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (ok) => { clearTimeout(timer); resolve(ok); };
    const timer = setTimeout(() => done(false), 4000);
    try {
      const req = require("https").request(APP_URL + "/health", { method: "GET", timeout: 4000 }, (res) => {
        res.resume();
        done(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on("error", () => done(false));
      req.on("timeout", () => { req.destroy(); done(false); });
      req.end();
    } catch (e) { done(false); }
  });
}

// Only one running copy of the app — needed so a second launch triggered by the
// "hatolog://" sign-in link hands its URL to the window that's already open
// instead of opening a confusing second window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let quitting = false;
// Every pending crop/weed alert the app has been handed, as Node timers. They're
// replaced wholesale each time the page sends a new schedule, so a collected or
// cancelled plot can't leave a stale alert behind.
let alertTimers = [];
let pendingAuthUrl = extractAuthUrl(process.argv);
// Launched by Windows at sign-in (see setLoginItemSettings below): stay in the
// tray instead of popping a window in someone's face every time they log in.
const startHidden = process.argv.includes("--hidden");
let toldAboutTray = false;
const ICON_PATH = path.join(__dirname, "build", "icon.ico");

function extractAuthUrl(argv) {
  const hit = argv.find((a) => typeof a === "string" && a.startsWith(PROTOCOL + "://"));
  return hit || null;
}

function deliverPendingAuthUrl() {
  if (!pendingAuthUrl || !mainWindow) return;
  try {
    const parsed = new URL(pendingAuthUrl);
    const idToken = parsed.searchParams.get("idToken");
    if (idToken) {
      mainWindow.webContents.send("hh-auth-callback", { idToken });
    }
  } catch (e) {
    console.warn("HatoLog: couldn't parse the sign-in callback link.", e);
  }
  pendingAuthUrl = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    autoHideMenuBar: true,
    title: "HatoLog",
    icon: ICON_PATH,
    show: !startHidden,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  remoteReachable().then((ok) => {
    if (ok) {
      mainWindow.loadURL(APP_URL + "/");
    } else {
      // No connection yet, and nothing cached: fall back to the copy that shipped
      // inside the installer so the app still opens.
      mainWindow.loadFile(path.join(__dirname, "index.html"));
    }
  });
  // A link in the app should open in the real browser, and nothing should be
  // able to steer this window off the app itself.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    const here = mainWindow.webContents.getURL();
    if (url === here) return;
    const sameApp = APP_URL && url.startsWith(APP_URL);
    if (!sameApp && !url.startsWith("file://")) {
      e.preventDefault();
      openExternalSafely(url);
    }
  });
  mainWindow.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
    // Once, so nobody thinks closing the window stopped their alerts.
    if (!toldAboutTray) {
      toldAboutTray = true;
      showAlert("HatoLog is still running", "Your timer alerts keep working from the tray. Right-click the heart icon to quit.");
    }
  });
  mainWindow.webContents.once("did-finish-load", deliverPendingAuthUrl);
}

// Register this app to handle "hatolog://" links. This is what lets
// auth-bridge.html (opened in the person's real browser) hand control back to
// this app once Google sign-in finishes there. Works reliably once the app is
// installed via the built .exe installer; less consistent when just running
// `npm start` unpackaged, which is normal for custom protocol registration.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Windows/Linux: a second launch (from clicking the sign-in link) hands its
// argv to this, the already-running instance, instead of opening a new window.
app.on("second-instance", (event, argv) => {
  pendingAuthUrl = extractAuthUrl(argv) || pendingAuthUrl;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  deliverPendingAuthUrl();
});

// macOS: the equivalent of "second-instance" for custom protocol links.
app.on("open-url", (event, url) => {
  event.preventDefault();
  pendingAuthUrl = url;
  deliverPendingAuthUrl();
});

// Only ever hand http(s) to the system browser: anything else here would be a
// way to launch arbitrary things on the machine.
function openExternalSafely(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") shell.openExternal(url);
  } catch (e) {
    /* not a URL — ignore */
  }
}

ipcMain.on("hh-open-external", (event, url) => {
  openExternalSafely(url);
});

// ---- crop and weed alerts ------------------------------------------------
// Windows only shows a notification's app name and icon properly when the app
// declares an AppUserModelID matching the installed shortcut. Without this line
// alerts from the packaged .exe would show as "electron.app.Electron".
app.setAppUserModelId("com.hatolog.app");

function clearAlerts() {
  alertTimers.forEach((t) => clearTimeout(t));
  alertTimers = [];
}

function showAlert(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  // Clicking the toast brings the app back, which is the whole point of it when
  // the window has been closed to the tray.
  n.on("click", showWindow);
  n.show();
}

ipcMain.on("hh-schedule-alerts", (event, items) => {
  clearAlerts();
  if (!Array.isArray(items)) return;
  const now = Date.now();
  items.slice(0, 48).forEach((i) => {
    const delay = i.at - now;
    // setTimeout is capped at ~24.8 days; anything further out is left to be
    // rescheduled next time the app is open, which is soon enough for a crop.
    if (delay <= 0 || delay > 2147483647) return;
    alertTimers.push(setTimeout(() => showAlert(String(i.title || "HatoLog"), String(i.body || "")), delay));
  });
});

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Closing the window hides it instead of quitting, so the timers the app was
// given keep their appointment. "Quit" in the tray menu is the real exit.
function createTray() {
  if (tray) return;
  // A real icon: an empty image left the tray entry invisible, so there was
  // no way to see the app was still running (or to reopen/quit it).
  let img = nativeImage.createFromPath(ICON_PATH);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip("HatoLog — timer alerts are on");
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open HatoLog", click: showWindow },
    { type: "separator" },
    {
      label: "Start with Windows (keeps alerts working after a restart)",
      type: "checkbox",
      checked: getAutoStart(),
      click: (item) => { setAutoStart(item.checked); rebuild(); }
    },
    { type: "separator" },
    { label: "Quit (alerts stop)", click: () => { quitting = true; app.quit(); } }
  ]));
  rebuild();
  tray.on("click", showWindow);
}

// Alerts can only fire while the app is running, so by default it starts with
// Windows, straight into the tray. Only for the installed build — a dev run
// shouldn't register itself. Can be switched off from the tray menu.
function getAutoStart() {
  try { return app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin; } catch (e) { return false; }
}
function setAutoStart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] }); } catch (e) {}
}

app.whenReady().then(() => {
  if (app.isPackaged) {
    // First run only: turn auto-start on. A later "off" from the tray is kept,
    // because Windows remembers it and this marker file stops us re-enabling.
    const marker = path.join(app.getPath("userData"), "autostart-initialised");
    try {
      require("fs").accessSync(marker);
    } catch (e) {
      setAutoStart(true);
      try { require("fs").writeFileSync(marker, "1"); } catch (e2) {}
    }
  }
  createWindow();
  createTray();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Deliberately not quitting here: the window hides rather than closes, and the
// app stays resident so pending crop alerts still fire.
app.on("window-all-closed", () => {});

app.on("before-quit", () => { quitting = true; clearAlerts(); });
