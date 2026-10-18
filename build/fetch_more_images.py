#!/usr/bin/env python3
"""Fetch pictures for the characters, places, items and groups that have none yet.

Fictional characters come from the matching Fandom wiki (page image). Everything else is a
photo from Wikimedia Commons, found by search. Credits go in content/images.json; the build shows them.
Entries that already have pictures are left alone, and so are ones nothing was found for.

    python3 build/fetch_more_images.py [slug ...]     # no slugs = everything in SPECS
"""
import html
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "content", "images")
UA = "LegendOfChrisWiki/1.0 (personal fan wiki build script)"
WIDTH = 600

F = lambda site, title: ("fandom", site, title)      # Fandom wiki page image
C = lambda query: ("commons", query)                 # a Commons photo found by search
FF = lambda site, query: ("fandomfile", site, query)   # a picture found by searching a Fandom wiki's files
W = lambda title: ("wiki", title)                    # Wikipedia's lead image, if it is on Commons

SPECS = {
    # ---------------- fictional characters: Fandom
    "plankton": [F("spongebob", "Plankton")],
    "hank-hill": [F("kingofthehill", "Hank Hill")],
    "jesse-pinkman": [F("breakingbad", "Jesse Pinkman")],
    "walter-white": [F("breakingbad", "Walter White")],
    "gus-fring": [F("breakingbad", "Gustavo Fring")],
    "quagmire": [F("familyguy", "Glenn Quagmire")],
    "peter-griffin-ringtone": [F("familyguy", "Peter Griffin")],
    "lightning-mcqueen": [F("pixar", "Lightning McQueen"), F("cars", "Lightning McQueen")],
    "mr-bean": [F("mrbean", "Mr. Bean")],
    "agent-007": [F("jamesbond", "James Bond")],
    "steve-from-minecraft": [F("minecraft", "Steve")],
    "spamton": [F("deltarune", "Spamton G. Spamton")],
    "spamton-neo": [F("deltarune", "Spamton NEO")],
    "grogu": [F("starwars", "Grogu")],
    "frodo": [F("lotr", "Frodo Baggins")],
    "samwise": [F("lotr", "Samwise Gamgee")],
    "young-sheldon": [F("bigbangtheory", "Sheldon Cooper"), F("youngsheldon", "Sheldon Cooper")],
    "larry-the-cucumber": [F("veggietales", "Larry the Cucumber")],
    "snoopy-mcspookintosh": [F("peanuts", "Snoopy")],
    "lil-jokez": [F("dc", "Joker")],
    "tung-tung-tung-sahur": [F("italianbrainrot", "Tung Tung Tung Sahur"), F("brainrot", "Tung Tung Tung Sahur")],
    "scott-the-woz": [F("scottthewoz", "Scott Wozniak"), F("scottthewoz", "Scott the Woz")],
    "medea": [W("Medea"), C("Medea Delacroix painting")],
    "jason": [W("Jason"), C("Jason and the Golden Fleece painting")],
    "ton-618": [W("TON 618"), C("TON 618 black hole")],
    "chatgpt": [C("ChatGPT logo")],
    "siri": [C("Siri logo")],
    "microsoft-bing": [C("Bing logo")],
    "the-redditor": [C("Reddit Snoo logo")],
    # ---------------- locations
    "dunder-mifflin": [F("theoffice", "Dunder Mifflin")],
    "cyber-city": [F("deltarune", "Cyber City")],
    "darkworld-state-university": [F("deltarune", "Dark World")],
    "gotham-city": [F("dc", "Gotham City")],
    "nether-dimension": [F("minecraft", "The Nether"), F("minecraft", "Nether")],
    "galactic-senate": [F("starwars", "Galactic Senate")],
    "shadow-realm": [F("yugioh", "Shadow Realm")],
    "freddy-fazbears-pizza": [F("freddy-fazbears-pizza", "Freddy Fazbear's Pizza"), F("fnaf", "Freddy Fazbear's Pizza")],
    "port-a-potty-portal": [C("portable toilets row")],
    "quick-check": [C("convenience store interior")],
    "the-67-casino": [C("casino floor slot machines")],
    "sector-1-99": [C("slot machines casino Las Vegas")],
    "stairway-to-heaven": [C("Haiku Stairs Stairway to Heaven Hawaii")],
    "la-walmart": [C("abandoned Walmart store")],
    "abandoned-walmarts": [C("abandoned Walmart building")],
    "the-vault": [C("bank vault door")],
    "yeezy-reserve": [C("oil refinery at night")],
    "chai-town": [C("masala chai tea street stall")],
    "the-endless-pit": [C("Bingham Canyon open pit mine")],
    "reformed-travis-scott-sector": [C("Orion Nebula Hubble")],
    "paper-belt": [C("asteroid belt illustration")],
    "the-sign": [C("giant LED sign Times Square")],
    "vending-machine-labyrinth": [C("rows of vending machines Japan")],
    "cod-hq": [C("Activision Blizzard headquarters Santa Monica")],
    "xbox-live-dungeons": [C("Xbox 360 console")],
    "chambers-360": [C("Xbox 360 console controller")],
    "protestant-universe": [C("Wittenberg Castle Church door Luther")],
    "projects-national-spaceport": [C("Kennedy Space Center launch pad")],
    "koolaid-college": [C("university campus brick building")],
    "dpf-facility-69420": [C("diesel particulate filter")],
    "the-court": [C("indoor basketball court")],
    "projects-national-archives": [C("National Archives Building Washington")],
    "club-shadowban": [C("nightclub dance floor lights")],
    "meme-portal": [C("wormhole illustration")],
    "shadow-filtered-theater": [C("Steve Jobs Theater Apple Park")],
    "turbografx-16-sector": [C("TurboGrafx-16 console")],
    "smoke-and-vape-shop": [C("vape shop interior")],
    "ecsm-airport": [C("airport terminal interior")],
    "popeyes": [C("Popeyes restaurant")],
    "twelve-towers": [C("skyscrapers skyline towers")],
    "kanye-system": [C("solar system planets")],
    "corner-store-ohio": [C("corner store Ohio")],
    "i-38-west": [C("Interstate highway sign West")],
    "the-projects": [C("public housing high-rise Chicago")],
    "uniontown-system": [W("Uniontown, Pennsylvania")],
    "multiverse": [C("Hubble Ultra-Deep Field")],
    "universe-prime": [C("Hubble Ultra-Deep Field galaxies")],
    "timeline-r": [C("cosmic web simulation")],
    "reality-42-b": [C("galaxy cluster Hubble")],
    "cringe-universe": [C("spiral galaxy Hubble")],
    "america-universe": [C("American flag waving")],
    "byzantine-empire-of-mexico": [C("Flag of the Palaiologos Byzantine Empire")],
    "soviet-union-of-north-korea": [C("Flag of North Korea")],
    "democratic-republic-of-the-chinese": [C("Flag of China")],
    "new-jersey-system": [C("Jersey City skyline")],
    "scotts-house": [C("suburban house Ohio")],
    "island-of-logic-and-retoric": [C("small tropical island aerial")],
    "21-jump-street": [C("21 Jump Street church")],
    # ---------------- items
    "nfts": [C("Bored Ape Yacht Club")],
    "verizon-contract": [C("Verizon store logo")],
    "golden-scar": [C("FN SCAR rifle")],
    "oil": [C("crude oil barrels")],
    "doritos": [C("Doritos chips")],
    "red-bull": [C("Red Bull can")],
    "g-fuel": [C("G Fuel energy drink")],
    "nokia-i-4500": [C("Nokia flip phone")],
    "file-cabinet": [C("filing cabinet office")],
    "mercedes-benz-system-cruiser": [C("Mercedes-Benz Sprinter van")],
    "metal-folding-chair": [C("metal folding chair")],
    "hantavirus-vaccine": [C("vaccine vial syringe")],
    "mountain-dew": [C("Mountain Dew bottle")],
    "kromer": [F("deltarune", "Kromer"), F("deltarune", "Spamton G. Spamton")],
    "windows-phone": [C("Nokia Lumia Windows Phone")],
    "modded-colonial-musket": [C("Brown Bess flintlock musket")],
    "honda-accord-2005": [C("2005 Honda Accord")],
    "fortnite": [C("Fortnite logo")],
    "microsd-card": [C("microSD card")],
    "prius-of-destiny": [C("Toyota Prius")],
    "zuck-tears-usb": [C("USB flash drive")],
    "808s-and-apocalypses": [C("Roland TR-808 drum machine")],
    "bluetooth-gargoyles": [C("gargoyle Notre-Dame de Paris")],
    "iphone-3g": [C("iPhone 3G")],
    "gods-router": [C("wireless router")],
    "snapchat-ghost-protocol": [C("Snapchat logo")],
    "facebook-pre-cringe": [C("Facebook logo")],
    "airtag": [C("Apple AirTag")],
    "zyn": [C("Zyn nicotine pouches")],
    "diet-dr-pepper": [C("Diet Dr Pepper can")],
    "ipod-touch": [C("iPod Touch")],
    "vine": [C("Vine app logo")],
    "tesla-motorcade": [C("Tesla Model S")],
    "the-pager": [C("pager Motorola")],
    "seven-chaos-emeralds": [F("sonic", "Chaos Emeralds")],
    "glock-19": [C("Glock 19")],
    "propane": [C("propane tank")],
    "crack-van": [C("recreational vehicle RV motorhome")],
    "prime": [C("Prime Hydration drink")],
    "twitter": [C("Twitter X logo")],
    "lightsaber": [F("starwars", "Lightsaber")],
    "master-chef": [F("halo", "Master Chief")],
    "apple-podcasts": [C("Apple Podcasts logo")],
    "chalkboards": [C("classroom chalkboard")],
    "truth-social": [C("Truth Social logo")],
    "myspace": [C("Myspace logo")],
    "imdb": [C("IMDb logo")],
    "ultra-hand": [C("Nintendo Ultra Hand toy")],
    "gex-enter-the-gecko": [F("gex", "Gex: Enter the Gecko"), C("Gex Enter the Gecko Nintendo 64")],
    "wii-cube": [C("Nintendo Wii console")],
    "tesla-roadsters-2028": [C("Tesla Roadster")],
    # ---------------- factions
    "european-union": [C("Flag of Europe")],
    "flip-phone-covenant": [C("flip phone")],
    "department-of-defense": [C("The Pentagon aerial")],
    "mcdonalds": [C("McDonald's restaurant")],
    "dairy-queen": [C("Dairy Queen restaurant")],
    "chick-fil-a-loyalists": [C("Chick-fil-A restaurant")],
    "jedi": [F("starwars", "Jedi Order")],
    "los-polos-harmonicas": [C("harmonica")],
}


