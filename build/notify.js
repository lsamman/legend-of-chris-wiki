// "Notify me of new chapters" on the reading page. Readers who turn it on get a push
// notification when the author publishes a new chapter (sent by .github/workflows/notify.yml).
import { CONFIGURED, firebase, messaging } from "./book.js";
import { vapidKey } from "./firebase-config.js";

const btn = document.getElementById("notify-btn");
const msg = document.getElementById("notify-msg");
const KEY = "loc.notify.token";
const WORKER = "notify-sw.js?v=__LOC_VERSION__";

const stored = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
const remember = t => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {} };
const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const homeScreen = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const pushable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let hide;
function say(text) {
  msg.textContent = text;
  msg.hidden = !text;
  clearTimeout(hide);
  if (text && !/…$/.test(text)) hide = setTimeout(() => { msg.hidden = true; }, 10000);
}
function show(on) {
  btn.hidden = false;
  btn.textContent = on ? "🔔 Notifications on" : "🔔 Notify me";
  btn.title = on ? "You'll get a notification when a new chapter comes out. Click to turn it off."
                 : "Get a notification when a new chapter comes out";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

async function token() {
  const push = await messaging();
  if (!push) throw new Error("unsupported");
  const reg = await navigator.serviceWorker.register(WORKER, { scope: "./" });
  await navigator.serviceWorker.ready;
  const t = await push.fm.getToken(push.messaging, { serviceWorkerRegistration: reg, ...(vapidKey ? { vapidKey } : {}) });
  if (!t) throw new Error("no token");
  return { push, t };
}

async function save(t) {
  const { db, fs } = await firebase();
  await fs.setDoc(fs.doc(db, "subscribers", t), { token: t, createdAt: fs.serverTimestamp() });
}
async function forget(t) {
  const { db, fs } = await firebase();
  await fs.deleteDoc(fs.doc(db, "subscribers", t));
}

async function turnOn() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    say(perm === "denied"
      ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
      : "No problem. Tap the bell again any time.");
    return;
  }
  say("Turning on…");
  const { t } = await token();
  await save(t);
  remember(t);
  show(true);
  say("Done! You'll get a notification when a new chapter comes out.");
}

async function turnOff() {
  const t = stored();
  remember(null);
  show(false);
  say("Notifications are off.");
  try {
    if (t) await forget(t);
    const push = await messaging();
    if (push) await push.fm.deleteToken(push.messaging);
  } catch (e) { console.warn(e); }
}

// Tokens can change over time; keep the saved one current on each visit.
async function refresh() {
  const old = stored();
  try {
    const { t } = await token();
    if (t !== old) {
      await save(t);
      remember(t);
      await forget(old).catch(() => {});
    }
  } catch (e) { console.warn("Couldn't refresh the notification subscription.", e); }
}

if (CONFIGURED && btn) {
  if (pushable) {
    const on = Boolean(stored()) && Notification.permission === "granted";
    if (stored() && !on) remember(null);
    show(on);
    if (on) refresh();
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await (btn.getAttribute("aria-pressed") === "true" ? turnOff() : turnOn());
      } catch (e) {
        console.error(e);
        show(false);
        say("Couldn't turn on notifications in this browser. Try again later, or in another browser.");
      }
      btn.disabled = false;
    };
  } else if (iOS && !homeScreen) {
    show(false);
    btn.onclick = () => say("On iPhone and iPad: tap Share, then “Add to Home Screen”. Open the wiki from your Home Screen and tap the bell there.");
  }
}
