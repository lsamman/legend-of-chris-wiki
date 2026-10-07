// The reading page: shows the built-in original text, then swaps in whatever the
// author last published (and keeps it live if they publish again while you read).
import { CONFIGURED, firebase, sanitize, chapters, when } from "./book.js?v=fbfec6b5a0df";

const book = document.getElementById("book");
const toc = document.getElementById("book-toc");
const updated = document.getElementById("book-updated");

function contents() {
  const list = chapters(book).filter(c => c.level === 1);
  toc.replaceChildren(...list.map(c => {
    const li = document.createElement("li"), a = document.createElement("a");
    a.href = "#" + c.id; a.textContent = c.text;
    li.append(a);
    return li;
  }));
  toc.closest(".book-toc").hidden = list.length < 2;
}
contents();

if (CONFIGURED) {
  let first = true;
  firebase().then(({ db, fs }) => {
    fs.onSnapshot(fs.doc(db, "book", "published"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (typeof d.html !== "string" || !d.html.trim()) return;
      book.innerHTML = sanitize(d.html);
      contents();
      updated.textContent = d.publishedAt ? "Updated " + when(d.publishedAt) : "Updated";
      if (first && location.hash) {
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (target) target.scrollIntoView();
      }
      first = false;
    }, err => console.warn("Couldn't load the latest published text; showing the original.", err));
  }).catch(err => console.warn("Couldn't reach Firebase; showing the original.", err));
}
