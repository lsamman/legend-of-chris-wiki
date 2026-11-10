# Draws content/maps/garth.png: the United States on Garth, with Vinny's route through The Epic of Vinny.
# State and country borders come from Natural Earth (public domain), which is not kept in this repository:
#   https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
#   (ne_50m_admin_0_countries.geojson and ne_50m_admin_1_states_provinces.geojson)
# Usage: python3 teov/garth_map.py <countries.geojson> <states.geojson> content/maps/garth.png     (needs Pillow)
import sys, json, math
from PIL import Image, ImageDraw, ImageFont

countries_path, states_path, out = sys.argv[1:4]
S = 2                                   # draw at double size, then shrink: smooth edges
W, H = 2000, 1240
LON0, LAT0 = math.radians(-92), math.radians(34)

def laea(lon, lat):                     # Lambert azimuthal equal-area, centred on the middle of the country
    l, p = math.radians(lon), math.radians(lat)
    k = math.sqrt(2 / (1 + math.sin(LAT0) * math.sin(p) + math.cos(LAT0) * math.cos(p) * math.cos(l - LON0)))
    return k * math.cos(p) * math.sin(l - LON0), k * (math.cos(LAT0) * math.sin(p) - math.sin(LAT0) * math.cos(p) * math.cos(l - LON0))

corners = [laea(lo, la) for lo in (-127, -92, -60) for la in (15.5, 51)]
xs, ys = [c[0] for c in corners], [c[1] for c in corners]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
scale = min(W / (x1 - x0), H / (y1 - y0))
ox = (W - (x1 - x0) * scale) / 2
def P(lon, lat):
    x, y = laea(lon, lat)
    return ((x - x0) * scale + ox) * S, (y1 - y) * scale * S
def p(lon, lat):
    x, y = P(lon, lat)
    return x / S, y / S

# grey and coral blue, like the wiki
SEA, LAND, OTHER = (38, 38, 43), (250, 250, 251), (150, 150, 160)
STATE_EDGE, COAST = (178, 178, 188), (104, 104, 116)
ACCENT, ACCENT_DARK, ACCENT_FILL = (79, 182, 214), (19, 122, 153), (188, 231, 243)
STEEL, STEEL_DOT = (84, 92, 104), (176, 222, 236)
INK, PAPER, RED = (24, 24, 28), (255, 255, 255), (222, 60, 60)
ON_SEA, SEA_STROKE = (238, 238, 242), (20, 20, 24)
STORY = {"Massachusetts", "Wyoming", "Texas"}       # states the story visits; Louisiana gets its own look

