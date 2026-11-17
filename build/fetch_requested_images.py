#!/usr/bin/env python3
"""Pictures the author asked for by name, replacing a stand-in.

The author reviewed every stand-in picture (the ones fetch_stand_in_images.py chose) and wrote, for
some of them, what the page should show instead. REQUESTS holds those choices, so they can be
fetched again. Each is a caption and a list of places to look, tried in order:

    W("Title")          the lead picture of a Wikipedia article, when it is on Wikimedia Commons
    WN("Title")         the infobox picture of a Wikipedia article, free or not (logos, characters)
    C("search words")   a Wikimedia Commons photo found by search
    CF("File name.jpg") one exact Wikimedia Commons file
    F("site", "Page")   the page picture of a Fandom wiki article (fictional things)
    FF("site", "words") a picture found by searching a Fandom wiki's files

Pictures the author supplied directly, and the one drawn here, are listed in SUPPLIED: their files
are already in content/images/ and this script leaves them alone.

    python3 build/fetch_requested_images.py [slug ...]     # no slugs = everything in REQUESTS

Needs network access to en.wikipedia.org, commons.wikimedia.org, upload.wikimedia.org,
static.wikia.nocookie.net and the Fandom wikis named below.
"""
import html as _html
import io
import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_more_images as fm          # noqa: E402  (Fandom lookups, save)
import fetch_stand_in_images as fs      # noqa: E402  (Wikipedia and Commons, read as ordinary pages)
fs.PAUSE = 3.0                            # gentler on Wikimedia, which throttles shared servers
from fetch_more_images import ROOT, OUT  # noqa: E402

from PIL import Image                   # noqa: E402

W = lambda title: ("wiki", title)
WN = lambda title: ("wikinonfree", title)
C = lambda query: ("commons", query)
CF = lambda name: ("commonsfile", name)
F = lambda site, title: ("fandom", site, title)
FF = lambda site, query: ("fandomfile", site, query)

