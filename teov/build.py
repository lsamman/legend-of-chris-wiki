#!/usr/bin/env python3
"""Generator for The Epic of Vinny Wiki.

A spin-off wiki that lives inside the Legend Of Chris site, in site/epic-of-vinny/.
Reads teov/content/*.json and writes the site, with its own look. Run directly, or through
python3 build/build.py, which runs it last.
"""
import glob
import hashlib
import html
import json
import os
import random
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "teov")
CONTENT = os.path.join(SRC, "content")
ASSETS = os.path.join(SRC, "assets")
OUT = os.path.join(ROOT, "site", "epic-of-vinny")
LOC_MAP_IMAGES = os.path.join(ROOT, "content", "maps")

SITE_NAME = "The Epic of Vinny Wiki"
RESERVED = {"index", "all-pages", "timeline", "random"}
CATEGORIES = [
    ("chapters", "Chapters", "The story so far: a prologue and three chapters."),
    ("characters", "Characters", "A Burger King cashier, a pirate captain, an AI king and a Bagel Man."),
    ("locations", "Locations", "Garth, the backrooms, a ship, a castle of AI and a Dunkin in Wyoming."),
    ("factions", "Factions", "Crews, teams, cults and the banished AI."),
    ("items", "Items", "Double Whoppers, a fork, a knife, a cape and a very unfair controller."),
    ("concepts", "Concepts & Lore", "Prophecies, theories, and the advanced technique of lying."),
    ("events", "Events", "Everything that happens, in order."),
]
CAT_NAME = {c[0]: c[1] for c in CATEGORIES}
LINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]")


# ----------------------------------------------------------------- load
def load_loc():
    """Slug -> title for every Legend Of Chris article (the crossover links must point at real pages)."""
    out = {}
    for path in glob.glob(os.path.join(ROOT, "content", "entries", "*.json")):
        with open(path, encoding="utf-8") as f:
            for e in json.load(f):
                if e.get("slug"):
                    out[e["slug"]] = e["title"]
    return out


def load_entries():
    entries = {}
    for path in sorted(glob.glob(os.path.join(CONTENT, "*.json"))):
        if os.path.basename(path) == "maps.json":      # the list of maps, not articles
            continue
        with open(path, encoding="utf-8") as f:
            for e in json.load(f):
                if e["slug"] in entries:
                    raise SystemExit(f"teov: duplicate slug {e['slug']}")
                entries[e["slug"]] = e
    return entries


def version(files):
    h = hashlib.sha1()
    for path in sorted(f for f in files if os.path.isfile(f)):
        h.update(os.path.relpath(path, ROOT).encode())
        with open(path, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:10]


