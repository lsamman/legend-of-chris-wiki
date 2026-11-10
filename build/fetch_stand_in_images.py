#!/usr/bin/env python3
"""Give every remaining article a picture.

fetch_images.py and fetch_more_images.py cover real people, places and characters from other works.
Everything else in the canon has no picture of its own, so this script picks a freely licensed
Wikimedia Commons photo of the nearest real thing (a basketball for Chris, cell division for
Vellatosis) and says so in the caption. Entries that already have a picture are left alone.

    python3 build/fetch_stand_in_images.py [slug ...]     # no slugs = everything in PICKS
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_more_images import ROOT, OUT, C   # noqa: E402

REAL = "real"     # the picture shows the real thing the article is named after
# slug -> (Wikipedia article or Commons search, more to try if that fails..., optional REAL)
PICKS = {
    # ---- characters
    "chris": ["Basketball (ball)"], "zarkmuckerberg": ["Rocking chair"], "elon-mush": ["Mushroom"], "julian": ["Atlantic puffin"],
    "the-redditor": [C("typing on computer keyboard")], "mic-q": ["Microphone"], "harry": ["Family tree"], "osama-bin-bomin": ["Bomb"],
    "mf-vroom": ["Drag racing"], "tyler-from-uber": ["Taxi"], "qxc": [C("esports tournament stage"), "Esports"], "jinxy": ["Four-leaf clover"],
    "george-constanta": ["Constanța"], "ioannus-paranukus": ["Calculator"], "ye-olde-bin": ["Waste container"], "fs-martin-genius": ["Albert Einstein"],
    "angry-pope": ["Papal tiara"], "bings-son": ["Bing cherry", "Cherry"], "yuno-miles": [C("rapper on stage microphone"), "Hip hop music"],
    "tung-tung-tung-sahur": ["Bedug", "Baseball bat"], "son-s-sonionring": ["Onion ring"], "yeat": ["Yeat", C("concert stage lights crowd"), REAL],
    "quandale-dingle": ["Football helmet"], "mike-schmidt": ["Security guard"], "god": ["Crepuscular rays"], "the-micheal-voice": ["Megaphone"],
    "golden-freddy": ["Teddy bear"], "john-freedom": ["Bald eagle"], "bucee": ["Beaver"], "kilroy": ["Kilroy was here", REAL], "uncle-sam": ["Uncle Sam", REAL],
    "ludwig": ["Ludwig Ahgren", C("live streaming setup microphone monitors"), REAL], "macbook-charger": ["MagSafe"], "the-vellas": ["Cell division"],
    "vinny": ["Cashier"], "tyrone": ["Fast-food restaurant"], "garret": [C("forklift operator warehouse"), "Forklift"], "random-customer": ["Wendy's"],
    "black-cat": ["Black cat"], "friend": [C("black cat yellow eyes"), "Cat"], "wing-ding-gaster": ["Wingdings", "Dingbat"], "eram": ["Sail"],
    "normal-parrot": ["Parrot"], "roaring-knight": ["Knight"], "vinnys-boss": ["Flag of the United Kingdom"], "claude": ["Humanoid robot"],
    "ai-shadow-figure": ["Shadow"], "ai-shadow-butler": ["Butler"], "polydoros": [C("ancient Greek vase warrior"), "Pottery of ancient Greece"],
    "great-double-whopper-with-cheese-god": ["Whopper"], "aesop-rock": ["Aesop Rock", REAL], "del-the-funky-homosapien": ["Del the Funky Homosapien", REAL],
    "will-vella": ["Bagel"], "starwalker-manager": ["Dunkin' Donuts", "Doughnut shop"],
    # ---- factions
    "middle-aged-men": [C("middle-aged men group portrait"), "Middle age"], "tech-bros": ["Silicon Valley"], "baller-army": ["Dab (dance)", C("dab dance")],
    "projects-royal-family": ["Crown"], "myspace-relic-keepers": ["Reliquary"], "knights-of-4chan": ["Knights Templar"], "lost-society-of-ballers": ["Streetball"],
    "all-knowing-overseers": ["Eye of Providence"], "new-crips": ["Kerchief", "Bandana"], "google-smart-guards": ["Googleplex"], "litl-empire": ["Lilliput and Blefuscu", "Roman Empire"],
    "goober-gang": ["Peanut"], "barack-empire": ["White House"], "local-mafia": ["Fedora"], "department-of-awesomeness": ["Thumb signal"],
    "charlie-kirks": ["Casino"], "police-kirks": ["Police car"], "the-boys": ["Friendship"], "alpha-mogger-beta": ["Fraternities and sororities"],
    "pol-phi-doros": ["Greek alphabet"], "ton-robots": ["Industrial robot"], "the-wozniaks": ["Wii"], "new-apple-employees": ["Apple Park"],
    "united-homies-of-america": ["Flag of the United States"], "vigorous-v": ["V sign"], "ss-vessel-crew": ["Sailor"], "ai-shadow-figures": ["Shadow play"],
    "the-ai": ["Server (computing)"], "laid-off-workers": [C("unemployment line 1930s"), "Unemployment"], "dunkin-cult": ["Doughnut"],
    # ---- concepts
    "the-ball": ["Ball"], "balling": ["Slam dunk"], "why-do-we-believe": ["The Thinker"], "social-media-teachings": ["Social media"], "nfl-poisoning": ["American football"],
    "ethereal-green-dot": [C("green laser pointer dot"), "Laser pointer"], "ha-women": ["Laughter"], "toyota-corolla": ["Toyota Corolla", REAL], "unc-standard-time": ["Clock"],
    "the-wormhole": ["Wormhole", REAL], "5g": ["5G", REAL], "one-more-thing": ["Stevenote", "Steve Jobs"], "erger-wings": ["Buffalo wing"], "field-of-gambling": ["Roulette"],
    "lobster": ["Lobster", REAL], "the-prophecy": ["Pythia"], "chicken-hour": ["Fried chicken"], "mogging": ["Bodybuilding"], "goober": ["Boiled peanuts"],
    "pog": ["Milk caps (game)"], "aight-bet": ["Handshake"], "airpower": ["Power supply"], "two-time-teleportation": [C("peace sign hand gesture"), "V sign"],
    "aesopian": ["Aesop"], "ways-of-freedom": ["Statue of Liberty"], "super-bowl-96": ["Super Bowl XXX", "Vince Lombardi Trophy"], "great-double-whopper-with-cheese-war": ["Burger King"],
    "final-prophecy": ["Oracle"], "age-of-claude": ["Graphics processing unit"], "vellatosis": ["Mitosis"], "no-clip": [C("empty room yellow wallpaper"), "Wall"],
    "nuh-uh-yuh-huh": ["Argument", C("two people arguing")], "lying": ["Pinocchio"], "word-shit-diss-track": [C("recording studio microphone"), "Recording studio"],
    "the-epic-of-vinny": ["Epic poetry", "Manuscript"],
    # ---- events
    "the-cycle": ["Ouroboros"], "baller-army-attack": [C("dab dance pose"), "Dance"], "great-oppression": ["Chain"], "multiverse-civil-war": ["Multiverse", "Galaxy"],
    "the-snap": ["Finger snapping", "Hand"], "cooking-of-the-universe": ["Surf and turf"], "great-famine": [C("empty plate fork knife"), "Plate (dishware)"],
    "the-merging": ["Galaxy merger", "Interacting galaxy"], "stabbing-of-chris": ["Dagger"], "quest-73-taco-bells": ["Taco Bell", REAL], "war-for-byzantine-mexico": ["Byzantine Empire"],
    "donkey-kong-racing-duel": ["Kart racing"], "moscow-bombing": ["Moscow"], "mcdonalds-wine-brewing-contest": ["Wine"], "dq-mcdonalds-beef": ["Dairy Queen"],
    "siege-of-the-senate": ["Roman Senate"], "nuh-uh-debate": ["Debate"], "chris-war-crimes": ["Dolly (sheep)"], "housing-crash": ["Foreclosure", "2008 financial crisis"],
    "operation-desert-storm": ["Gulf War"], "fall-of-constantinople": ["Fall of Constantinople", REAL], "weezing-of-kanye": ["Inhaler"], "super-bowl": ["Super Bowl", REAL],
    "rap-battle-club-shadowban": ["Battle rap", C("rap battle crowd")], "iphone-keynote": ["iPhone 3G", REAL], "roulette-bet": [C("roulette wheel casino"), "Roulette"],
    "gawk-ination-2039": ["Crowd"], "verse-wide-tour": [C("tour bus concert"), "Concert"], "casino-heist": ["Bank vault"], "spaceport-chase": ["Spaceport"],
    "oblock-coup": ["Parkway Gardens", "Coup d'état"], "fortnite-island-wars": ["Island"], "the-border-fight": ["Border"], "basement-deal": ["Basement"],
    "salty-springs-ambush": ["Ambush"], "smiting-of-yeat": ["Lightning"], "kanyes-dream": ["Dream"], "night-1": ["Night"], "mystery-machine-crash": ["Traffic collision"],
    "teleport-to-austin": ["Texas State Capitol"], "freedom-road-trip": ["U.S. Route 66", REAL], "claude-livestreams": ["Live streaming"],
    "reversal-of-the-louisiana-purchase": ["Louisiana Purchase", REAL], "battle-of-louisiana": ["Battle of New Orleans"], "day-of-the-bagel-man": ["Bagel and cream cheese", "Bagel"],
    "departure-of-the-dunkin-cult": ["Rocket launch", "Space Shuttle"], "end-of-the-age-of-claude": ["Sunrise"], "back-to-the-register": ["Cash register"],
    "banishing-of-the-ai": ["Luddite"], "ton-618-conquest": ["Quasar"], "independence-day-1995": ["Independence Day (United States)", REAL], "forklift-incident": [C("forklift in warehouse"), "Warehouse"],
    "cat-in-the-box": [C("cat sitting in cardboard box"), "Cardboard box"], "friend-abduction": ["Liminal space (aesthetic)", "Corridor"], "little-saint-james-detour": ["Saint Thomas, U.S. Virgin Islands"],
    "roaring-knights-strike": ["Man overboard", "Lifebuoy"], "claude-smash-match": ["GameCube controller"], "opening-of-the-portal": ["Portal (architecture)"],
    "claude-escape": [C("open cage door"), "Cage"], "clash-over-the-usa": ["Grand Teton"], "dunkin-alliance": ["Iced coffee"], "final-battle-with-ton-618": ["Black hole"],
    # ---- items
    "settings": ["Gear"], "myspace": ["Myspace", C("Myspace logo"), REAL], "medeas-tesseract": ["Tesseract"], "bible-of-battle-passes": ["Gutenberg Bible"], "openable-door": ["Door"],
    "galaxy-gas": ["Whipped-cream charger"], "propane": ["Propane", C("propane tank"), REAL], "blue-dust": ["Copper(II) sulfate"], "ye-the-gas": ["Gas cylinder"], "laugh-exe": ["Smiley"],
    "sacred-apps": ["Mobile app"], "snapchat-ghost-protocol": ["Snapchat", C("ghost costume white sheet")], "inav": ["Satellite navigation device"], "igun": ["Water gun"], "ibeam": ["I-beam"],
    "facetime-laser": ["Laser"], "t1-phones": ["Mobile phone"], "jeffrey-epstein-statue": ["Colossi of Memnon", "Statue"], "xp-candy": ["Candy"], "kromer": ["Coin"],
    "purple-juice": ["Grape juice"], "i-cant-put-down-the-cup": ["Plastic cup"], "ultra-hand": ["Ultra Hand", "Reacher"], "infinity-blades": ["Sword"], "lambo-tonka": ["Tonka", "Monster truck"],
    "golden-plaque": ["Commemorative plaque"], "flashlight-and-covid-mask": ["Flashlight"], "mystery-machine": ["Mystery Machine", "Volkswagen Type 2", "Van"], "wii-play": ["Wii Remote"],
    "uha-ford-f150": ["Ford F-Series", REAL], "dunkin-cult-cruiser": ["Spacecraft"], "bagel-man-cloak": ["Cloak"], "double-whopper-with-cheese": ["Cheeseburger"],
    "great-double-whopper-with-cheese": ["Hamburger"], "vinnys-sword": ["Longsword"], "titanium-armor": ["Plate armour"], "shadow-cape": ["Cape"], "black-knife": ["Knife"],
    "forklift": ["Forklift", REAL], "the-fork": ["Fork"], "five-below-watch": ["Watch"], "super-smash-bros-wii-u": ["Wii U", REAL], "wordle": ["Wordle", C("Wordle game grid"), REAL],
    "rum-and-coke": ["Rum and Coke", REAL], "spyglass": ["Telescope"], "pretzel-bun-baconator": ["Pretzel"],
    # ---- locations
    "minor-miner-universe": ["Mining"], "call-of-duty-lobbies": ["Call of Duty", "Gamer"], "galactic-senate": ["United States Senate chamber", "Senate"], "planet-patrick": ["Starfish"],
    "8aller-jump-street": ["Basketball court"], "dusty-depot": ["Warehouse"], "the-court": ["Courtroom"], "the-border": [C("border checkpoint booth"), "Border control"],
    "salty-springs": ["Hot spring"], "earth-new-jersey": ["New Jersey", REAL], "wawa": ["Wawa (company)", REAL], "austin-texas": ["Austin, Texas", REAL], "bucees-hq": ["Buc-ee's", REAL],
    "american-garage": ["Garage (residential)"], "louisiana": ["Louisiana", REAL], "great-data-center": ["Data center"], "burger-king-dark-world": [C("Burger King restaurant at night"), "Night"],
    "garth": ["Exoplanet"], "boston": ["Boston", REAL], "burger-king-boston": [C("Burger King restaurant exterior"), "Burger King"], "freezer": [C("walk-in freezer"), "Refrigerator"],
    "backrooms": ["The Backrooms", C("empty office yellow"), REAL], "little-saint-james-sea": ["Caribbean Sea"], "little-saint-james-island": ["Little Saint James, U.S. Virgin Islands", REAL],
    "ai-shadow-realm": [C("deep sea darkness"), "Abyssal zone"], "claudes-castle": ["Neuschwanstein Castle"], "ss-vessel": ["Sailing ship"], "united-states-of-america": ["United States", REAL],
    "wyoming": ["Wyoming", REAL], "dunkin-wyoming": ["Dunkin' Donuts", "Doughnut shop"], "the-portal": ["Torii"],
    # ---- chapters
    "chapter-before-chapter-2": ["Big Bang"], "chapter-2": ["Florida"], "chapter-triangle": ["Triangle"], "chapter-the-fourth": ["Ohio"], "dunder-mifflan-chapter": ["Paper"],
    "flashback-chapter": ["Apple I"], "chapter-maybe-seventh": ["Las Vegas Strip"], "chapter-4-point-1": ["TurboGrafx-16"], "chapter-new-jersey": ["Chuck E. Cheese", "Pizza"],
}

# second choices, tried when the first pick has no usable Commons photo (an SVG diagram, say, or a non-free lead image)
FALLBACKS = {
    "mf-vroom": "drag racing car", "random-customer": "customer at fast food counter", "wing-ding-gaster": "pirate captain costume", "eram": "sail on a ship",
    "lost-society-of-ballers": "basketball players outdoor court", "pol-phi-doros": "Greek letters carved stone", "new-apple-employees": "Apple Store employees",
    "dunkin-cult": "doughnuts", "5g": "cell tower antenna", "pog": "milk caps game", "no-clip": "empty hallway", "quest-73-taco-bells": "Taco Bell restaurant",
    "war-for-byzantine-mexico": "Byzantine mosaic", "nuh-uh-debate": "debate stage podium", "chris-war-crimes": "cloned sheep", "weezing-of-kanye": "asthma inhaler",
    "super-bowl": "Super Bowl stadium", "rap-battle-club-shadowban": "rap battle", "spaceport-chase": "spaceport launch pad", "the-border-fight": "border fence",
    "basement-deal": "basement room", "salty-springs-ambush": "ambush", "kanyes-dream": "sleeping person dream", "night-1": "night sky city", "freedom-road-trip": "Route 66 sign",
    "claude-livestreams": "streamer desk setup", "back-to-the-register": "cash register", "claude-smash-match": "GameCube controller", "clash-over-the-usa": "Wyoming mountains",
    "settings": "gear icon", "medeas-tesseract": "tesseract hypercube", "openable-door": "open door", "galaxy-gas": "nitrous oxide canister", "inav": "GPS navigation device",
    "igun": "water pistol", "ibeam": "steel I-beam", "facetime-laser": "laser beam", "t1-phones": "old mobile phones", "xp-candy": "wrapped candy", "i-cant-put-down-the-cup": "red plastic cup",
    "ultra-hand": "reaching grabber tool", "infinity-blades": "sword", "golden-plaque": "bronze plaque", "wii-play": "Wii Remote", "shadow-cape": "black cape", "five-below-watch": "wristwatch",
    "wordle": "crossword puzzle grid", "spyglass": "brass telescope", "minor-miner-universe": "mine shaft", "call-of-duty-lobbies": "gaming computer", "dusty-depot": "dusty warehouse",
    "the-court": "courtroom", "bucees-hq": "Buc-ee's gas station", "american-garage": "garage with American flag", "garth": "planet", "little-saint-james-sea": "Caribbean sea",
}
FALLBACKS.update({"super-bowl": "football stadium night game", "rap-battle-club-shadowban": "hip hop concert", "kanyes-dream": "bed pillow bedroom", "night-1": "moonlit night street",
                  "claude-livestreams": "computer monitor microphone desk", "galaxy-gas": "gas cylinder", "call-of-duty-lobbies": "video game players", "dusty-depot": "abandoned warehouse"})
for _slug, _q in FALLBACKS.items():
    if _slug in PICKS and C(_q) not in PICKS[_slug]:
        PICKS[_slug] = PICKS[_slug] + [C(_q)]



# Wikimedia's API refuses anonymous requests from shared cloud addresses, so this reads the ordinary
# pages instead, slowly: the article's lead picture, the file's page on Commons (author, licence),
# and the standard 330px rendering of the file.
import html as _html
import io
import re
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

UA2 = "LegendOfChrisWiki/1.1 (https://lsamman.github.io/legend-of-chris-wiki/; fan wiki build script)"
PAUSE = 1.2


def fetch(url, tries=4):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA2})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            time.sleep(PAUSE)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code not in (429, 503) or n == tries - 1:
                raise
            time.sleep(8 * (n + 1))


def commons_path(url):
    """.../wikipedia/commons/thumb/8/85/Name.jpg/1280px-Name.jpg -> ('8/85', 'Name.jpg'); None if not on Commons."""
    m = re.search(r"/wikipedia/commons/(?:thumb/)?([0-9a-f]/[0-9a-f]{2})/([^/?]+)", url)
    return (m.group(1), urllib.parse.unquote(m.group(2))) if m else None


def lead_image(title):
    page = fetch("https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")))
    if not page:
        return None
    m = re.search(r'<meta property="og:image" content="([^"]+)"', page.decode("utf-8", "replace"))
    return commons_path(_html.unescape(m.group(1))) if m else None


def search_files(query):
    page = fetch("https://commons.wikimedia.org/w/index.php?" + urllib.parse.urlencode(
        {"search": query + " filetype:bitmap", "title": "Special:MediaSearch", "type": "image"}))
    names = re.findall(r'href="https://commons\.wikimedia\.org/wiki/File:([^"]+)"', (page or b"").decode("utf-8", "replace"))
    return [urllib.parse.unquote(n) for n in names if re.search(r"\.(jpe?g|png)$", n, re.I)][:4]


def file_info(name):
    """Author, licence and storage path of a Commons file, from its page."""
    url = "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(name.replace(" ", "_"))
    page = fetch(url)
    if not page:
        return None
    h = page.decode("utf-8", "replace").replace("&#95;", "_")
    lic = re.search(r'licensetpl_short"[^>]*>([^<]+)<', h)
    og = re.search(r'<meta property="og:image" content="([^"]+)"', h)
    path = commons_path(_html.unescape(og.group(1))) if og else None
    if not lic or not path:
        return None
    aut = re.search(r'id="fileinfotpl_aut"[^>]*>.*?</td>\s*<td[^>]*>(.*?)</td>', h, re.S)
    artist = re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", "", aut.group(1)))).strip() if aut else ""
    return {"path": path, "artist": artist or "Unknown", "license": _html.unescape(lic.group(1)).strip(), "source": url, "site": "Wikimedia Commons"}


def download(slug, path):
    folder, name = path
    q = urllib.parse.quote(name)
    extra = ".png" if name.lower().endswith(".svg") else ""
    for width in (330, 250, 500):
        try:
            raw = fetch(f"https://upload.wikimedia.org/wikipedia/commons/thumb/{folder}/{q}/{width}px-{q}{extra}", tries=1)
        except urllib.error.HTTPError:
            raw = None
        if raw:
            break
    if not raw:
        return None
    im = Image.open(io.BytesIO(raw)); im.load()
    if im.width < 150:
        return None
    has_alpha = im.mode in ("RGBA", "LA", "P")
    fname = f"{slug}-1{'.png' if has_alpha else '.jpg'}"
    im.convert("RGBA" if has_alpha else "RGB").save(os.path.join(OUT, fname), optimize=True, **({} if has_alpha else {"quality": 88}))
    return fname


def pick_picture(slug, pick):
    """One pick (a Wikipedia title, or C("a Commons search")) -> (file name, info, subject) or None."""
    if isinstance(pick, tuple):
        names, wiki = search_files(pick[1]), None
    else:
        lead = lead_image(pick)
        names = [lead[1]] if lead else []
        wiki = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(pick.replace(" ", "_"))
    for name in names:
        if re.search(r"\.(gif|webm|ogv|tiff?)$", name, re.I):
            continue
        info = file_info(name)
        if not info:
            continue
        fname = download(slug, info["path"])
        if fname:
            info["wiki"] = wiki or info["source"]
            subject = pick if isinstance(pick, str) else re.sub(r"[_]+", " ", name.rsplit(".", 1)[0])
            return fname, info, subject
    return None


def main():
    path = os.path.join(ROOT, "content", "images.json")
    out = json.load(open(path, encoding="utf-8"))
    only = set(sys.argv[1:])
    missing = []
    for slug, picks in PICKS.items():
        if (only and slug not in only) or out.get(slug):
            continue
        real = REAL in picks
        got = None
        for pick in [p for p in picks if p != REAL]:
            try:
                got = pick_picture(slug, pick)
            except Exception as e:
                print(f"error {slug} {pick}: {e}", file=sys.stderr, flush=True)
            if got:
                break
        if not got:
            missing.append(slug)
            print(f"--  {slug}: nothing found", flush=True)
            continue
        fname, info, subject = got
        out[slug] = [{"src": fname, "caption": subject if real else f"{subject}. A stand-in picture: the canon has no picture of this.",
                      "artist": info["artist"], "license": info["license"], "source": info["source"], "wiki": info["wiki"], "site": info["site"],
                      **({} if real else {"standin": True})}]
        print(f"ok  {slug}: {subject} [{info['license']}]", flush=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\nmissing ({len(missing)}): {' '.join(missing)}", flush=True)


if __name__ == "__main__":
    main()