REQUESTS = {
    # ---- chapters
    "chapter-2": ("The Galactic Senate, from Star Wars", [F("starwars", "Galactic Senate"), FF("starwars", "Galactic Senate chamber")]),
    "dunder-mifflan-chapter": ("The Dunder Mifflin company logo", [WN("Dunder Mifflin"), C("Dunder Mifflin logo"), W("Dunder Mifflin")]),
    # ---- characters
    "bings-son": ("The Bing logo", [C("Bing Fluent logo"), C("Microsoft Bing logo"), WN("Microsoft Bing")]),
    "elon-mush": ("A caricature of Elon Musk", [CF("Elon Musk - Caricature with money glasses.png"), C("Elon Musk caricature")]),
    "george-constanta": ("George Costanza, from Seinfeld", [F("seinfeld", "George Costanza"), WN("George Costanza")]),
    "golden-freddy": ("Golden Freddy, from Five Nights at Freddy's", [F("freddy-fazbears-pizza", "Golden Freddy")]),
    "harry": ("Daniel Radcliffe", [W("Daniel Radcliffe")]),
    "ioannus-paranukus": ("The flag of Russia", [CF("Flag of Russia.svg"), W("Flag of Russia")]),
    "jinxy": ("Jynxzi, streamer", [W("Jynxzi"), C("Jynxzi")]),
    "julian": ("The flag of Turkey", [CF("Flag of Turkey.svg"), W("Flag of Turkey")]),
    "mf-vroom": ("Chick Hicks, from Cars", [F("pixar", "Chick Hicks")]),
    "mike-schmidt": ("Mike Schmidt, from the Five Nights at Freddy's film", [F("fnaf-the-movie", "Mike Schmidt"), F("freddy-fazbears-pizza", "Mike Schmidt (Film)"), FF("freddy-fazbears-pizza", "Mike Schmidt film")]),
    "osama-bin-bomin": ("Osama bin Laden", [W("Osama bin Laden")]),
    "qxc": ("xQc, streamer", [CF("XQc July 4 2023.jpg"), W("XQc")]),
    "angry-pope": ("Tyler1, streamer", [W("Tyler1"), C("Tyler1 streamer")]),
    "tung-tung-tung-sahur": ("Tung Tung Tung Sahur, the meme", [WN("Tung Tung Tung Sahur"), C("Tung Tung Tung Sahur")]),
    "zarkmuckerberg": ("A caricature of Mark Zuckerberg", [C("Mark Zuckerberg caricature"), C("Mark Zuckerberg DonkeyHotey")]),
    # ---- locations
    "dusty-depot": ("Dusty Divot, from Fortnite", [F("fortnite", "Dusty Divot")]),
    "salty-springs": ("Salty Springs, from Fortnite", [FF("fortnite", "Salty Springs map"), F("fortnite", "Salty Springs")]),
    "the-border": ("The Mexico–United States border wall", [W("Mexico–United States border wall"), C("US Mexico border wall")]),
    "galactic-senate": ("The Galactic Senate, from Star Wars", [F("starwars", "Galactic Senate"), FF("starwars", "Galactic Senate chamber")]),
    # ---- factions
    "charlie-kirks": ("Charlie Kirk", [W("Charlie Kirk")]),
    "knights-of-4chan": ("The 4chan logo", [WN("4chan"), C("4chan logo")]),
    "pol-phi-doros": ("A fraternity house", [C("fraternity house"), C("fraternity house university")]),
    "police-kirks": ("Charlie Kirk", [C("Charlie Kirk car"), C("Charlie Kirk 2024"), C("Charlie Kirk speaking")]),
    "the-boys": ("The Crips", [W("Crips"), C("Crips gang")]),
    "goober-gang": ("The Bloods", [W("Bloods"), C("Bloods gang")]),
    "new-apple-employees": ("Apple employees", [C("Apple Store employees"), C("Apple Store staff")]),
    "tech-bros": ("Steve Jobs in the early 1980s", [C("Steve Jobs Macintosh 1984"), C("Steve Jobs 1984"), C("Steve Jobs young")]),
    # ---- items
    "snapchat-ghost-protocol": ("The Snapchat logo", [C("Snapchat logo"), WN("Snapchat")]),
    "t1-phones": ("The Trump Mobile T1 phone", [WN("Trump Mobile"), C("Trump Mobile T1")]),
    "blue-dust": ("The blue meth from Breaking Bad", [F("breakingbad", "Blue Sky"), C("Breaking Bad blue meth")]),
    "ibeam": ("A spotlight", [C("theatre spotlight"), C("stage spotlight")]),
    "igun": ("A Glock 19", [C("Glock 19 pistol"), W("Glock")]),
    "inav": ("The USS Enterprise, from Star Trek", [WN("USS Enterprise (NCC-1701)"), C("Enterprise NCC-1701 model Smithsonian")]),
    "infinity-blades": ("The Infinity Blade, from Fortnite", [F("fortnite", "Infinity Blade")]),
    "ultra-hand": ("Nintendo's Ultra Hand toy", [WN("Ultra Hand"), C("Nintendo Ultra Hand")]),
    "xp-candy": ("Exp. Candy, from Pokémon", [F("pokemon", "Exp. Candy"), FF("pokemon", "Exp. Candy")]),
    # ---- events
    "night-1": ("Freddy Fazbear's Pizza, from Five Nights at Freddy's", [F("freddy-fazbears-pizza", "Freddy Fazbear's Pizza"), FF("freddy-fazbears-pizza", "Freddy Fazbear's Pizza building")]),
    "rap-battle-club-shadowban": ("The film 8 Mile", [WN("8 Mile (film)")]),
    "the-border-fight": ("The Backrooms", [W("The Backrooms"), C("Backrooms")]),
    "war-for-byzantine-mexico": ("A map of Mexico", [C("Mexico map states"), C("map of Mexico")]),
    # ---- concepts
    "mogging": ("Clavicular, streamer", [W("Clavicular (streamer)"), W("Clavicular (influencer)"), C("Clavicular streamer")]),
    "the-ball": ("A basketball", [W("Basketball (ball)")]),
    # ---- The Epic of Vinny
    "wing-ding-gaster": ("W. D. Gaster, from Deltarune", [F("deltarune", "W. D. Gaster"), F("deltarune", "Gaster"), FF("deltarune", "Gaster")]),
    "friend": ("Friend, from Deltarune", [F("deltarune", "Friend"), FF("deltarune", "Friend")]),
    "john-freedom": ("John Freedom, YouTuber", [C("John Freedom YouTuber"), WN("John Freedom")]),
    "polydoros": ("A Greek man", [C("elderly Greek man"), C("Greek man portrait")]),
    "macbook-charger": ("A MacBook MagSafe charger", [CF("Apple 85W MagSafe 2 Power Adapter (A1424) -8462.jpg"), C("MagSafe power adapter")]),
    "roaring-knight": ("The Roaring Knight, from Deltarune", [F("deltarune", "Roaring Knight"), F("deltarune", "The Roaring Knight")]),
    "starwalker-manager": ("Starwalker, from Deltarune", [F("deltarune", "Starwalker")]),
    "little-saint-james-sea": ("Little Saint James island", [W("Little Saint James, U.S. Virgin Islands"), W("Little Saint James"), C("Little Saint James island")]),
    "dunkin-cult-cruiser": ("A Space Shuttle orbiter", [W("Space Shuttle orbiter"), C("Space Shuttle orbiter in orbit")]),
    "mystery-machine": ("The Mystery Machine, from Scooby-Doo", [F("scoobydoo", "Mystery Machine"), F("scoobydoo", "The Mystery Machine")]),
    "departure-of-the-dunkin-cult": ("A Space Shuttle launch", [C("Space Shuttle launch"), W("STS-1")]),
    "opening-of-the-portal": ("A Nether portal, from Minecraft", [F("minecraft", "Nether Portal"), F("minecraft", "Nether portal")]),
    "roaring-knights-strike": ("The Roaring Knight fight, from Deltarune", [FF("deltarune", "Roaring Knight battle"), FF("deltarune", "Roaring Knight fight"), FF("deltarune", "Knight battle")]),
}

