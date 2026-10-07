// The writing room: sign in, write in a Pages-style editor, autosave a private
// draft, and publish it to the reading page (read.html).
import { CONFIGURED, firebase, chapters, when } from "./book.js?v=20af778f46d3";

const $ = id => document.getElementById(id);
const SESSION = Math.random().toString(36).slice(2);   // tells this tab's saves apart from other devices'
let quill, db, fs, am, auth, draftRef, pubRef;
let edits = 0, savedEdits = 0, saving = false, timer = null, refreshTimer = null;
let baseRev = 0, remote = null, conflicted = false, publishedHtml = null, studioOpen = false;
const CONFLICT = "draft-conflict";

// ---------- small UI helpers ----------
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200);
}

const dlg = $("dlg");
function ask(title, body, okLabel = "OK") {
  $("dlg-title").textContent = title;
  $("dlg-body").replaceChildren(typeof body === "string" ? Object.assign(document.createElement("p"), { textContent: body }) : body);
  $("dlg-ok").textContent = okLabel;
  $("dlg-ok").hidden = !okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise(res => dlg.addEventListener("close", () => res(dlg.returnValue === "ok"), { once: true }));
}

const STATES = {
  saved: "Saved", saving: "Saving…", dirty: "Edited", error: "Not saved: trying again…",
  offline: "Offline: will save when you reconnect"
};
function setState(kind) {
  const el = $("save-state");
  el.dataset.state = kind;
  el.textContent = STATES[kind];
}

// ---------- signing in ----------
function showSetup(kind, u) {
  const box = $("setup");
  box.replaceChildren();
  box.hidden = false;
  const p = text => { const e = document.createElement("p"); e.textContent = text; box.append(e); return e; };
  if (kind === "config") {
    p("The writing room isn't connected to Firebase yet. Follow “Writing room setup” in the wiki's README, then reload this page.");
    return;
  }
  if (kind === "denied") {
    p(`You're signed in as ${u.email}, but this account isn't allowed to write yet.`);
    const line = p("Your user ID is ");
    const code = document.createElement("code"); code.textContent = u.uid;
    const copy = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: "Copy" });
    copy.onclick = () => navigator.clipboard.writeText(u.uid).then(() => toast("User ID copied."));
    line.append(code, " ", copy);
    p("Put it in firestore.rules, publish the rules in the Firebase console (README step 4), then reload.");
  } else {
    p("Something went wrong opening your draft: " + (u && u.message ? u.message : "unknown error") + ". Reload to try again.");
  }
  const out = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: "Sign out" });
  out.onclick = () => am.signOut(auth);
  box.append(out);
}

function friendly(e) {
  const c = e && e.code || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "That email and password don't match.";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a minute and try again.";
  if (/network/.test(c)) return "No connection. Check your internet and try again.";
  return (e && e.message) || "Couldn't sign in.";
}

async function start() {
  if (!CONFIGURED) { $("gate-loading").hidden = true; showSetup("config"); return; }
  if (!window.Quill) { $("gate-loading").textContent = "The editor couldn't load. Check your connection and reload."; return; }
  try {
    ({ db, fs, am, auth } = await firebase());
  } catch (e) {
    $("gate-loading").textContent = "Couldn't reach Firebase. Check your connection and reload.";
    throw e;
  }
  draftRef = fs.doc(db, "book", "draft");
  pubRef = fs.doc(db, "book", "published");

  $("signin").addEventListener("submit", ev => {
    ev.preventDefault();
    $("signin-msg").textContent = "Signing in…";
    am.signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value)
      .then(() => { $("signin-msg").textContent = ""; $("password").value = ""; })
      .catch(e => { $("signin-msg").textContent = friendly(e); });
  });
  $("forgot").addEventListener("click", () => {
    const email = $("email").value.trim();
    if (!email) { $("signin-msg").textContent = "Type your email first, then press “Forgot password?” again."; return; }
    am.sendPasswordResetEmail(auth, email)
      .then(() => { $("signin-msg").textContent = "If that's the author's email, a reset link is on its way."; })
      .catch(e => { $("signin-msg").textContent = friendly(e); });
  });

  am.onAuthStateChanged(auth, async u => {
    $("gate-loading").hidden = true;
    $("setup").hidden = true;
    document.body.classList.toggle("signed-in", Boolean(u));
    if (!u) {
      $("gate").hidden = false; $("studio").hidden = true; $("signin").hidden = false;
      return;
    }
    $("signin").hidden = true;
    try {
      await openStudio();
    } catch (e) {
      console.error(e);
      showSetup(e && e.code === "permission-denied" ? "denied" : "error", e && e.code === "permission-denied" ? u : e);
    }
  });
}

