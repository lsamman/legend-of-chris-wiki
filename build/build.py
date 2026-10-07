#!/usr/bin/env python3
"""Static site generator for The Legend of Chris Wiki.

Reads content/entries/*.json and writes a flat static site into site/.
"""
import glob
import html
import json
import os
import random
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build"))
import manifest  # noqa: E402

SITE = os.path.join(ROOT, "site")
RESERVED = {"index", "all-pages", "search", "random", "read", "write"}

CATEGORIES = [
    ("chapters", "Chapters", "The canon, in the order it was written (which is not the order it is numbered)."),
    ("characters", "Characters", "Ballers, haters, tech bros, cars wearing robes, and one orphan with no last name."),
    ("locations", "Locations", "Planets, universes, sectors, galaxies wrapped in office buildings, and at least one port-a-potty."),
    ("factions", "Factions & Organizations", "Gangs, frats, covenants, empires and the occasional Department."),
    ("items", "Items & Technology", "Sacred apps, ancient phones, multiverse navigators and the 3 year contract plan from Verizon."),
    ("events", "Events", "Wars, heists, snaps, debates and the housing market crash of 2007/2008."),
    ("concepts", "Concepts & Lore", "Balling, the Prophecy, and other things that cannot be explained, only believed."),
]
CAT_NAME = {c[0]: c[1] for c in CATEGORIES}
CHAPTER_ORDER = [c[0] for c in manifest.CHAPTERS]
_img_path = os.path.join(ROOT, "content", "images.json")
IMAGES = json.load(open(_img_path, encoding="utf-8")) if os.path.exists(_img_path) else {}
CHAPTER_PRINTED = {c[0]: c[1] for c in manifest.CHAPTERS}
CHAPTER_SHORT = {c[0]: c[2] for c in manifest.CHAPTERS}


# ----------------------------------------------------------------- load
def load_entries():
    entries = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "content", "entries", "*.json"))):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for e in data:
            slug = e.get("slug")
            if not slug:
                continue
            if slug in entries:
                print(f"warn: duplicate slug {slug} in {path}", file=sys.stderr)
            entries[slug] = e
    # Fill stubs for anything in the manifest that no writer covered.
    for slug, title, cat, _b, hint in manifest.E:
        if slug not in entries:
            entries[slug] = {"slug": slug, "title": title, "category": cat, "stub": True,
                             "lead": f"**{title}** is part of the lore of the Legend of Chris. This article is a stub. You can help the Legend of Chris Wiki by expanding it."}
    for slug, printed, short, _a, _b in manifest.CHAPTERS:
        if slug not in entries:
            entries[slug] = {"slug": slug, "title": short, "category": "chapters", "stub": True,
                             "lead": f"**{printed}** is a chapter of the Legend of Chris. This article is a stub."}
    for e in entries.values():
        if e["slug"] in CHAPTER_ORDER:
            e["category"] = "chapters"
        e.setdefault("category", "concepts")
        if e["category"] not in CAT_NAME:
            e["category"] = "concepts"
    return entries


# ----------------------------------------------------------------- markup
LINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]")


class Renderer:
    def __init__(self, entries):
        self.entries = entries
        self.backlinks = {s: set() for s in entries}
        self.current = None
        self.redlinks = set()

    def title_of(self, slug):
        e = self.entries.get(slug)
        return e["title"] if e else slug

    def inline(self, text):
        # escape first, then re-introduce our tiny markup
        text = html.escape(str(text), quote=False)

        def link(m):
            slug = m.group(1).strip().lower()
            label = m.group(2) or self.title_of(slug)
            if slug in self.entries:
                if self.current and slug != self.current:
                    self.backlinks[slug].add(self.current)
                return f'<a href="{slug}.html">{label}</a>'
            self.redlinks.add(slug)
            return f'<span class="redlink" title="This page does not exist (yet)">{label}</span>'

        text = LINK_RE.sub(link, text)
        text = re.sub(r"\*{3,}", lambda m: "&#42;" * len(m.group(0)), text)  # the book's censor stars
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
        return text

    def block(self, text):
        """Paragraphs, ### headings, - lists, > quotes."""
        out = []
        lines = str(text).replace("\r", "").split("\n")
        para, items, quote = [], [], []

        def flush():
            if para:
                out.append(f"<p>{self.inline(' '.join(para))}</p>")
                para.clear()
            if items:
                out.append("<ul>" + "".join(f"<li>{self.inline(i)}</li>" for i in items) + "</ul>")
                items.clear()
            if quote:
                out.append(f'<blockquote>{self.inline(" ".join(quote))}</blockquote>')
                quote.clear()

        for raw in lines:
            line = raw.strip()
            if not line:
                flush()
            elif line.startswith("### "):
                flush()
                out.append(f"<h3>{self.inline(line[4:])}</h3>")
            elif line.startswith(("- ", "* ", "• ")):
                if para or quote:
                    flush()
                items.append(line[2:])
            elif line.startswith(">"):
                if para or items:
                    flush()
                quote.append(line.lstrip("> ").strip())
            else:
                if items or quote:
                    flush()
                para.append(line)
        flush()
        return "\n".join(out)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ----------------------------------------------------------------- layout