# Files placed by hand: sent by the author with the review, or drawn here.
SUPPLIED = ("chapter-4-point-1", "chris", "quandale-dingle", "son-s-sonionring", "the-redditor", "tyler-from-uber",
            "yuno-miles", "chris-war-crimes", "kanyes-dream", "moscow-bombing", "basement-deal")

NONFREE = "Not a free image; rights belong to its owners"


def from_wiki_nonfree(title):
    """The first infobox picture of a Wikipedia article, whatever its licence (logos, film stills, characters)."""
    url = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    page = fs.fetch(url)
    if not page:
        return None
    h = page.decode("utf-8", "replace")
    box = re.search(r'<table class="infobox.*?</table>', h, re.S)
    m = re.search(r'<img[^>]+src="(//upload\.wikimedia\.org/wikipedia/(en|commons)/[^"]+)"', box.group(0) if box else h)
    if not m:
        return None
    src = "https:" + _html.unescape(m.group(1))
    big = re.sub(r"/(\d+)px-([^/]+)$", lambda x: f"/{max(int(x.group(1)), 500)}px-{x.group(2)}", src)
    return {"url": big, "fallback": src, "artist": "See the Wikipedia file page",
            "license": NONFREE if m.group(2) == "en" else "See the Wikimedia Commons file page", "source": url, "wiki": url, "site": "Wikipedia"}


def save_url(slug, r):
    for u in (r["url"], r.get("fallback")):
        if not u:
            continue
        try:
            raw = fs.fetch(u, tries=2) if "wikimedia" in u else fm.api(u)
        except Exception:
            raw = None
        if not raw:
            continue
        im = Image.open(io.BytesIO(raw)); im.load()
        if im.width < 120:
            continue
        if im.width > 600:
            im = im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS)
        alpha = im.mode in ("RGBA", "LA", "P")
        fname = f"{slug}-1{'.png' if alpha else '.jpg'}"
        im.convert("RGBA" if alpha else "RGB").save(os.path.join(OUT, fname), optimize=True, **({} if alpha else {"quality": 88}))
        return fname
    return None


def find(slug, spec):
    """One place to look -> (file name, credit fields) or None."""
    kind = spec[0]
    if kind in ("wiki", "commons"):
        got = fs.pick_picture(slug, spec[1] if kind == "wiki" else ("commons", spec[1]))
        return (got[0], got[1]) if got else None
    if kind == "commonsfile":
        info = fs.file_info(spec[1])
        fname = info and fs.download(slug, info["path"])
        if fname:
            info["wiki"] = info["source"]
            return fname, info
        return None
    r = from_wiki_nonfree(spec[1]) if kind == "wikinonfree" else (fm.from_fandom if kind == "fandom" else fm.from_fandom_file)(spec[1], spec[2])
    fname = r and save_url(slug, r)
    return (fname, r) if fname else None


def main():
    path = os.path.join(ROOT, "content", "images.json")
    out = json.load(open(path, encoding="utf-8"))
    only = set(sys.argv[1:])
    missed = []
    for slug, (caption, specs) in REQUESTS.items():
        if only and slug not in only:
            continue
        old = [ph["src"] for ph in out.get(slug, [])]
        got = None
        for spec in specs:
            try:
                got = find(slug, spec)
            except Exception as e:
                print(f"  error {slug} {spec}: {e}", file=sys.stderr)
            if got:
                break
        if not got:
            missed.append(slug)
            print(f"--  {slug}: nothing found")
            continue
        fname, info = got
        for f in old:
            if f != fname:
                try:
                    os.remove(os.path.join(OUT, f))
                except OSError:
                    pass
        out[slug] = [{"src": fname, "caption": caption, "artist": info.get("artist") or "Unknown", "license": info["license"],
                      "source": info["source"], "wiki": info.get("wiki") or info["source"], "site": info.get("site", "Wikimedia Commons"),
                      "requested": True}]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"ok  {slug}: {info['source']}  [{info['license']}]")
    if missed:
        print("not found:", ", ".join(missed))


if __name__ == "__main__":
    main()