// ---------- the editor ----------
function makeQuill() {
  const Quill = window.Quill;
  const Delta = Quill.import("delta");
  const Font = Quill.import("formats/font");
  Font.whitelist = ["comic"];
  Quill.register(Font, true);
  quill = new Quill("#editor", {
    theme: "snow",
    placeholder: "Why do we believe what we believe…",
    modules: {
      toolbar: {
        container: "#toolbar",
        handlers: {
          undo: () => quill.history.undo(),
          redo: () => quill.history.redo(),
          image: pictureFromLink
        }
      },
      history: { delay: 800, maxStack: 500, userOnly: true },
      // Pictures live inside the saved document, so pasted/dropped image files would bloat it.
      uploader: { handler: () => toast("Pictures can't be pasted or dropped in. Use the picture button with a link to an image online.") }
    }
  });
  quill.clipboard.addMatcher("IMG", (node, delta) =>
    /^https:\/\//i.test(node.getAttribute("src") || "") ? delta : new Delta());
  quill.on("text-change", (_d, _o, source) => {
    if (source === "silent") return;
    edits++;
    setState("dirty");
    clearTimeout(timer);
    timer = setTimeout(save, 1500);
    refreshSoon();
  });
}

async function pictureFromLink() {
  const box = document.createElement("div");
  const input = Object.assign(document.createElement("input"), { type: "url", placeholder: "https://…", className: "dlg-input" });
  box.append(Object.assign(document.createElement("p"), { textContent: "Paste a link to a picture that's already online (it must start with https://)." }), input);
  setTimeout(() => input.focus(), 50);
  if (!(await ask("Insert a picture", box, "Insert"))) return;
  const url = input.value.trim();
  if (!/^https:\/\/\S+$/i.test(url)) { toast("That doesn't look like an https:// link."); return; }
  const range = quill.getSelection(true);
  quill.insertEmbed(range.index, "image", url, "user");
  quill.setSelection(range.index + 1, 0, "silent");
}

function html() {
  // Quill writes every space as &nbsp;, which stops lines wrapping on the reading page.
  return quill.getSemanticHTML().replace(/&nbsp;/g, " ");
}
function words() {
  const t = quill.getText().trim();
  return t ? t.split(/\s+/).length : 0;
}

function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 400);
}
function refresh() {
  $("words").textContent = words().toLocaleString() + " words";
  const list = chapters(quill.root, { assign: false });
  const ol = $("outline");
  if (!list.length) {
    ol.innerHTML = '<li class="muted">Headings show up here.</li>';
  } else {
    ol.replaceChildren(...list.map(c => {
      const li = document.createElement("li");
      li.className = "lvl-" + c.level;
      const a = Object.assign(document.createElement("a"), { href: "#", textContent: c.text });
      a.onclick = ev => { ev.preventDefault(); document.body.classList.remove("nav-open"); c.el.scrollIntoView({ block: "start" }); };
      li.append(a);
      return li;
    }));
  }
  const same = publishedHtml !== null && publishedHtml === html();
  const btn = $("publish");
  btn.textContent = same ? "Published ✓" : publishedHtml === null ? "Publish" : "Publish changes";
  btn.disabled = same;
}