def nav_html(active=None, sidebar=None):
    links = "".join(
        f'<li><a href="category-{c}.html"{" aria-current=page" if active == c else ""}>{n}</a></li>'
        for c, n, _ in CATEGORIES)
    chapters = "".join(
        f'<li><a href="{s}.html"{" aria-current=page" if active == s else ""}>{html.escape(CHAPTER_SHORT[s])}</a></li>'
        for s in CHAPTER_ORDER)
    if sidebar is not None:
        return sidebar
    return f"""
<nav class="sidebar" aria-label="Wiki navigation">
  <div class="side-box">
    <div class="side-head">Navigation</div>
    <ul>
      <li><a href="index.html">Main Page</a></li>
      <li><a href="read.html"{" aria-current=page" if active == "read" else ""}>Read the MASTER FILE</a></li>
      <li><a href="all-pages.html">All pages (A–Z)</a></li>
      <li><a href="random.html" class="random-link">Random page</a></li>
    </ul>
  </div>
  <div class="side-box">
    <div class="side-head">Categories</div>
    <ul>{links}</ul>
  </div>
  <div class="side-box">
    <div class="side-head">The Canon</div>
    <ol class="chap-list">{chapters}</ol>
  </div>
  <img class="side-mascot" src="assets/chill-chris.png" alt="" width="108" height="118">
</nav>"""