# second pass: better searches for the ones the first pass got wrong or missed
SPECS.update({
    "ton-618": [C("quasar accretion disc artist's impression")],
    "microsoft-bing": [C("Microsoft headquarters Redmond building")],
    "the-redditor": [C("Reddit alien Snoo mascot")],
    "yeezy-reserve": [C("oil pumpjack sunset")],
    "paper-belt": [C("asteroid belt diagram solar system")],
    "the-court": [C("basketball court hardwood arena")],
    "ecsm-airport": [C("small airport terminal exterior")],
    "oil": [C("oil pumpjack")],
    "red-bull": [C("Red Bull energy drink can")],
    "bluetooth-gargoyles": [C("gargoyle statue stone")],
    "gods-router": [C("Wi-Fi router")],
    "snapchat-ghost-protocol": [C("Snapchat ghost logo")],
    "the-pager": [C("alphanumeric pager beeper")],
    "propane": [C("propane cylinders")],
    "myspace": [C("Myspace logo")],
    "truth-social": [C("Truth Social app icon")],
    "department-of-defense": [C("Seal of the United States Department of Defense")],
    "european-union": [C("European Union flag circle of stars")],
    "los-polos-harmonicas": [C("harmonica instrument")],
    "tesla-roadsters-2028": [C("Tesla Roadster 2008 red")],
    "mr-bean": [F("mrbean", "Mr. Bean"), C("Rowan Atkinson")],
    "agent-007": [F("jamesbond", "James Bond (Daniel Craig)"), C("007 gun logo")],
    "spamton": [F("deltarune", "Spamton"), F("deltarune", "Spamton G. Spamton")],
    "spamton-neo": [F("deltarune", "Spamton NEO"), F("deltarune", "Spamton")],
    "galactic-senate": [F("starwars", "Galactic Senate"), F("starwars", "Galactic Republic")],
    "chai-town": [C("masala chai glass cup")],
    "the-sign": [C("neon sign night")],
    "kromer": [F("deltarune", "[Big Shot]"), F("deltarune", "Kromer")],
    "ultra-hand": [C("Ultra Hand Nintendo 1966 toy")],
    "gex-enter-the-gecko": [F("gex", "Gex: Enter the Gecko"), F("gex", "Gex")],
    "jedi": [F("starwars", "Jedi"), C("Jedi Order symbol Star Wars")],
})

