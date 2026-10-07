// Shared by the reading page (reader.js) and the writing room (editor.js):
// Firebase loading, a small HTML sanitizer, and chapter headings + contents.
import { firebaseConfig } from "./firebase-config.js?v=072c9003de52";

const SDK = "https://www.gstatic.com/firebasejs/12.19.0";

// Local testing against the Firebase emulators: open the page with ?emulator on localhost.
export const EMULATOR = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("emulator");
const config = EMULATOR ? { apiKey: "demo", projectId: "demo-loc", appId: "demo", authDomain: "localhost" } : firebaseConfig;
export const CONFIGURED = Boolean(config.apiKey && config.projectId);

let loaded;
export function firebase() {
  if (!loaded) loaded = (async () => {
    const [appMod, fs, am] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-firestore.js`), import(`${SDK}/firebase-auth.js`)]);
    const app = appMod.initializeApp(config);
    const db = fs.getFirestore(app);
    const auth = am.getAuth(app);
    if (EMULATOR) {
      fs.connectFirestoreEmulator(db, "127.0.0.1", 8080);
      am.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    }
    return { db, fs, auth, am };
  })();
  return loaded;
}

// ---------- sanitizing: only the formatting the editor can make survives ----------
const TAGS = new Set(["P", "BR", "H1", "H2", "H3", "STRONG", "B", "EM", "I", "U", "S", "A", "UL", "OL", "LI",
  "BLOCKQUOTE", "SPAN", "IMG", "SUB", "SUP", "PRE", "CODE"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "SVG", "MATH", "FORM", "INPUT", "TEXTAREA", "BUTTON", "SELECT", "LINK", "META"]);

function cleanNode(node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    if (DROP.has(child.tagName)) { child.remove(); continue; }
    cleanNode(child);
    if (!TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
    for (const attr of Array.from(child.attributes)) {
      const n = attr.name, v = attr.value.trim();
      const ok =
        (n === "class" && v.split(/\s+/).every(c => /^ql-[a-z0-9-]+$/.test(c))) ||
        (n === "style" && /^((color|background-color):\s*(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))\s*;?\s*)+$/i.test(v)) ||
        (n === "href" && child.tagName === "A" && /^(https?:|mailto:|#|[\w.-]+\.html(#[\w-]*)?$)/i.test(v)) ||
        (n === "src" && child.tagName === "IMG" && /^https:\/\//i.test(v)) ||
        (n === "alt" && child.tagName === "IMG") ||
        (n === "id" && /^[\w-]+$/.test(v));
      if (!ok) child.removeAttribute(n);
    }
    if (child.tagName === "A" && /^https?:/i.test(child.getAttribute("href") || "")) {
      child.target = "_blank"; child.rel = "noopener";
    }
  }
}
export function sanitize(htmlText) {
  const doc = new DOMParser().parseFromString(`<body>${htmlText}</body>`, "text/html");
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

// ---------- chapters ----------
const norm = s => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const slugify = s => norm(s).replace(/ /g, "-") || "chapter";
const KNOWN = new Map((window.LOC_CHAPTERS || []).map(([slug, printed]) => [norm(printed), slug]));

// List the chapter headings, giving each an id (the wiki's chapter slug when the title matches).
// The editor passes assign: false so it doesn't touch the editable page.
export function chapters(root, { assign = true } = {}) {
  const used = new Set(), list = [];
  root.querySelectorAll("h1, h2").forEach(h => {
    const text = h.textContent.trim();
    if (!text) return;
    let id = (h.tagName === "H1" && KNOWN.get(norm(text))) || slugify(text);
    for (let n = 2; used.has(id); n++) id = id.replace(/-\d+$/, "") + "-" + n;
    used.add(id);
    if (assign) h.id = id;
    list.push({ id, text, level: h.tagName === "H1" ? 1 : 2, el: h });
  });
  return list;
}

export function when(ts) {
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : null;
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}