function load(deltaJson, source = "silent") {
  const sel = quill.getSelection();
  quill.setContents(JSON.parse(deltaJson), source);
  if (sel) quill.setSelection(Math.min(sel.index, quill.getLength() - 1), 0, "silent");
  refresh();
}

async function openStudio() {
  const [draft, pub] = await Promise.all([fs.getDoc(draftRef), fs.getDoc(pubRef)]);
  $("gate").hidden = true;
  $("studio").hidden = false;
  if (!quill) makeQuill();
  publishedHtml = pub.exists() ? pub.data().html : null;
  const d = draft.exists() ? draft.data() : null;
  baseRev = d && d.rev || 0;
  if (d && d.delta) {
    load(d.delta);
  } else if (pub.exists() && pub.data().delta) {
    load(pub.data().delta);
  }
  $("empty").hidden = quill.getLength() > 1;
  quill.history.clear();
  edits = savedEdits = 0;
  setState("saved");
  refresh();
  if (!studioOpen) watchDraft();
  studioOpen = true;
}

// ---------- saving ----------
// Every save says which version it was based on (rev). If another device saved in
// between, nothing is overwritten: the author picks which version to keep.
async function save() {
  clearTimeout(timer); timer = null;
  if (saving || conflicted || edits === savedEdits) return;
  if (!navigator.onLine) { setState("offline"); return; }
  saving = true;
  const v = edits;
  const data = {
    delta: JSON.stringify(quill.getContents()), html: html(), words: words(),
    updatedAt: fs.serverTimestamp(), session: SESSION, rev: baseRev + 1
  };
  setState("saving");
  try {
    await fs.runTransaction(db, async t => {
      const cur = await t.get(draftRef);
      if (cur.exists() && (cur.data().rev || 0) !== baseRev) {
        remote = cur.data();
        throw new Error(CONFLICT);
      }
      t.set(draftRef, data);
    });
    baseRev = data.rev;
    savedEdits = v;
    setState(edits === savedEdits ? "saved" : "dirty");
  } catch (e) {
    if (e.message === CONFLICT) {
      showConflict();
    } else {
      console.error(e);
      setState("error");
      timer = setTimeout(save, 5000);
    }
  } finally {
    saving = false;
    if (edits !== savedEdits && !timer && !conflicted) timer = setTimeout(save, 1500);
  }
}

function showConflict() {
  conflicted = true;
  setState("dirty");
  $("conflict").hidden = false;
}

addEventListener("offline", () => { if (studioOpen && edits !== savedEdits) setState("offline"); });
addEventListener("online", () => { if (studioOpen && edits !== savedEdits) save(); });
addEventListener("beforeunload", ev => { if (edits !== savedEdits) { save(); ev.preventDefault(); ev.returnValue = ""; } });
addEventListener("keydown", ev => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s" && studioOpen) { ev.preventDefault(); save(); }
});

// The same draft open on another device: take its changes, or ask if both sides changed.
function watchDraft() {
  fs.onSnapshot(draftRef, snap => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
    const d = snap.data();
    if (d.session === SESSION || !d.delta || (d.rev || 0) <= baseRev) return;
    remote = d;
    if (edits === savedEdits && !saving && !conflicted) {
      load(d.delta);
      baseRev = d.rev;
      remote = null;
      $("empty").hidden = quill.getLength() > 1;
      toast("Updated with changes from your other device.");
    } else {
      showConflict();
    }
  }, err => console.warn(err));
}
$("take-theirs").onclick = () => {
  if (remote) { load(remote.delta); baseRev = remote.rev || 0; }
  edits = savedEdits; remote = null; conflicted = false;
  $("conflict").hidden = true;
  setState("saved");
  refresh();
};
$("keep-mine").onclick = () => {
  if (remote) baseRev = remote.rev || 0;   // seen theirs; mine replaces it
  remote = null; conflicted = false;
  $("conflict").hidden = true;
  edits++; save();
};

