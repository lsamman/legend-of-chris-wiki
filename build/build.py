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
RESERVED = {"index", "all-pages", "search", "random"}

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
def nav_html(active=None):
    links = "".join(
        f'<li><a href="category-{c}.html"{" aria-current=page" if active == c else ""}>{n}</a></li>'
        for c, n, _ in CATEGORIES)
    chapters = "".join(
        f'<li><a href="{s}.html"{" aria-current=page" if active == s else ""}>{html.escape(CHAPTER_SHORT[s])}</a></li>'
        for s in CHAPTER_ORDER)
    return f"""
<nav class="sidebar" aria-label="Wiki navigation">
  <div class="side-box">
    <div class="side-head">Navigation</div>
    <ul>
      <li><a href="index.html">Main Page</a></li>
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


def page(title, body, *, active=None, description="", page_no=None):
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
</head>
<body>
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
  {nav_html(active)}
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
</body>
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
    for name in ("style.css", "wiki.js"):
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