SPECS.update({"propane": [C("propane tank barbecue grill cylinder")], "european-union": [C("Berlaymont building European Commission Brussels")], "myspace": [C("Myspace logo Tom")]})
SW, DR = "scott-the-woz", "deltarune"
SPECS.update({
    "scott-the-woz": [F(SW, "Scott Wozniak"), F(SW, "Scott Wozniak (actor)")],
    "jerry-attricks": [F(SW, "Jerry Attricks")],
    "rex-mohs": [F(SW, "Rex Mohs")],
    "jerry-jab": [F(SW, "Jeb Jab")],
    "hector-andfriends": [F(SW, "Hector Andfriends")],
    "throats-for-thought": [F(SW, "Throats for Thought")],
    "officer-steelwool": [F(SW, "Steel Wool")],
    "gex-enter-the-gecko": [F(SW, "Gex: Enter the Gecko")],
    "dick-vitales-awesome-baby": [F(SW, 'Dick Vitale\'s "Awesome Baby" College Hoops')],
    "madden-nfl-08-argument": [F(SW, "Madden NFL")],
    "spamton": [F(DR, "Spamton"), FF(DR, "Spamton")],
    "spamton-neo": [FF(DR, "Spamton NEO"), F(DR, "Spamton")],
    "kromer": [FF(DR, "Kromer"), FF(DR, "Dark Dollar")],
    "determination": [F(DR, "Determination")],
})
REDO = set("ton-618 microsoft-bing the-redditor yeezy-reserve paper-belt the-court ecsm-airport oil red-bull bluetooth-gargoyles gods-router snapchat-ghost-protocol the-pager propane myspace truth-social department-of-defense european-union los-polos-harmonicas tesla-roadsters-2028".split())