// ---------- publishing and versions ----------
$("publish").onclick = async () => {
  if (!(await ask("Publish this draft?", "Readers will see this version on the wiki right away. Every published version is kept in Version history.", "Publish"))) return;
  await save();
  if (conflicted) { toast("Choose which version to keep first (the notice above the toolbar), then publish."); return; }
  if (edits !== savedEdits) { toast("Couldn't save the draft, so nothing was published. Try again in a moment."); return; }
  const version = { html: html(), delta: JSON.stringify(quill.getContents()), words: words(), publishedAt: fs.serverTimestamp() };
  const batch = fs.writeBatch(db);
  batch.set(pubRef, version);
  batch.set(fs.doc(db, "book", "published", "history", new Date().toISOString()), version);
  try {
    await batch.commit();
    publishedHtml = version.html;
    refresh();
    toast("Published. Readers can see it now.");
  } catch (e) {
    console.error(e);
    toast("Publishing failed: " + (e.message || e));
  }
};

async function replaceDraft(deltaJson, what) {
  load(deltaJson, "api");   // counts as an edit, so it autosaves (and can be undone)
  $("empty").hidden = true;
  toast(what);
}

async function importBook() {
  const res = await fetch("assets/book-import.html");
  if (!res.ok) { toast("Couldn't load the original book."); return; }
  quill.clipboard.dangerouslyPasteHTML(await res.text(), "api");
  quill.setSelection(0, 0, "silent");
  window.scrollTo(0, 0);
  $("empty").hidden = true;
  refresh();
  toast("Imported the original MASTER FILE. It's saved as your draft; readers won't see it until you publish.");
}

const actions = {
  async history() {
    const q = fs.query(fs.collection(db, "book", "published", "history"), fs.orderBy("publishedAt", "desc"), fs.limit(30));
    const snap = await fs.getDocs(q);
    const box = document.createElement("div");
    if (snap.empty) {
      box.append(Object.assign(document.createElement("p"), { textContent: "Nothing has been published yet." }));
    } else {
      box.append(Object.assign(document.createElement("p"), { textContent: "Every version you've published. Opening one puts it in your draft; publish it to bring it back for readers." }));
      const ul = document.createElement("ul");
      ul.className = "history";
      snap.forEach((doc, i) => {
        const v = doc.data();
        const li = document.createElement("li");
        li.append(Object.assign(document.createElement("span"), {
          textContent: `${when(v.publishedAt) || doc.id} · ${(v.words || 0).toLocaleString()} words${i === 0 ? " · live now" : ""}`
        }));
        const b = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: "Open in draft" });
        b.onclick = () => { dlg.close("cancel"); replaceDraft(v.delta, "Loaded that version into your draft."); };
        li.append(b);
        ul.append(li);
      });
      box.append(ul);
    }
    ask("Version history", box, "");
  },
  async revert() {
    const pub = await fs.getDoc(pubRef);
    if (!pub.exists() || !pub.data().delta) { toast("Nothing has been published yet."); return; }
    if (await ask("Revert your draft?", "This replaces your draft with the version readers see now. You can undo it with ↶.", "Revert"))
      replaceDraft(pub.data().delta, "Your draft now matches the published version.");
  },
  async import() {
    if (quill.getLength() > 1 &&
        !(await ask("Import the original book?", "This replaces your whole draft with the original MASTER FILE text. You can undo it with ↶.", "Replace draft"))) return;
    importBook();
  },
  async signout() {
    if (edits !== savedEdits) await save();
    am.signOut(auth);
  }
};
document.querySelectorAll(".menu-pop [data-act]").forEach(b => b.addEventListener("click", () => {
  b.closest("details").open = false;
  actions[b.dataset.act]().catch(e => { console.error(e); toast("That didn't work: " + (e.message || e)); });
}));
$("empty-import").onclick = () => importBook();
$("empty-blank").onclick = () => { $("empty").hidden = true; quill.focus(); };

start();