def page(title, body, *, active=None, description="", page_no=None, head_extra="", scripts="", sidebar=None, body_class=""):
    doc_title = "The Legend Of Chris Wiki" if title is None else f"{title} | The Legend Of Chris Wiki"
    num = page_no if page_no is not None else random.randint(2, 52)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(doc_title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="icon" href="assets/chill-chris.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400;1,700&family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/style.css">
<script>try{{var t=localStorage.getItem('loc-theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
{head_extra}</head>
<body{f' class="{body_class}"' if body_class else ""}>
<header class="toolbar">
  <div class="toolbar-inner">
    <div class="traffic" aria-hidden="true"><span></span><span></span><span></span></div>
    <a class="docname" href="index.html"><img src="assets/chill-chris.png" alt="" width="22" height="24"><span>The Legend Of Chris <b>MASTER FILE</b> <i>— Wiki</i></span></a>
    <form class="search" action="all-pages.html" role="search" onsubmit="return false">
      <input id="q" type="search" placeholder="Search the lore…" autocomplete="off" aria-label="Search the wiki">
      <ul id="results" role="listbox" hidden></ul>
    </form>
    <button class="theme-btn" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">◐</button>
    <button class="menu-btn" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
  </div>
</header>
<div class="desk">
  {nav_html(active, sidebar)}
  <main class="sheet">
    {body}
    <footer class="sheet-foot">
      <span>The Legend Of Chris Wiki — a fan wiki. Lore is canon. Spelling is canon. Nothing is canon.</span>
      <span class="pgnum" aria-hidden="true">{num}</span>
    </footer>
  </main>
</div>
<script src="assets/search-index.js"></script>
<script src="assets/wiki.js"></script>
{scripts}</body>
</html>
"""


# ----------------------------------------------------------------- article
def render_article(e, R, entries):
    slug = e["slug"]
    R.current = slug
    cat = e["category"]
    parts = []

    # Title: chapters get the giant stacked heading the book uses.
    if cat == "chapters":
        printed = CHAPTER_PRINTED.get(slug, e["title"])
        parts.append(f'<div class="chapter-title" aria-label="{html.escape(printed)}">'
                     + "".join(f"<span>{html.escape(w)}</span> " for w in printed.split())
                     + "</div>")
        parts.append(f'<h1 class="sr-title">{html.escape(e["title"])}</h1>')
    else:
        parts.append(f'<h1 class="title">{html.escape(e["title"])}</h1>')
    sub = e.get("subtitle")
    crumbs = f'<a href="category-{cat}.html">{CAT_NAME[cat]}</a>'
    parts.append(f'<p class="crumbs">From The Legend Of Chris Wiki · {crumbs}'
                 + (f' · <span class="subtitle">{R.inline(sub)}</span>' if sub else "") + "</p>")

    if e.get("stub"):
        parts.append('<div class="notice">This article is a <b>stub</b>. Much like Mic Q, its contents never have, never will, and cannot exist.</div>')

    # Infobox
    info = e.get("infobox") or {}
    photos = IMAGES.get(slug, [])
    if info or slug == "chris" or photos:
        rows = "".join(f"<tr><th>{R.inline(k)}</th><td>{R.inline(v)}</td></tr>" for k, v in info.items())
        img = ""
        if slug == "chris":
            img = ('<figure class="ib-img"><img src="assets/chill-chris.png" alt="The cover of The Legend Of Chris: a smug cartoon dog in a grey sweater, hands in pockets" width="215" height="234">'
                   '<figcaption>Chris, as depicted on the cover of the MASTER FILE</figcaption></figure>')
        for ph in photos:
            artist = ph["artist"] if len(ph["artist"]) <= 60 else ph["artist"][:57].rstrip() + "…"
            img += (f'<figure class="ib-img"><a href="{html.escape(ph["wiki"])}" target="_blank" rel="noopener">'
                    f'<img src="assets/img/{ph["src"]}" alt="{html.escape(ph["caption"])}" loading="lazy"></a>'
                    f'<figcaption>{html.escape(ph["caption"])}<span class="credit">Photo: {html.escape(artist)} · '
                    f'{html.escape(ph["license"])} · <a href="{html.escape(ph["source"])}" target="_blank" rel="noopener">Wikimedia Commons</a></span>'
                    f'</figcaption></figure>')
        parts.append(f'<aside class="infobox"><div class="ib-title">{html.escape(e["title"])}</div>{img}'
                     f'<table>{rows}</table><div class="ib-cat">{CAT_NAME[cat]}</div></aside>')

    q = e.get("quote")
    if isinstance(q, dict) and q.get("text"):
        parts.append(f'<figure class="epigraph"><blockquote>“{R.inline(q["text"].strip("“”\""))}”</blockquote>'
                     + (f'<figcaption>— {R.inline(q.get("by", ""))}</figcaption>' if q.get("by") else "")
                     + "</figure>")

    lead = e.get("lead", "")
    if lead:
        parts.append(f'<div class="lead">{R.block(lead)}</div>')

    sections = [s for s in (e.get("sections") or []) if isinstance(s, dict) and s.get("body")]
    if len(sections) >= 3:
        toc = "".join(f'<li><a href="#{slugify(s.get("heading", ""))}">{html.escape(s.get("heading", ""))}</a></li>' for s in sections)
        parts.append(f'<nav class="toc" aria-label="Contents"><div class="toc-head">Contents</div><ol>{toc}</ol></nav>')
    for s in sections:
        h = s.get("heading", "")
        parts.append(f'<section><h2 id="{slugify(h)}">{html.escape(h)}</h2>{R.block(s["body"])}</section>')

    # Chapter prev / next
    if slug in CHAPTER_ORDER:
        parts.append(f'<p class="read-chapter"><a href="read.html#{slug}">Read this chapter in the MASTER FILE →</a></p>')
        i = CHAPTER_ORDER.index(slug)
        prev_ = CHAPTER_ORDER[i - 1] if i > 0 else None
        next_ = CHAPTER_ORDER[i + 1] if i + 1 < len(CHAPTER_ORDER) else None
        parts.append('<div class="chapnav">'
                     + (f'<a href="{prev_}.html">← {html.escape(CHAPTER_SHORT[prev_])}</a>' if prev_ else "<span></span>")
                     + (f'<a href="{next_}.html">{html.escape(CHAPTER_SHORT[next_])} →</a>' if next_ else "<span></span>")
                     + "</div>")

    apps = [a for a in (e.get("appearances") or []) if a in CHAPTER_ORDER]
    if apps and cat != "chapters":
        apps = sorted(set(apps), key=CHAPTER_ORDER.index)
        for a in apps:
            R.backlinks[a].add(slug)
        parts.append('<section class="meta"><h2 id="appearances">Appearances</h2><ul class="apps">'
                     + "".join(f'<li><a href="{a}.html">{html.escape(CHAPTER_SHORT[a])}</a></li>' for a in apps)
                     + "</ul></section>")

    rel = [r for r in (e.get("related") or []) if r in entries and r != slug]
    if rel:
        for r in rel:
            R.backlinks[r].add(slug)
        parts.append('<section class="meta"><h2 id="see-also">See also</h2><ul class="chips">'
                     + "".join(f'<li><a href="{r}.html">{html.escape(entries[r]["title"])}</a></li>' for r in rel)
                     + "</ul></section>")

    parts.append("<!--BACKLINKS-->")
    parts.append(f'<div class="catbar">Category: <a href="category-{cat}.html">{CAT_NAME[cat]}</a></div>')
    R.current = None
    return "\n".join(parts)


def plain(text, n=160):
    t = LINK_RE.sub(lambda m: m.group(2) or m.group(1), str(text))
    t = re.sub(r"[*>#]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"


# ----------------------------------------------------------------- main page
def collect_trivia(entries):
    out = []
    for e in entries.values():
        for s in e.get("sections") or []:
            if isinstance(s, dict) and "trivia" in s.get("heading", "").lower():
                for line in str(s.get("body", "")).split("\n"):
                    line = line.strip()
                    if line.startswith(("- ", "* ")) and 40 < len(line) < 260:
                        out.append((e["slug"], line[2:]))
    return out


def render_index(entries, R):
    random.seed(67)
    counts = {c: sum(1 for e in entries.values() if e["category"] == c) for c, _, _ in CATEGORIES}
    total = len(entries)
    chris = entries.get("chris", {})
    trivia = collect_trivia(entries)
    random.shuffle(trivia)
    R.current = "index"
    dyk = "".join(f"<li><a class='dyk-src' href='{s}.html'><b>{html.escape(entries[s]['title'])}</b></a> — {R.inline(t)}</li>"
                  for s, t in trivia[:7])
    portals = "".join(
        f'<a class="portal" href="category-{c}.html"><span class="portal-n">{counts[c]}</span>'
        f'<span class="portal-name">{n}</span><span class="portal-d">{d}</span></a>'
        for c, n, d in CATEGORIES)
    chapters = "".join(
        f'<li><a href="{s}.html"><b>{html.escape(CHAPTER_SHORT[s])}</b><span>{html.escape(CHAPTER_PRINTED[s]) if CHAPTER_PRINTED[s] != CHAPTER_SHORT[s] else "&nbsp;"}</span></a></li>'
        for s in CHAPTER_ORDER)
    featured_lead = R.block(plain(chris.get("lead", ""), 520))
    R.current = None
    nuh = " ".join(['<span>“Nuh Uh”</span> <span>“Nuh Uh”</span> <span class="yuh">“Yuh huh”</span>'] * 14)
    body = f"""
<div class="cover">
  <p class="cover-title">The Legend Of Chris</p>
  <img src="assets/chill-chris.png" alt="The cover dog: Chris, chilling" width="215" height="234">
  <p class="cover-sub">Wiki</p>
</div>
<h1 class="chapter-title home-title"><span>The</span> <span>Wiki</span> <span>Before</span> <span>Chapter</span> <span>2</span></h1>
<p class="drop">Why do we believe what we believe we believe that we believe we believe we believe. It's a matter of Chris. Welcome to <b>The Legend Of Chris Wiki</b>, the free encyclopedia about the MASTER FILE that anyone can read but no one can explain. We currently document <b>{total}</b> articles about every baller, hater, planet, sector, sacred app and contract plan in the canon.</p>

<div class="verizon">“The 3 year contract plan from Verizon<br>for unlimited talk and text”</div>

<div class="home-grid">
  <section class="home-box featured">
    <h2>Featured article</h2>
    <a href="chris.html" class="feat-title">Chris: All Balled Up Deluxe Edition</a>
    {featured_lead}
    <p><a href="chris.html">Read more →</a></p>
  </section>
  <section class="home-box">
    <h2>Did you know…</h2>
    <ul class="dyk">{dyk}</ul>
  </section>
</div>

<h2 class="home-h">Browse the lore</h2>
<div class="portals">{portals}</div>

<h2 class="home-h">The Canon</h2>
<p class="muted">Eight chapters. The numbering is canon. Please do not ask about the numbering.</p>
<ol class="canon">{chapters}</ol>

<h2 class="home-h">The Goober Gang</h2>
<div class="goober">
—————<br><a href="goober-gang.html">The Goober Gang</a><br>-<a href="lightning-mcqueen.html">McQueen</a><br>-<a href="agent-007.html">007</a><br>-<a href="mr-bean.html">Mr.Bean</a><br>—————-
</div>

<div class="nuh" aria-label="The Great Nuh Uh–Yuh Huh Debate (excerpt)"><a href="nuh-uh-debate.html">{nuh}</a></div>
<p class="nines" aria-hidden="true">9999999999999</p>
"""
    return page(None, body, description="A complete fan wiki for The Legend Of Chris.", page_no=1)


# ----------------------------------------------------------------- lists
def render_category(cat, name, desc, entries):
    items = sorted((e for e in entries.values() if e["category"] == cat),
                   key=lambda e: CHAPTER_ORDER.index(e["slug"]) if cat == "chapters" else e["title"].lower().lstrip("\"“[ "))
    lis = "".join(
        f'<li><a href="{e["slug"]}.html">{html.escape(e["title"])}</a>'
        f'<span class="cat-desc">{html.escape(plain(e.get("subtitle") or e.get("lead", ""), 120))}</span></li>'
        for e in items)
    words = name.split()
    body = (f'<div class="chapter-title cat-title">' + "".join(f"<span>{html.escape(w)}</span> " for w in ["Category:"] + words) + "</div>"
            f'<h1 class="sr-title">Category: {html.escape(name)}</h1>'
            f'<p class="crumbs">{html.escape(desc)} · {len(items)} pages</p>'
            f'<input class="filter" type="search" placeholder="Filter this category…" aria-label="Filter this category">'
            f'<ul class="catlist">{lis}</ul>')
    return page(f"Category: {name}", body, active=cat, description=desc)


def render_all(entries):
    groups = {}
    for e in entries.values():
        k = re.sub(r"^[^A-Za-z0-9]+", "", e["title"])[:1].upper() or "#"
        if k.isdigit():
            k = "#"
        groups.setdefault(k, []).append(e)
    keys = sorted(groups, key=lambda k: (k != "#", k))
    jump = "".join(f'<a href="#l-{k}">{k}</a>' for k in keys)
    blocks = "".join(
        f'<h2 id="l-{k}">{k}</h2><ul class="az">'
        + "".join(f'<li><a href="{e["slug"]}.html">{html.escape(e["title"])}</a> <small>{CAT_NAME[e["category"]]}</small></li>'
                  for e in sorted(groups[k], key=lambda e: e["title"].lower()))
        + "</ul>" for k in keys)
    body = (f'<h1 class="title">All pages</h1><p class="crumbs">{len(entries)} articles, alphabetically. Balling is free.</p>'
            f'<div class="jump">{jump}</div>{blocks}')
    return page("All pages", body, description="Every article on the wiki.")


def render_random(entries):
    body = ('<h1 class="title">Random page</h1><p>Rolling the roulette ball… <i>Several NFTs on red!</i></p>'
            '<script>var k=Object.keys(window.LOC_INDEX||{});if(k.length)location.replace(k[Math.floor(Math.random()*k.length)]+".html");</script>')
    return page("Random page", body)


# ----------------------------------------------------------------- the book
# First line of prose in each chapter of content/book.txt (the lines before it are
# the stacked chapter title, which becomes a single heading).
BOOK_BODY_START = {
    "chapter-before-chapter-2": 11, "chapter-2": 305, "chapter-triangle": 415, "chapter-the-fourth": 523,
    "dunder-mifflan-chapter": 645, "flashback-chapter": 759, "chapter-maybe-seventh": 909, "chapter-4-point-1": 1065,
}
BOOK_SUBTITLES = {"chapter-before-chapter-2": "Chris Origins"}
VERIZON = "“The 3 year contract plan from Verizon"


def render_book_html():
    """content/book.txt (hard-wrapped text from the PDF) as clean HTML: one <h1> per chapter, real paragraphs."""
    with open(os.path.join(ROOT, "content", "book.txt"), encoding="utf-8") as f:
        lines = f.read().replace("\x0c", "").split("\n")
    out = []
    for slug, printed, _short, _a, last in manifest.CHAPTERS:
        out.append(f'<h1 id="{slug}">{html.escape(printed)}</h1>')
        if slug in BOOK_SUBTITLES:
            out.append(f'<h2 class="ql-align-center">{html.escape(BOOK_SUBTITLES[slug])}</h2>')
        para, verse = [], []

        def flush():
            if para:
                out.append(f"<p>{html.escape(' '.join(para))}</p>")
                para.clear()
            if verse:
                out.append("<p>" + "<br>".join(html.escape(v) for v in verse) + "</p>")
                verse.clear()

        body = [l.strip() for l in lines[BOOK_BODY_START[slug] - 1:last]]
        i, keep_going = 0, False
        while i < len(body):
            s = body[i]
            nxt = body[i + 1] if i + 1 < len(body) else ""
            if not s:
                if not keep_going:
                    flush()
                i += 1
                continue
            keep_going = False
            if i == 0 and re.match(r"^[A-Z]\s{3,}\w", s):     # the drop cap: "W         hy do we believe"
                s = re.sub(r"^([A-Z])\s+", r"\1", s)
                keep_going = True
            if s.startswith(VERIZON):                         # the sacred plan, always set apart
                flush()
                quote = [s]
                if not s.endswith("”") and nxt:
                    quote.append(nxt)
                    i += 1
                out.append(f'<p class="ql-align-center"><strong>{html.escape(" ".join(quote))}</strong></p>')
                i += 1
                continue
            if len(s) < 20 and (verse or (len(nxt) < 20 and nxt)):   # a little list, e.g. the Goober Gang
                if para:
                    flush()
                verse.append(s)
                i += 1
                continue
            if verse:
                flush()
            if not para and len(body[i]) and lines[BOOK_BODY_START[slug] - 1 + i].startswith(" " * 12) and not nxt:
                out.append(f'<p class="ql-align-center"><em>{html.escape(s)}</em></p>')   # "(This is a Flashback)"
                i += 1
                continue
            para.append(s)
            # A short line that ends a sentence ends the paragraph, unless the sentence carries on.
            if len(s) < 48 and re.search(r"[.…”\"!?)]$", s) and not re.match(r"^[a-z]", nxt):
                flush()
            i += 1
        flush()
    return "\n".join(out)


def render_read(book_html):
    chapters = json.dumps([[s, p] for s, p, *_ in manifest.CHAPTERS], ensure_ascii=False)
    body = f"""
<div class="chapter-title read-title" aria-hidden="true"><span>The</span> <span>Legend</span> <span>Of</span> <span>Chris</span></div>
<h1 class="sr-title">The Legend Of Chris — the MASTER FILE</h1>
<p class="crumbs read-meta">The complete text of the MASTER FILE · <span id="book-updated">Original edition</span><a class="write-link" href="write.html" title="Writing room (author only)">✎</a></p>
<nav class="toc book-toc" aria-label="Chapters"><div class="toc-head">Contents</div><ol id="book-toc"></ol></nav>
<article class="book" id="book">
{book_html}
</article>
<script>window.LOC_CHAPTERS={chapters};</script>"""
    return page("Read the MASTER FILE", body, active="read",
                description="The complete text of The Legend Of Chris, the MASTER FILE.",
                scripts='<script type="module" src="assets/reader.js"></script>\n')


QUILL = "https://cdn.jsdelivr.net/npm/quill@2.0.3/dist"


def render_write():
    chapters = json.dumps([[s, p] for s, p, *_ in manifest.CHAPTERS], ensure_ascii=False)
    sidebar = """
<nav class="sidebar" aria-label="Outline">
  <div class="side-box outline-box">
    <div class="side-head">Outline</div>
    <ol class="outline" id="outline"><li class="muted">Headings show up here.</li></ol>
  </div>
  <div class="side-box">
    <div class="side-head">Wiki</div>
    <ul>
      <li><a href="read.html" target="_blank" rel="noopener">Published version ↗</a></li>
      <li><a href="index.html">Main Page</a></li>
    </ul>
  </div>
</nav>"""
    icon = lambda d: f'<svg viewBox="0 0 18 18"><path class="ql-stroke" fill="none" d="{d}"/></svg>'
    body = f"""
<section id="gate">
  <h1 class="title">Writing room</h1>
  <p class="crumbs">Where the MASTER FILE gets written. Only the author can sign in. Everyone else can <a href="read.html">read it here</a>.</p>
  <p id="gate-loading" class="muted">Loading…</p>
  <form id="signin" class="signin" hidden>
    <label>Email <input id="email" type="email" autocomplete="username" required></label>
    <label>Password <input id="password" type="password" autocomplete="current-password" required></label>
    <div class="signin-row"><button class="btn primary" type="submit">Sign in</button> <button class="linkish" type="button" id="forgot">Forgot password?</button></div>
    <p id="signin-msg" class="form-msg" role="status"></p>
  </form>
  <div id="setup" class="notice" hidden></div>
</section>

<section id="studio" hidden>
  <div class="studio-bar">
    <span id="save-state" class="save-state" role="status">Saved</span>
    <span id="words" class="muted"></span>
    <span class="studio-spacer"></span>
    <details class="studio-menu">
      <summary class="btn" aria-label="More">More ▾</summary>
      <div class="menu-pop">
        <button type="button" data-act="history">Version history…</button>
        <button type="button" data-act="revert">Revert draft to published</button>
        <button type="button" data-act="import">Import the original book…</button>
        <button type="button" data-act="signout">Sign out</button>
      </div>
    </details>
    <button id="publish" class="btn primary" type="button">Publish</button>
  </div>
  <div id="conflict" class="notice conflict" hidden>This draft was just changed on another device.
    <button class="btn" type="button" id="take-theirs">Load that version</button>
    <button class="btn" type="button" id="keep-mine">Keep mine</button></div>
  <div id="toolbar" class="pages-toolbar">
    <span class="ql-formats">
      <button type="button" class="ql-undo" title="Undo">{icon("M5 7h7a4 4 0 0 1 0 8H8M5 7l3-3M5 7l3 3")}</button>
      <button type="button" class="ql-redo" title="Redo">{icon("M13 7H6a4 4 0 0 0 0 8h4M13 7l-3-3M13 7l-3 3")}</button>
    </span>
    <span class="ql-formats">
      <select class="ql-header" title="Paragraph style"><option value="1">Chapter title</option><option value="2">Heading</option><option value="3">Subheading</option><option selected>Body</option></select>
      <select class="ql-font" title="Font"><option selected>Arial</option><option value="comic">Comic Sans</option></select>
      <select class="ql-size" title="Size"><option value="small"></option><option selected></option><option value="large"></option><option value="huge"></option></select>
    </span>
    <span class="ql-formats">
      <button type="button" class="ql-bold" title="Bold"></button><button type="button" class="ql-italic" title="Italic"></button>
      <button type="button" class="ql-underline" title="Underline"></button><button type="button" class="ql-strike" title="Strikethrough"></button>
      <select class="ql-color" title="Text colour"></select><select class="ql-background" title="Highlight"></select>
    </span>
    <span class="ql-formats">
      <select class="ql-align" title="Alignment"></select>
      <button type="button" class="ql-list" value="ordered" title="Numbered list"></button><button type="button" class="ql-list" value="bullet" title="Bulleted list"></button>
      <button type="button" class="ql-indent" value="-1" title="Outdent"></button><button type="button" class="ql-indent" value="+1" title="Indent"></button>
    </span>
    <span class="ql-formats">
      <button type="button" class="ql-blockquote" title="Quote"></button><button type="button" class="ql-link" title="Link"></button>
      <button type="button" class="ql-image" title="Picture from a link"></button><button type="button" class="ql-clean" title="Clear formatting"></button>
    </span>
  </div>
  <div class="page-wrap"><div id="editor" class="book"></div></div>
  <div id="empty" class="empty-draft" hidden>
    <p><b>Your draft is empty.</b> Start from the original MASTER FILE, or start writing on a blank page.</p>
    <button class="btn primary" type="button" id="empty-import">Import the original book</button>
    <button class="btn" type="button" id="empty-blank">Blank page</button>
  </div>
</section>

<dialog id="dlg" class="dlg"><form method="dialog">
  <h2 id="dlg-title"></h2><div id="dlg-body"></div>
  <div class="dlg-row"><button class="btn" value="cancel">Cancel</button> <button class="btn primary" id="dlg-ok" value="ok">OK</button></div>
</form></dialog>
<div id="toast" class="toast" role="status" hidden></div>
<script>window.LOC_CHAPTERS={chapters};</script>"""
    head = (f'<meta name="robots" content="noindex">\n<link rel="stylesheet" href="{QUILL}/quill.snow.css">\n'
            '<link rel="stylesheet" href="assets/editor.css">\n')
    scripts = f'<script src="{QUILL}/quill.js" defer></script>\n<script type="module" src="assets/editor.js"></script>\n'
    return page("Writing room", body, description="", page_no=0, head_extra=head, scripts=scripts,
                sidebar=sidebar, body_class="writing")


# ----------------------------------------------------------------- build
def main():
    entries = load_entries()
    clash = RESERVED & set(entries)
    assert not clash, clash
    R = Renderer(entries)

    os.makedirs(os.path.join(SITE, "assets"), exist_ok=True)
    for f in glob.glob(os.path.join(SITE, "*.html")):
        os.remove(f)
    img_out = os.path.join(SITE, "assets", "img")
    shutil.rmtree(img_out, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, "content", "images"), img_out)
    for name in ("style.css", "wiki.js", "editor.css", "book.js", "reader.js", "editor.js", "firebase-config.js"):
        shutil.copy(os.path.join(ROOT, "build", name), os.path.join(SITE, "assets", name))

    random.seed(1)
    articles = {}
    for slug, e in entries.items():
        articles[slug] = render_article(e, R, entries)

    for slug, body in articles.items():
        e = entries[slug]
        bl = sorted(R.backlinks.get(slug, set()) - {slug}, key=lambda s: entries[s]["title"].lower())
        bl = [b for b in bl if b in entries]
        if bl:
            block = ('<details class="meta backlinks"><summary>What links here (' + str(len(bl)) + ')</summary><ul class="chips">'
                     + "".join(f'<li><a href="{b}.html">{html.escape(entries[b]["title"])}</a></li>' for b in bl)
                     + "</ul></details>")
        else:
            block = '<p class="orphan muted">No pages link here. This article is an orphan, like Plankton.</p>'
        body = body.replace("<!--BACKLINKS-->", block)
        with open(os.path.join(SITE, f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(page(e["title"], body, active=slug if slug in CHAPTER_ORDER else e["category"],
                         description=plain(e.get("lead", ""), 150)))

    for c, n, d in CATEGORIES:
        with open(os.path.join(SITE, f"category-{c}.html"), "w", encoding="utf-8") as f:
            f.write(render_category(c, n, d, entries))
    with open(os.path.join(SITE, "all-pages.html"), "w", encoding="utf-8") as f:
        f.write(render_all(entries))
    with open(os.path.join(SITE, "random.html"), "w", encoding="utf-8") as f:
        f.write(render_random(entries))
    book_html = render_book_html()
    with open(os.path.join(SITE, "assets", "book-import.html"), "w", encoding="utf-8") as f:
        f.write(book_html + "\n")
    with open(os.path.join(SITE, "read.html"), "w", encoding="utf-8") as f:
        f.write(render_read(book_html))
    with open(os.path.join(SITE, "write.html"), "w", encoding="utf-8") as f:
        f.write(render_write())
    with open(os.path.join(SITE, "index.html"), "w", encoding="utf-8") as f:
        idx_html = render_index(entries, R)
        f.write(idx_html)
    # Artifact variant of the main page: the publisher adds its own document skeleton.
    head = idx_html.split("<head>", 1)[1].split("</head>", 1)[0]
    head = re.sub(r'<meta (charset|name="viewport")[^>]*>\n?', "", head)
    bodyhtml = idx_html.split("<body>", 1)[1].split("</body>", 1)[0]
    with open(os.path.join(ROOT, "build", "artifact-index.html"), "w", encoding="utf-8") as f:
        f.write(head.strip() + "\n" + bodyhtml.strip() + "\n")

    index = {s: [e["title"], CAT_NAME[e["category"]], plain(e.get("subtitle") or e.get("lead", ""), 90),
                 " ".join(str(v) for k, v in (e.get("infobox") or {}).items() if "alias" in k.lower() or "name" in k.lower())]
             for s, e in entries.items()}
    with open(os.path.join(SITE, "assets", "search-index.js"), "w", encoding="utf-8") as f:
        f.write("window.LOC_INDEX=" + json.dumps(index, ensure_ascii=False) + ";")

    stubs = [s for s, e in entries.items() if e.get("stub")]
    print(f"built {len(entries)} articles + {len(CATEGORIES)} categories; stubs={len(stubs)}; redlinks={sorted(R.redlinks)}")
    if stubs:
        print("stubs:", ", ".join(stubs))


if __name__ == "__main__":
    main()
