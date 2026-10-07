#!/usr/bin/env python3
"""Fetch freely licensed photos (Wikimedia Commons) for entries that are real people or places.

Writes content/images/<file> and content/images.json. Only Commons-hosted images are kept,
so non-free (fair use) lead images are skipped. Credits and licences are recorded for display.
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "content", "images")
UA = "LegendOfChrisWiki/1.0 (personal fan wiki build script)"

# slug -> [(Wikipedia article, caption)]
REAL = {
    # people
    "lebron-james": [("LeBron James", "LeBron James, real-world basketball player")],
    "elon-musk": [("Elon Musk", "Elon Musk, real-world businessman")],
    "mark-zuckerberg": [("Mark Zuckerberg", "Mark Zuckerberg, real-world Meta CEO")],
    "ron-desantis": [("Ron DeSantis", "Ron DeSantis, real-world Governor of Florida")],
    "trumpy-the-red": [("Donald Trump", "Donald Trump, the real-world figure Trumpy the Red is based on")],
    "joeius-bidenias": [("Joe Biden", "Joe Biden, the real-world figure Joeius Bidenias is based on")],
    "dwayne-the-rock-johnson": [("Dwayne Johnson", "Dwayne Johnson, who (despite the canon) exists")],
    "bon-jovi": [("Jon Bon Jovi", "Jon Bon Jovi, frontman of the real-world band Bon Jovi")],
    "rfk": [("Robert F. Kennedy Jr.", "Robert F. Kennedy Jr., the real-world namesake of RFK")],
    "lil-uzi-vert": [("Lil Uzi Vert", "Lil Uzi Vert, real-world rapper")],
    "jeff-bezosi": [("Jeff Bezos", "Jeff Bezos, the real-world figure Jeff Bezosi is based on")],
    "barack-obama": [("Barack Obama", "Barack Obama, real-world 44th U.S. President")],
    "bernie-sanders": [("Bernie Sanders", "Bernie Sanders, real-world U.S. Senator")],
    "putin": [("Vladimir Putin", "Vladimir Putin, real-world President of Russia")],
    "dababy": [("DaBaby", "DaBaby, real-world rapper (unvaporized)")],
    "kanye-west": [("Kanye West", "Kanye West (Ye), real-world rapper")],
    "litl-wayne": [("Lil Wayne", "Lil Wayne, the real-world rapper Litl Wayne is based on")],
    "steve-jobs": [("Steve Jobs", "Steve Jobs, real-world Apple co-founder")],
    "steve-wozniak": [("Steve Wozniak", "Steve Wozniak, real-world Apple co-founder")],
    "tim-apple": [("Tim Cook", "Tim Cook, the real-world “Tim Apple”")],
    "dj-khaled": [("DJ Khaled", "DJ Khaled, real-world DJ and producer")],
    "yuno-miles": [("Yuno Miles", "Yuno Miles, real-world rapper")],
    "kobe-bryant": [("Kobe Bryant", "Kobe Bryant, real-world basketball legend")],
    "drake-batman": [("Drake (musician)", "Drake, the real-world rapper behind Drake Batman")],
    "ninja": [("Ninja (gamer)", "Tyler “Ninja” Blevins, real-world streamer")],
    "john-cena": [("John Cena", "John Cena, real-world wrestler and actor")],
    "d-piddy": [("Sean Combs", "Sean Combs, the real-world music mogul the name resembles")],
    "wemby-curry-bronny": [
        ("Victor Wembanyama", "Victor Wembanyama (Wemby)"),
        ("Stephen Curry", "Stephen Curry"),
        ("Bronny James", "Bronny James"),
    ],
    # places
    "newark": [("Newark, New Jersey", "Newark, New Jersey, birthplace of Chris")],
    "andromeda-galaxy": [("Andromeda Galaxy", "The real Andromeda Galaxy, before Frodo")],
    "canada": [("Canada", "Canada, real-world country (not a Roman empire)")],
    "moscow": [("Moscow", "The real Moscow, which is in Russia, not Italy")],
    "england": [("London", "London, England")],
    "parliament": [("Palace of Westminster", "The Palace of Westminster, home of the real UK Parliament")],
    "constantinople": [("Hagia Sophia", "Hagia Sophia in Istanbul, formerly Constantinople")],
    "flint": [("Flint, Michigan", "Flint, Michigan")],
    "adirondack-park": [("Adirondack Park", "Adirondack Park, New York")],
    "vegas": [("Las Vegas Strip", "The Las Vegas Strip")],
    "united-state-of-america": [("United States", "The real-world United States (plural)")],
    "united-streets-of-ohio": [("Ohio", "Ohio, real-world U.S. state")],
    "o-block": [("O'Block", "The real O'Block (Parkway Gardens), Chicago")],
}


def api(url, tries=6):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or n == tries - 1:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 5 * 2 ** n
            print(f"  rate limited, waiting {wait}s", file=sys.stderr)
            time.sleep(wait)


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


def lookup(title):
    q = urllib.parse.urlencode({"action": "query", "titles": title, "prop": "pageimages",
                                "piprop": "thumbnail|name|original", "pithumbsize": 600,
                                "redirects": 1, "format": "json"})
    data = json.loads(api("https://en.wikipedia.org/w/api.php?" + q))
    page = next(iter(data["query"]["pages"].values()))
    name = page.get("pageimage")
    thumb = (page.get("thumbnail") or {}).get("source")
    if not name or not thumb or "/wikipedia/commons/" not in thumb:
        return None  # no image, or a non-free local upload
    q = urllib.parse.urlencode({"action": "query", "titles": "File:" + name, "prop": "imageinfo",
                                "iiprop": "extmetadata|url", "format": "json"})
    meta = json.loads(api("https://commons.wikimedia.org/w/api.php?" + q))
    info = next(iter(meta["query"]["pages"].values()))["imageinfo"][0]
    em = info.get("extmetadata", {})
    return {
        "thumb": thumb,
        "file": name,
        "artist": strip_html(em.get("Artist", {}).get("value")) or "Unknown",
        "license": strip_html(em.get("LicenseShortName", {}).get("value")) or "see source",
        "source": info.get("descriptionurl"),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(ROOT, "content", "images.json")
    out = json.load(open(path)) if os.path.exists(path) else {}
    missing = []
    for slug, items in REAL.items():
        for i, (title, caption) in enumerate(items):
            if any(x["caption"] == caption for x in out.get(slug, [])):
                continue
            try:
                r = lookup(title)
            except Exception as e:  # network hiccup
                print(f"error {slug}: {e}", file=sys.stderr)
                r = None
            if not r:
                missing.append(f"{slug} ({title})")
                continue
            ext = os.path.splitext(urllib.parse.urlparse(r["thumb"]).path)[1].lower() or ".jpg"
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                ext = ".jpg"
            fname = f"{slug}-{i + 1}{ext}"
            with open(os.path.join(OUT, fname), "wb") as f:
                f.write(api(r["thumb"]))
            out.setdefault(slug, []).append({"src": fname, "caption": caption, "artist": r["artist"],
                                             "license": r["license"], "source": r["source"],
                                             "wiki": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))})
            print(f"ok  {slug}: {r['file']} [{r['license']}]")
            time.sleep(2)
    with open(os.path.join(ROOT, "content", "images.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\n{sum(len(v) for v in out.values())} images for {len(out)} entries; missing: {missing}")


if __name__ == "__main__":
    main()
