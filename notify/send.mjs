// Sends the "new chapter" notification the author asked for when publishing.
// Run by .github/workflows/notify.yml every 15 minutes; does nothing if there's nothing new.
//
// Needs the FIREBASE_SERVICE_ACCOUNT secret (Firebase console → Project settings →
// Service accounts → Generate new private key). For local testing against the emulator,
// set FIRESTORE_EMULATOR_HOST and LOC_FAKE_SEND=1 instead.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { readFileSync } from "node:fs";

// The notification's words: one title + text combo from messages.json, picked at random,
// never the same one twice in a row. (Tapping it still opens the new chapter.)
const MESSAGES = JSON.parse(readFileSync(new URL("./messages.json", import.meta.url), "utf8"))
  .filter(m => m && typeof m.title === "string" && m.title.trim());
export function pickMessage(last, random = Math.random) {
  if (!MESSAGES.length) return -1;
  if (MESSAGES.length === 1) return 0;
  if (!(last >= 0 && last < MESSAGES.length)) return Math.floor(random() * MESSAGES.length);
  const i = Math.floor(random() * (MESSAGES.length - 1));
  return i >= last ? i + 1 : i;   // skip last time's combo
}

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!key && !emulator) {
  console.log("Notifications aren't configured yet: add the FIREBASE_SERVICE_ACCOUNT secret (see README).");
  process.exit(0);
}
initializeApp(key ? { credential: cert(JSON.parse(key)) } : { projectId: process.env.GCLOUD_PROJECT || "demo-loc" });
const db = getFirestore();

// For tests: pretend to send, failing any token that starts with "bad".
const fake = {
  async sendEachForMulticast({ tokens }) {
    const responses = tokens.map(t => t.startsWith("bad")
      ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
      : { success: true });
    return { responses, successCount: responses.filter(r => r.success).length };
  }
};
const messaging = process.env.LOC_FAKE_SEND ? fake : getMessaging();

const ref = db.doc("book/announce");
const snap = await ref.get();
const a = snap.exists ? snap.data() : null;
if (!a || a.sent) {
  console.log("Nothing new to announce.");
  process.exit(0);
}

const stateRef = db.doc("meta/notify");   // remembers the last combo used (only the server can read it)
const last = (await stateRef.get()).data()?.last ?? -1;
const pick = pickMessage(typeof last === "number" ? last : -1);
const words = pick >= 0 ? MESSAGES[pick] : { title: a.title, body: a.body };
const title = String(words.title || "").trim(), body = String(words.body || "").trim();

const tokens = (await db.collection("subscribers").get()).docs.map(d => d.id);
const GONE = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);
let sent = 0, removed = 0;
for (let i = 0; i < tokens.length; i += 500) {
  const chunk = tokens.slice(i, i + 500);
  const res = await messaging.sendEachForMulticast({
    tokens: chunk,
    data: { title, body, slug: String(a.slug || ""), tag: "loc-" + (a.slug || "chapter") },
    webpush: { headers: { Urgency: "high", TTL: String(7 * 24 * 3600) } }
  });
  sent += res.successCount;
  const dead = res.responses.map((r, j) => !r.success && GONE.has(r.error && r.error.code) ? chunk[j] : null).filter(Boolean);
  await Promise.all(dead.map(t => db.doc(`subscribers/${t}`).delete()));
  removed += dead.length;
  res.responses.forEach((r, j) => { if (!r.success && !GONE.has(r.error && r.error.code)) console.warn("Couldn't send to one device:", r.error && r.error.code); });
}

await ref.update({ sent: true, sentAt: FieldValue.serverTimestamp(), delivered: sent, removed, sentTitle: title, sentBody: body });
if (pick >= 0) await stateRef.set({ last: pick });
console.log(`Announced "${title}" (${a.title}) to ${sent} of ${tokens.length} devices (${removed} expired subscriptions removed).`);
