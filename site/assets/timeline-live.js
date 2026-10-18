// The Timeline's "By group" view only knows the chapters content/groups.json covers. This watches the
// published book and, if it has more chapters than that, says the tracker is behind.
import { CONFIGURED, firebase, sanitize, chapters } from "./book.js?v=3f515b4eea91";

const note = document.getElementById("tg-asof");
const banner = document.getElementById("tg-banner");

// How many chapters (Heading 1) a published book has.
export function countChapters(htmlText) {
  const root = document.createElement("div");
  root.innerHTML = sanitize(htmlText);
  return chapters(root, { assign: false }).filter(c => c.level === 1).length;
}

if (note && banner && CONFIGURED) {
  const covers = Number(note.dataset.covers) || 0;
  firebase().then(({ db, fs }) => {
    fs.onSnapshot(fs.doc(db, "book", "published"), snap => {
      const d = snap.exists() ? snap.data() : null;
      if (!d || typeof d.html !== "string") return;
      banner.hidden = countChapters(d.html) <= covers;
    }, err => console.warn("Couldn't check the published book for new chapters.", err));
  }).catch(err => console.warn("Couldn't reach Firebase to check for new chapters.", err));
}