# ----------------------------------------------------------------- markup
class Renderer:
    def __init__(self, entries, loc):
        self.entries, self.loc = entries, loc
        self.backlinks = {s: set() for s in entries}
        self.current = None
        self.errors = []

    def title_of(self, slug):
        return self.entries[slug]["title"]

    def inline(self, text):
        text = html.escape(str(text), quote=False)

        def link(m):
            target = m.group(1).strip()
            if target.startswith("loc:"):      # a page of the Legend Of Chris wiki
                slug = target[4:].lower()
                if slug not in self.loc:
                    self.errors.append(f"{self.current}: [[{target}]] is not a Legend Of Chris article")
                    return m.group(0)
                return f'<a class="loc-link" href="../{slug}.html">{m.group(2) or html.escape(self.loc[slug])}</a>'
            slug = target.lower()
            if slug not in self.entries:
                self.errors.append(f"{self.current}: [[{target}]] is not an article")
                return m.group(0)
            if self.current and slug != self.current:
                self.backlinks[slug].add(self.current)
            return f'<a href="{slug}.html">{m.group(2) or html.escape(self.title_of(slug))}</a>'

        text = LINK_RE.sub(link, text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
        return text

    def block(self, text):
        return "\n".join(f"<p>{self.inline(p.strip())}</p>" for p in str(text).split("\n\n") if p.strip())


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


TITLES = {}   # slug -> title, so summaries show "Boston", not "boston"


def plain(text, n=160):
    t = LINK_RE.sub(lambda m: m.group(2) or TITLES.get(m.group(1).strip().lower(), m.group(1)), str(text))
    t = re.sub(r"[*>#]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"


# ----------------------------------------------------------------- layout
LOGO = ('<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#5b21b6"/>'
        '<path d="M7 9h8l5 15 5-15h8L24 33h-8z" fill="#ffcf5c"/></svg>')


def nav_html(entries, active=None):
    cats = "".join(f'<li><a href="category-{c}.html"{" aria-current=page" if active == c else ""}>{n}</a></li>'
                   for c, n, _ in CATEGORIES)
    chapters = "".join(f'<li><a href="{s}.html"{" aria-current=page" if active == s else ""}>{html.escape(entries[s]["title"])}</a></li>'
                       for s in entries if entries[s]["category"] == "chapters")
    return f"""
<nav class="side" aria-label="Wiki navigation">
  <div class="box">
    <div class="box-head">Navigation</div>
    <ul>
      <li><a href="index.html"{" aria-current=page" if active == "index" else ""}>Main Page</a></li>
      <li><a href="timeline.html"{" aria-current=page" if active == "timeline" else ""}>Timeline</a></li>
      <li><a href="all-pages.html"{" aria-current=page" if active == "all-pages" else ""}>All pages (A–Z)</a></li>
      <li><a href="random.html" class="random-link">Random page</a></li>
    </ul>
  </div>
  <div class="box"><div class="box-head">Categories</div><ul>{cats}</ul></div>
  <div class="box"><div class="box-head">The story</div><ul class="chaps">{chapters}</ul></div>
  <a class="back-box" href="../index.html"><b>← The Legend Of Chris Wiki</b><span>The multiverse this story is set in</span></a>
</nav>"""


def page(entries, title, body, *, active=None, description="", head_extra="", scripts="", ver=""):
    doc_title = SITE_NAME if title is None else f"{title} | {SITE_NAME}"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(doc_title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<script>try{{var t=localStorage.getItem('teov-theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<link rel="stylesheet" href="assets/style.css?v={ver}">
{head_extra}</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="index.html">{LOGO}<span>The Epic of Vinny <b>Wiki</b></span></a>
    <form class="search" action="all-pages.html" role="search" onsubmit="return false">
      <input id="q" type="search" placeholder="Search the story…" autocomplete="off" aria-label="Search the wiki">
      <ul id="results" role="listbox" hidden></ul>
    </form>
    <a class="loc-btn" href="../index.html" title="Back to The Legend Of Chris Wiki"><span aria-hidden="true">←</span> <span class="loc-btn-text">Legend Of Chris</span></a>
    <button class="theme-btn" type="button" aria-label="Toggle light and dark" title="Toggle light and dark">◐</button>
    <button class="menu-btn" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
  </div>
</header>
<div class="shell">
  {nav_html(entries, active)}
  <main class="sheet">
    {body}
    <footer class="foot">The Epic of Vinny Wiki: a fan wiki for <i>The Epic of Vinny</i> by brennan oleary, a spin-off set in the <a href="../index.html">Legend Of Chris</a> multiverse. The story is unfinished.</footer>
  </main>
</div>
<script src="assets/search-index.js?v={ver}"></script>
<script src="assets/wiki.js?v={ver}"></script>
{scripts}</body>
</html>
"""


# ----------------------------------------------------------------- pages
def chips(items):
    return '<ul class="chips">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def render_article(e, R, entries, loc, maps, ver):
    slug, cat = e["slug"], e["category"]
    R.current = slug
    parts = []
    parts.append(f'<h1 class="title">{html.escape(e["title"])}</h1>')
    crumbs = f'<a href="category-{cat}.html">{CAT_NAME[cat]}</a>'
    sub = e.get("subtitle")
    parts.append(f'<p class="crumbs">From {SITE_NAME} · {crumbs}' + (f' · <span class="subtitle">{R.inline(sub)}</span>' if sub else "") + "</p>")

    info = e.get("infobox") or {}
    img = e.get("image")
    if info or img:
        rows = "".join(f"<tr><th>{R.inline(k)}</th><td>{R.inline(v)}</td></tr>" for k, v in info.items())
        fig = ""
        if img:
            fig = (f'<figure class="ib-img"><a href="assets/{img["file"]}" target="_blank" rel="noopener">'
                   f'<img src="assets/{img["file"]}?v={ver}" alt="{html.escape(img["alt"])}" loading="lazy"></a>'
                   f'<figcaption>{R.inline(img.get("caption", ""))}</figcaption></figure>')
        parts.append(f'<aside class="infobox"><div class="ib-title">{html.escape(e["title"])}</div>{fig}<table>{rows}</table>'
                     f'<div class="ib-cat">{CAT_NAME[cat]}</div></aside>')

    q = e.get("quote")
    if q:
        parts.append(f'<figure class="textbox"><blockquote>{R.inline(q["text"])}</blockquote>'
                     + (f'<figcaption>— {R.inline(q["by"])}</figcaption>' if q.get("by") else "") + "</figure>")

    parts.append(f'<div class="lead">{R.block(e["lead"])}</div>')

    secs = e.get("sections") or []
    if len(secs) >= 3:
        toc = "".join(f'<li><a href="#{slugify(s["heading"])}">{html.escape(s["heading"])}</a></li>' for s in secs)
        parts.append(f'<nav class="toc" aria-label="Contents"><div class="toc-head">Contents</div><ol>{toc}</ol></nav>')
    for s in secs:
        parts.append(f'<section><h2 id="{slugify(s["heading"])}">{html.escape(s["heading"])}</h2>{R.block(s["body"])}</section>')
    if e.get("trivia"):
        parts.append('<section><h2 id="trivia">Trivia</h2><ul>' + "".join(f"<li>{R.inline(t)}</li>" for t in e["trivia"]) + "</ul></section>")

    if cat == "chapters":
        order = [s for s in entries if entries[s]["category"] == "chapters"]
        i = order.index(slug)
        prev_, next_ = (order[i - 1] if i else None), (order[i + 1] if i + 1 < len(order) else None)
        parts.append('<div class="chapnav">'
                     + (f'<a href="{prev_}.html">← {html.escape(entries[prev_]["title"])}</a>' if prev_ else "<span></span>")
                     + (f'<a href="{next_}.html">{html.escape(entries[next_]["title"])} →</a>' if next_ else "<span>Next chapter: not yet written</span>")
                     + "</div>")

    for m in maps:
        if slug in m["places"]:
            parts.append(f'<p class="on-map">On the map: <a href="{m["href"]}">{html.escape(m["title"])}</a> →</p>')

    if e.get("loc"):
        items = ""
        for c in e["loc"]:
            if c["slug"] not in loc:
                R.errors.append(f"{slug}: loc crossover {c['slug']!r} is not a Legend Of Chris article")
                continue
            items += f'<li><a class="loc-link" href="../{c["slug"]}.html">{html.escape(loc[c["slug"]])}</a>: {R.inline(c["note"])}</li>'
        parts.append(f'<aside class="crossover"><h2 id="in-the-legend-of-chris">In The Legend Of Chris</h2><ul>{items}</ul></aside>')

    apps = [a for a in (e.get("appearances") or []) if a in entries]
    if apps and cat != "chapters":
        for a in apps:
            R.backlinks[a].add(slug)
        parts.append('<section class="meta"><h2 id="appearances">Appearances</h2>'
                     + chips(f'<a href="{a}.html">{html.escape(entries[a]["title"])}</a>' for a in apps) + "</section>")
    rel = [r for r in (e.get("related") or []) if r in entries and r != slug]
    if rel:
        for r in rel:
            R.backlinks[r].add(slug)
        parts.append('<section class="meta"><h2 id="see-also">See also</h2>'
                     + chips(f'<a href="{r}.html">{html.escape(entries[r]["title"])}</a>' for r in rel) + "</section>")
    parts.append("<!--BACKLINKS-->")
    parts.append(f'<div class="catbar">Category: <a href="category-{cat}.html">{CAT_NAME[cat]}</a></div>')
    R.current = None
    return "\n".join(parts)


def render_index(entries, R, ver):
    counts = {c: sum(1 for e in entries.values() if e["category"] == c) for c, _, _ in CATEGORIES}
    R.current = "index"
    trivia = [(s, t) for s, e in entries.items() for t in e.get("trivia", [])]
    random.Random(95).shuffle(trivia)
    dyk = "".join(f"<li><a class='dyk-src' href='{s}.html'><b>{html.escape(entries[s]['title'])}</b></a>: {R.inline(t)}</li>" for s, t in trivia[:6])
    portals = "".join(f'<a class="portal" href="category-{c}.html"><span class="portal-n">{counts[c]}</span>'
                      f'<span class="portal-name">{n}</span><span class="portal-d">{d}</span></a>' for c, n, d in CATEGORIES)
    chapters = "".join(f'<li><a href="{s}.html"><b>{html.escape(entries[s]["title"])}</b><span>{html.escape(entries[s]["subtitle"])}</span></a></li>'
                       for s in entries if entries[s]["category"] == "chapters")
    vinny = entries["vinny"]
    feat = R.block(vinny["lead"])
    R.current = None
    body = f"""
<section class="hero">
  <div class="hero-mark">{LOGO}</div>
  <p class="hero-kicker">A spin-off of The Legend Of Chris</p>
  <h1 class="hero-title">The Epic of Vinny</h1>
  <p class="hero-by">by brennan oleary</p>
  <p class="hero-meta">Planet <a href="garth.html">Garth</a> · <a href="kanye-system.html">The Kanye System</a> · 1995 to 1996</p>
  <p class="hero-btns"><a class="btn primary" href="chapter-1.html">Start at Chapter 1</a> <a class="btn" href="timeline.html">Timeline</a> <a class="btn gold" href="../index.html">← Legend Of Chris Wiki</a></p>
</section>
<p class="drop">Welcome to <b>{SITE_NAME}</b>, the free encyclopedia about <i>The Epic of Vinny</i>: the story of Vinny B. James, a Boston Burger King cashier who ends up in the backrooms, on a pirate ship and in a kingdom of banished AI, all on one Fourth of July. We currently document <b>{len(entries)}</b> articles from a prologue and three chapters. <b>The story is still being written.</b></p>
<div class="stat"><b>98.578462849224%</b><span>of the time, someone in the Kanye System orders a Double Whopper with Cheese.</span></div>
<div class="home-grid">
  <section class="home-box">
    <h2>Featured article</h2>
    <a class="feat-title" href="vinny.html">{html.escape(vinny["title"])}</a>
    {feat}
    <p><a href="vinny.html">Read more →</a></p>
  </section>
  <section class="home-box">
    <h2>Did you know…</h2>
    <ul class="dyk">{dyk}</ul>
  </section>
</div>
<h2 class="home-h">Browse the story</h2>
<div class="portals">{portals}</div>
<h2 class="home-h">The chapters</h2>
<ol class="canon">{chapters}</ol>
<h2 class="home-h">Part of the multiverse</h2>
<div class="crossover wide">
  <p>This story is set on <a href="garth.html">Garth</a>, a planet in the Kanye System, in the same multiverse as <i>The Legend Of Chris</i>. Elements cross over: <a class="loc-link" href="../kanye-system.html">The Kanye System</a>, <a class="loc-link" href="../ton-618.html">TON 618</a>, <a class="loc-link" href="../shadow-realm.html">the Shadow Realm</a>, <a class="loc-link" href="../kanye-west.html">Kanye West</a> and <a class="loc-link" href="../chatgpt.html">ChatGPT</a>.</p>
  <p><a class="btn gold" href="../index.html">← The Legend Of Chris Wiki</a> <a class="btn" href="../timeline.html">Legend Of Chris timeline</a> <a class="btn" href="../maps.html#map-garth">Map of Garth</a></p>
</div>
"""
    return page(entries, None, body, active="index", description="A fan wiki for The Epic of Vinny, a spin-off set in the Legend Of Chris multiverse.", ver=ver)


def render_category(entries, cat, name, desc, ver):
    items = sorted((e for e in entries.values() if e["category"] == cat),
                   key=lambda e: list(entries).index(e["slug"]) if cat == "chapters" else e["title"].lower().lstrip("\"“[ "))
    lis = "".join(f'<li><a href="{e["slug"]}.html">{html.escape(e["title"])}</a><span class="cat-desc">{html.escape(plain(e.get("subtitle") or e["lead"], 120))}</span></li>' for e in items)
    body = (f'<h1 class="title">{name}</h1><p class="crumbs">{html.escape(desc)} · {len(items)} pages</p>'
            f'<input class="filter" type="search" placeholder="Filter this category…" aria-label="Filter this category">'
            f'<ul class="catlist">{lis}</ul>')
    return page(entries, f"Category: {name}", body, active=cat, description=desc, ver=ver)


def render_all(entries, ver):
    groups = {}
    for e in entries.values():
        k = re.sub(r"^[^A-Za-z0-9]+", "", e["title"])[:1].upper() or "#"
        groups.setdefault("#" if k.isdigit() else k, []).append(e)
    keys = sorted(groups, key=lambda k: (k != "#", k))
    jump = "".join(f'<a href="#l-{k}">{k}</a>' for k in keys)
    blocks = "".join(f'<h2 id="l-{k}">{k}</h2><ul class="az">' + "".join(
        f'<li><a href="{e["slug"]}.html">{html.escape(e["title"])}</a> <small>{CAT_NAME[e["category"]]}</small></li>'
        for e in sorted(groups[k], key=lambda e: re.sub(r"^[^a-z0-9]+", "", e["title"].lower()))) + "</ul>" for k in keys)
    body = f'<h1 class="title">All pages</h1><p class="crumbs">{len(entries)} articles, alphabetically.</p><div class="jump">{jump}</div>{blocks}'
    return page(entries, "All pages", body, active="all-pages", description="Every article on the wiki.", ver=ver)


def render_random(entries, ver):
    body = ('<h1 class="title">Random page</h1><p>Rolling for a random article…</p>'
            '<script>var k=Object.keys(window.TEOV_INDEX||{});if(k.length)location.replace(k[Math.floor(Math.random()*k.length)]+".html");</script>')
    return page(entries, "Random page", body, ver=ver)


def render_timeline(entries, R, ver):
    evs = sorted((e for e in entries.values() if e.get("timeline")), key=lambda e: e["timeline"]["order"])
    R.current = "timeline"
    groups = [("Before the story", "Backstory told in Chapter 1.", lambda w: w.startswith("Before")),
              ("The story so far", "Only the first day is dated: July 4th, 1995. Later times are presumed.", lambda w: not w.startswith(("Before", "Later"))),
              ("Flash-forward", "Told first, in the prologue, but it happens after everything else.", lambda w: w.startswith("Later"))]
    out = ""
    for name, note, test in groups:
        lis = ""
        for e in evs:
            if not test(e["timeline"]["when"]):
                continue
            ch = next((a for a in e.get("appearances", []) if a in entries), None)
            lis += (f'<li class="tl-item"><span class="tl-when">{html.escape(e["timeline"]["when"])}</span>'
                    f'<a class="tl-name" href="{e["slug"]}.html">{html.escape(e["title"])}</a>'
                    f'<span class="tl-sub">{R.inline(e["subtitle"])}</span>'
                    + (f'<span class="tl-ch">Told in <a href="{ch}.html">{html.escape(entries[ch]["title"])}</a></span>' if ch else "") + "</li>")
        out += f'<h2 id="{slugify(name)}">{name}</h2><p class="muted">{note}</p><ol class="tl">{lis}</ol>'
    R.current = None
    body = ('<h1 class="title">Timeline</h1><p class="crumbs">Every event in <i>The Epic of Vinny</i> in the order it happens, not the order it is told · '
            f'{len(evs)} events</p><p>The story is set from 1995 to 1996. So far it covers a prologue and three chapters, starting on July 4th, 1995. '
            'See the <a class="loc-link" href="../timeline.html">Legend Of Chris timeline</a> for where these events sit in the multiverse.</p>' + out)
    return page(entries, "Timeline", body, active="timeline", description="The events of The Epic of Vinny in order.", ver=ver)


# ----------------------------------------------------------------- build
def main():
    entries, loc = load_entries(), load_loc()
    TITLES.update({s: e["title"] for s, e in entries.items()})
    clash = RESERVED & set(entries)
    if clash:
        raise SystemExit(f"teov: reserved slugs used: {clash}")
    chapter_slugs = {s for s, e in entries.items() if e["category"] == "chapters"}
    for s, e in entries.items():
        if e["category"] not in CAT_NAME:
            raise SystemExit(f"teov: {s}: unknown category {e['category']!r}")
        for k in ("related", "appearances"):
            for t in e.get(k, []):
                if t not in entries:
                    raise SystemExit(f"teov: {s}: {k} {t!r} is not an article")
        for a in e.get("appearances", []):
            if a not in chapter_slugs:
                raise SystemExit(f"teov: {s}: appearance {a!r} is not a chapter")

    maps_path = os.path.join(CONTENT, "maps.json")
    maps = json.load(open(maps_path, encoding="utf-8")) if os.path.exists(maps_path) else []
    for m in maps:
        for p in m["places"]:
            if p not in entries:
                raise SystemExit(f"teov: map {m['title']!r}: {p!r} is not an article")

    files = (glob.glob(os.path.join(CONTENT, "*")) + glob.glob(os.path.join(ASSETS, "*")) + [os.path.abspath(__file__)]
             + glob.glob(os.path.join(LOC_MAP_IMAGES, "garth.png")))
    ver = version(files)

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, "assets"))
    for name in os.listdir(ASSETS):
        shutil.copyfile(os.path.join(ASSETS, name), os.path.join(OUT, "assets", name))
    garth_png = os.path.join(LOC_MAP_IMAGES, "garth.png")
    if os.path.exists(garth_png):
        shutil.copyfile(garth_png, os.path.join(OUT, "assets", "garth-map.png"))

    R = Renderer(entries, loc)
    bodies = {s: render_article(e, R, entries, loc, maps, ver) for s, e in entries.items()}
    pages = {"index": render_index(entries, R, ver), "all-pages": render_all(entries, ver),
             "random": render_random(entries, ver), "timeline": render_timeline(entries, R, ver)}
    for c, n, d in CATEGORIES:
        pages[f"category-{c}"] = render_category(entries, c, n, d, ver)
    if R.errors:
        raise SystemExit("teov: broken links:\n  " + "\n  ".join(sorted(set(R.errors))))

    for slug, body in bodies.items():
        e = entries[slug]
        bl = sorted(R.backlinks.get(slug, set()) - {slug, "index", "timeline"}, key=lambda s: entries[s]["title"].lower())
        bl = [b for b in bl if b in entries]
        block = ('<details class="meta backlinks"><summary>What links here (' + str(len(bl)) + ')</summary>' + chips(f'<a href="{b}.html">{html.escape(entries[b]["title"])}</a>' for b in bl) + "</details>"
                 if bl else '<p class="orphan muted">No pages link here yet.</p>')
        pages[slug] = page(entries, e["title"], body.replace("<!--BACKLINKS-->", block),
                           active=slug if e["category"] == "chapters" else e["category"],
                           description=plain(e["lead"], 150), ver=ver)
    for name, text in pages.items():
        with open(os.path.join(OUT, f"{name}.html"), "w", encoding="utf-8") as f:
            f.write(text)

    index = {s: [e["title"], CAT_NAME[e["category"]], plain(e.get("subtitle") or e["lead"], 90)] for s, e in entries.items()}
    with open(os.path.join(OUT, "assets", "search-index.js"), "w", encoding="utf-8") as f:
        f.write("window.TEOV_INDEX=" + json.dumps(index, ensure_ascii=False) + ";")
    print(f"teov: built {len(entries)} articles + {len(CATEGORIES)} categories into site/epic-of-vinny/")


if __name__ == "__main__":
    main()