def rings(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        for i, ring in enumerate(poly):
            lons = [c[0] for c in ring]
            if max(lons) < -170 or min(lons) > -40:
                continue
            if max(lons) > 100 or min(lons) < -179:         # Alaska's far islands wrap the date line
                continue
            yield i, [P(lo, la) for lo, la in ring]

img = Image.new("RGB", (W * S, H * S), SEA)
d = ImageDraw.Draw(img)
countries = json.load(open(countries_path, encoding="utf-8"))["features"]
states = [f for f in json.load(open(states_path, encoding="utf-8"))["features"] if (f["properties"].get("adm0_a3") or f["properties"].get("ADM0_A3")) == "USA"]

for f in countries:                                    # the neighbours
    if f["properties"].get("ADM0_A3") == "USA":
        continue
    for i, pts in rings(f["geometry"]):
        if len(pts) > 2:
            d.polygon(pts, fill=OTHER if i == 0 else SEA)
la_mask = Image.new("L", img.size, 0)
for f in states:                                       # the United States of Garth
    name = f["properties"].get("name")
    fill = ACCENT_FILL if name in STORY else STEEL if name == "Louisiana" else LAND
    for i, pts in rings(f["geometry"]):
        if len(pts) > 2:
            d.polygon(pts, fill=fill if i == 0 else SEA)
            if name == "Louisiana":
                ImageDraw.Draw(la_mask).polygon(pts, fill=255 if i == 0 else 0)
# Louisiana is a Data Center: rows of little server lights
dots = Image.new("RGB", img.size, STEEL)
dd = ImageDraw.Draw(dots)
bx = la_mask.getbbox()
for yy in range(bx[1], bx[3], 22):
    for xx in range(bx[0] + (11 if (yy // 22) % 2 else 0), bx[2], 22):
        dd.rectangle((xx, yy, xx + 9, yy + 9), fill=STEEL_DOT)
img.paste(dots, (0, 0), la_mask)
d = ImageDraw.Draw(img)
for f in countries:
    for i, pts in rings(f["geometry"]):
        d.line(pts + pts[:1], fill=COAST, width=2)
for f in states:
    name = f["properties"].get("name")
    if name in STORY or name == "Louisiana":
        continue
    for i, pts in rings(f["geometry"]):
        d.line(pts + pts[:1], fill=STATE_EDGE, width=2)
for f in states:                                       # the story's states on top, with a strong edge
    name = f["properties"].get("name")
    if name in STORY or name == "Louisiana":
        for i, pts in rings(f["geometry"]):
            d.line(pts + pts[:1], fill=ACCENT_DARK, width=6)

# Route 66, where the real one runs: Chicago to Santa Monica
R66 = [(-87.63, 41.88), (-89.65, 39.80), (-90.20, 38.63), (-93.29, 37.21), (-94.51, 37.08), (-95.99, 36.15), (-97.52, 35.47), (-101.83, 35.22),
       (-104.52, 34.94), (-106.65, 35.08), (-108.74, 35.53), (-111.65, 35.20), (-114.05, 35.19), (-117.02, 34.90), (-117.29, 34.11), (-118.49, 34.02)]
def dashed(points, fill, width, dash=26, gap=16):
    pts = [P(*q) for q in points]
    carry, on = 0.0, True
    for (ax, ay), (bx_, by) in zip(pts, pts[1:]):
        seg = math.hypot(bx_ - ax, by - ay); pos = 0.0
        while pos < seg:
            step = min((dash if on else gap) - carry, seg - pos)
            if on:
                t0, t1 = pos / seg, (pos + step) / seg
                d.line((ax + (bx_ - ax) * t0, ay + (by - ay) * t0, ax + (bx_ - ax) * t1, ay + (by - ay) * t1), fill=fill, width=width)
            pos += step; carry += step
            if carry >= (dash if on else gap) - 1e-6:
                carry, on = 0.0, not on
dashed(R66, RED, 9)

img = img.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(img)

BOLD, REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
def text(xy, s, size, fill=INK, face=BOLD, anchor="la", stroke=4, sfill=PAPER):
    d.text(xy, s, font=ImageFont.truetype(face, size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=sfill)
def stop(xy, n, r=19):                                 # a numbered stop on Vinny's route
    x, y = xy
    d.ellipse((x - r - 4, y - r - 4, x + r + 4, y + r + 4), fill=PAPER)
    d.ellipse((x - r, y - r, x + r, y + r), fill=INK, outline=ACCENT, width=4)
    d.text((x, y - 1), str(n), font=ImageFont.truetype(BOLD, 21), fill=PAPER, anchor="mm")
def label(xy, rows, size=22, fill=INK, sfill=PAPER, anchor="la"):
    x, y = xy
    for i, (s, bold) in enumerate(rows):
        text((x, y + i * int(size * 1.3)), s, size if i == 0 else size - 4, fill=fill, face=BOLD if bold else REG, sfill=sfill, anchor=anchor)
def lead(a, b, fill=INK):
    d.line((a, b), fill=fill, width=2)

boston, wyo, austin, lou, lsj = p(-71.06, 42.36), p(-107.55, 43.0), p(-97.74, 30.27), p(-92.2, 31.1), p(-64.83, 18.30)
r66 = p(-101.83, 35.22)

# the Little Saint James Sea (the sea beside the Virgin Islands): a dashed region
cx, cy, rx, ry = lsj[0] - 30, lsj[1] - 22, 150, 78
for a in range(0, 360, 12):
    a0, a1 = math.radians(a), math.radians(a + 7)
    d.line(((cx + rx * math.cos(a0), cy + ry * math.sin(a0)), (cx + rx * math.cos(a1), cy + ry * math.sin(a1))), fill=ACCENT, width=4)

# titles
text((W / 2 - 60, 60), "THE UNITED STATES OF AMERICA", 40, fill=ON_SEA, anchor="mm", stroke=5, sfill=SEA_STROKE)
text((W / 2 - 60, 102), "on the planet Garth, in the Kanye System", 22, fill=ON_SEA, face=REG, anchor="mm", stroke=4, sfill=SEA_STROKE)

# the stops, in the order Vinny reaches them
lead(boston, (1640, 418), fill=ON_SEA)
label((1650, 400), [("Boston", True), ("Vinny's home and his Burger King.", False), ("The freezer leads to the Backrooms.", False), ("He is back at the register", False), ("on November 2nd.", False)], fill=ON_SEA, sfill=SEA_STROKE)
stop(boston, 1); stop((boston[0] + 46, boston[1] + 4), 7)

stop(lsj, 2)
label((W - 28, cy + ry + 12), [("THE LITTLE SAINT JAMES SEA", True), ("The AI was banished here in 1972.", False), ("The AI Shadow Realm is under it.", False), ("The S.S. Vessel sails it. Vinny sinks.", False)], fill=ON_SEA, sfill=SEA_STROKE, anchor="ra")

lead(wyo, (262, 300))
label((22, 236), [("Wyoming", True), ("Where Claude throws", False), ("Vinny: a mountain, then", False), ("one of the state's", False), ("three Dunkins.", False)], fill=ON_SEA, sfill=SEA_STROKE)
stop(wyo, 3)

lead(austin, (austin[0] - 150, austin[1] + 150), fill=ON_SEA)
label((austin[0] - 440, austin[1] + 140), [("Austin, Texas", True), ("Buc-ee's HQ, home of the", False), ("United Homies of America.", False)], fill=ON_SEA, sfill=SEA_STROKE)
stop(austin, 4)

label((r66[0] - 214, r66[1] - 128), [("Route 66", True), ("Three months of Freedom", False)], fill=(170, 30, 30))
stop(r66, 5)

lead(lou, (lou[0] + 60, lou[1] + 190), fill=ON_SEA)
label((lou[0] - 60, lou[1] + 196), [("Louisiana", True), ("Louisiana is a Data Center.", False), ("Briefly French. The Age of", False), ("Claude ends here.", False)], fill=ON_SEA, sfill=SEA_STROKE)
stop(lou, 6)

# title + notes
d.rectangle((26, H - 236, 800, H - 24), fill=PAPER, outline=INK, width=3)
d.rectangle((26, H - 236, 800, H - 228), fill=ACCENT)
text((46, H - 218), "The Epic of Vinny: Garth", 30, stroke=0)
for i, s in enumerate([
    "July 4th to November 2nd, 1995. The numbers follow Vinny's route.",
    "The story never describes Garth's geography. This map assumes",
    "Garth's United States has the same shape as the real one, and",
    "that Route 66 runs where the real one does. The places the team",
    "visits between Route 66 and Louisiana are not named.",
    "Borders: Natural Earth (public domain).",
]):
    text((46, H - 174 + i * 24), s, 17, face=REG, stroke=0)
img.save(out)
print("saved", out, img.size, {"boston": boston, "wyo": wyo, "austin": austin, "lou": lou, "lsj": lsj, "r66": r66})