def api(url, tries=6):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or n == tries - 1:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 5 * 2 ** n
            print(f"  rate limited, waiting {wait}s", file=sys.stderr)
            time.sleep(wait)


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


def get(base, **params):
    return json.loads(api(base + "?" + urllib.parse.urlencode(params)))


def from_fandom(site, title):
    base = f"https://{site}.fandom.com/api.php"
    d = get(base, action="query", titles=title, prop="pageimages", piprop="thumbnail", pithumbsize=WIDTH,
            redirects=1, format="json")
    page = next(iter(d["query"]["pages"].values()))
    thumb = (page.get("thumbnail") or {}).get("source")
    name = page["title"]
    if not thumb and "missing" not in page:
        # no lead image: take the first real picture on the page
        d = get(base, action="query", titles=title, prop="images", imlimit=30, redirects=1, format="json")
        files = [i["title"] for i in next(iter(d["query"]["pages"].values())).get("images", [])
                 if re.search(r"\.(png|jpe?g)$", i["title"], re.I) and not re.search(r"icon|logo|stub|infobox|template|flag", i["title"], re.I)]
        if files:
            d = get(base, action="query", titles=files[0], prop="imageinfo", iiprop="url", iiurlwidth=WIDTH, format="json")
            info = next(iter(d["query"]["pages"].values())).get("imageinfo")
            thumb = info and (info[0].get("thumburl") or info[0]["url"])
    if not thumb:
        return None
    return {"url": thumb, "title": name, "artist": f"{site} Fandom wiki contributors",
            "license": "Fandom wiki image; rights belong to its owners",
            "source": f"https://{site}.fandom.com/wiki/{urllib.parse.quote(name.replace(' ', '_'))}",
            "site": f"{site.capitalize()} Fandom wiki", "wiki": f"https://{site}.fandom.com/wiki/{urllib.parse.quote(name.replace(' ', '_'))}"}


