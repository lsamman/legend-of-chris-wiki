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
from fetch_more_images import ROOT, OUT, W, C, find, save   # noqa: E402

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
    "minor-miner-universe": ["Mining"], "call-of-duty-lobbies": ["LAN party"], "galactic-senate": ["United States Senate chamber", "Senate"], "planet-patrick": ["Starfish"],
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


def main():
    path = os.path.join(ROOT, "content", "images.json")
    out = json.load(open(path, encoding="utf-8"))
    only = set(sys.argv[1:])
    missing = []
    for slug, picks in PICKS.items():
        if (only and slug not in only) or out.get(slug):
            continue
        real = REAL in picks
        got = fname = None
        for pick in [p for p in picks if p != REAL]:
            spec = pick if isinstance(pick, tuple) else W(pick)
            try:
                got = find(spec)
                fname = save(slug, got) if got else None
            except Exception as e:
                print(f"error {slug} {spec}: {e}", file=sys.stderr)
                got = fname = None
            if fname:
                subject = pick if isinstance(pick, str) else got["title"].rsplit(".", 1)[0]
                break
            time.sleep(0.3)
        if not fname:
            missing.append(slug)
            print(f"--  {slug}: nothing found")
            continue
        out[slug] = [{"src": fname, "caption": subject if real else f"{subject}. A stand-in picture: the canon has no picture of this.",
                      "artist": got["artist"], "license": got["license"], "source": got["source"], "wiki": got["wiki"], "site": got["site"],
                      **({} if real else {"standin": True})}]
        print(f"ok  {slug}: {subject}")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        time.sleep(0.3)
    print(f"\nmissing ({len(missing)}): {' '.join(missing)}")


if __name__ == "__main__":
    main()