def from_fandom_file(site, query):
    base = f"https://{site}.fandom.com/api.php"
    d = get(base, action="query", generator="search", gsrsearch=query, gsrnamespace=6, gsrlimit=8, prop="imageinfo",
            iiprop="url|mime|size", iiurlwidth=WIDTH, format="json")
    pages = sorted((d.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    for p in pages:
        info = (p.get("imageinfo") or [None])[0]
        if info and info.get("mime") in ("image/png", "image/jpeg") and (info.get("width") or 0) >= 200:
            name = p["title"].replace("File:", "")
            return {"url": info.get("thumburl") or info["url"], "title": name.rsplit(".", 1)[0], "artist": f"{site} Fandom wiki contributors",
                    "license": "Fandom wiki image; rights belong to its owners", "source": f"https://{site}.fandom.com/wiki/File:{urllib.parse.quote(name.replace(' ', '_'))}",
                    "site": f"{site.capitalize()} Fandom wiki", "wiki": f"https://{site}.fandom.com/wiki/File:{urllib.parse.quote(name.replace(' ', '_'))}"}
    return None


def commons_info(page):
    info = (page.get("imageinfo") or [None])[0]
    if not info or info.get("mime") not in ("image/jpeg", "image/png"):
        return None
    if (info.get("width") or 0) < 400:
        return None
    em = info.get("extmetadata", {})
    lic = strip_html(em.get("LicenseShortName", {}).get("value")) or ""
    if not lic or re.search(r"non-?free|fair use", lic, re.I):
        return None
    return {"url": info.get("thumburl") or info["url"], "title": page["title"].replace("File:", ""),
            "artist": strip_html(em.get("Artist", {}).get("value")) or "Unknown", "license": lic,
            "source": info["descriptionurl"], "site": "Wikimedia Commons", "wiki": info["descriptionurl"]}


def from_commons(query):
    d = get("https://commons.wikimedia.org/w/api.php", action="query", generator="search",
            gsrsearch=query + " filetype:bitmap", gsrnamespace=6, gsrlimit=10, prop="imageinfo",
            iiprop="url|mime|size|extmetadata", iiurlwidth=WIDTH, format="json")
    pages = sorted((d.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    for p in pages:
        r = commons_info(p)
        if r:
            return r
    return None


def from_wiki(title):
    d = get("https://en.wikipedia.org/w/api.php", action="query", titles=title, prop="pageimages",
            piprop="thumbnail|name", pithumbsize=WIDTH, redirects=1, format="json")
    page = next(iter(d["query"]["pages"].values()))
    name, thumb = page.get("pageimage"), (page.get("thumbnail") or {}).get("source")
    if not name or not thumb or "/wikipedia/commons/" not in thumb:
        return None
    m = get("https://commons.wikimedia.org/w/api.php", action="query", titles="File:" + name, prop="imageinfo",
            iiprop="url|mime|size|extmetadata", iiurlwidth=WIDTH, format="json")
    r = commons_info(next(iter(m["query"]["pages"].values())))
    if r:
        r["wiki"] = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    return r


def find(spec):
    kind = spec[0]
    if kind == "fandom":
        return from_fandom(spec[1], spec[2])
    if kind == "fandomfile":
        return from_fandom_file(spec[1], spec[2])
    if kind == "commons":
        return from_commons(spec[1])
    return from_wiki(spec[1])


def save(slug, r):
    raw = api(r["url"])
    im = Image.open(io.BytesIO(raw))
    im.load()
    if im.width < 150:
        return None
    if im.width > WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    has_alpha = im.mode in ("RGBA", "LA", "P")
    ext = ".png" if has_alpha else ".jpg"
    fname = f"{slug}-1{ext}"
    im = im.convert("RGBA" if has_alpha else "RGB")
    im.save(os.path.join(OUT, fname), optimize=True, **({} if has_alpha else {"quality": 85}))
    return fname


def main():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(ROOT, "content", "images.json")
    out = json.load(open(path, encoding="utf-8"))
    only = set(sys.argv[1:])
    if "--redo" in only:
        only.discard("--redo")
        only = only or REDO
        for slug in only:
            for ph in out.pop(slug, []):
                try:
                    os.remove(os.path.join(OUT, ph["src"]))
                except OSError:
                    pass
    missing = []
    for slug, specs in SPECS.items():
        if (only and slug not in only) or out.get(slug):
            continue
        got = None
        for spec in specs:
            try:
                got = find(spec)
            except Exception as e:
                print(f"error {slug} {spec}: {e}", file=sys.stderr)
            if got:
                try:
                    fname = save(slug, got)
                except Exception as e:
                    print(f"error saving {slug}: {e}", file=sys.stderr)
                    fname = None
                if fname:
                    break
                got = None
            time.sleep(0.5)
        if not got:
            missing.append(slug)
            print(f"--  {slug}: nothing found")
            continue
        out[slug] = [{"src": fname, "caption": got["title"].rsplit(".", 1)[0] if got["site"] == "Wikimedia Commons" else got["title"],
                      "artist": got["artist"], "license": got["license"], "source": got["source"],
                      "wiki": got["wiki"], "site": got["site"]}]
        print(f"ok  {slug}: {got['title']} [{got['site']}]")
        time.sleep(0.5)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\nmissing: {missing}")


if __name__ == "__main__":
    main()
