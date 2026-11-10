# Builds teov/content/story.json from the story PDF: paragraphs with the PDF's own fonts and colours as styled runs,
# and the Gaster text boxes / pictures where the PDF has them. Needs PyMuPDF (pip install pymupdf).
# Usage: python3 teov/extract_story.py <story.pdf> teov/content/story.json   (then run build/build.py)
import pymupdf, json, re, sys
pdf, out = sys.argv[1:3]
def cls(font, color):
    c = '#%06x' % color
    f = font.split('+')[-1]
    if f.startswith('ArialMT') or f.startswith('Arial'): return 'cl'
    if f.startswith('EBGaramond'): return {'#0000ff': 'gb', '#ff0000': 'gr', '#0f0f0f': 'gk', '#000000': 'gk', '#ff9900': 'go', '#ff5600': 'gO'}.get(c, 'gk')
    if f.startswith('Playfair'): return 'pf'
    if f.startswith('Lobster'): return 'lob'                           # the word "Freedom"
    if f.startswith('Georgia'): return {'#ff40c0': 'bp', '#ff9900': 'bo'}.get(c, '')
    if f.startswith('ComicSansMS'):
        if c == '#ff0000': return 'red'
        if c == '#ffffff': return 'wh'
        if c == '#ffff00': return 'ye'
        if c == '#0000ff': return 'gb'
        return {'ComicSansMS-Bold': 'b', 'ComicSansMS-Italic': 'i', 'ComicSansMS-BoldItalic': 'bi'}.get(f, '')
    return ''
GAP = '\ue000'   # placeholder for one space of a deliberate gap; becomes a no-break space
d = pymupdf.open(pdf)
items = []   # ('line', page, y, x0, x1, [(cls, text)], size) | ('img', page, y, w, h)
for pn, pg in enumerate(d):
    rows = {}
    for b in pg.get_text('dict')['blocks']:
        if b['type'] == 1:
            items.append(('img', pn, b['bbox'][1], b['width'], b['height'])); continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].replace('\x00', '▯')               # a glyph the PDF itself shows as an empty box
                t = ''.join(ch for ch in t if ch.isprintable() or ch == ' ')
                t = re.sub(r' {3,}', lambda m: GAP * len(m.group(0)), t)   # deliberate wide gaps (the starwalker manager's lines)
                if not t: continue
                y = round(s['origin'][1])
                key = next((k for k in rows if abs(k - y) <= 3), y)
                rows.setdefault(key, []).append((s['bbox'][0], s['bbox'][2], cls(s['font'], s['color']), t, s['size']))
    for y, sp in rows.items():
        sp.sort()
        if not ''.join(t for _, _, _, t, _ in sp).strip(): continue
        items.append(('line', pn, y, min(s[0] for s in sp if s[3].strip()), max(s[1] for s in sp if s[3].strip()), [(k, t) for _, _, k, t, _ in sp], max(s[4] for s in sp)))
items.sort(key=lambda i: (i[1], i[2]))
ENDS = ('.', '!', '?', '”', '…', '"', ')', ']', '’')
blocks, cur, prev = [], None, None
def flush():
    global cur
    if cur: blocks.append(cur)
    cur = None
for it in items:
    if it[0] == 'img':
        flush(); blocks.append({'k': 'img', 'w': it[3], 'h': it[4]}); prev = None; continue
    _, pn, y, x0, x1, runs, size = it
    text = ''.join(t for _, t in runs).strip()
    head = size > 18
    brk = cur is None or head or cur.get('head')
    if not brk and prev:
        same = prev[1] == pn
        ended = prev[5].rstrip().endswith(ENDS)
        first = text.split(' ')[0]
        if same and y - prev[2] > 25: brk = True
        elif not same: brk = ended and prev[4] < 470
        elif prev[4] < 470 and not (len(first) > 22 and not ended): brk = True
    if brk:
        flush(); cur = {'k': 'p', 'runs': [], 'head': head}
    elif cur['runs']:
        last = cur['runs'][-1][1]
        glue = re.search(r'([hO])\1{10,}$', last.rstrip()) and re.match(r'^[hO]', text)
        if glue: cur['runs'][-1][1] = last.rstrip()
        elif not last.endswith(' '): cur['runs'].append(['', ' '])
    for k, t in runs: cur['runs'].append([k, t])
    prev = (0, pn, y, x0, x1, text)
flush()
def tidy(runs):
    o = []
    for k, t in runs:
        t = re.sub(r'\s+', ' ', t)
        if not t: continue
        if not t.strip(): k = o[-1][0] if o else ''
        if o and o[-1][0] == k: o[-1][1] += t
        else: o.append([k, t])
    for r in o: r[1] = re.sub(r' {2,}', ' ', r[1])
    for i in range(1, len(o)):                       # no double spaces across runs
        if o[i - 1][1].endswith(' ') and o[i][1].startswith(' '): o[i][1] = o[i][1][1:]
    o = [r for r in o if r[1]]
    if o: o[0][1] = o[0][1].lstrip(); o[-1][1] = o[-1][1].rstrip()
    for r in o: r[1] = r[1].replace('LANDFAGGOTS', 'LANDF*****S').replace(GAP, '\u00a0')
    return [r for r in o if r[1]]
BOX = [[['', 'CHIPS AHOYETH, LANDF*****S!!!!!']],
       [['', 'IM NOT EATING THIS SHIT! ITS NOT A '], ['bx-b', 'DOUBLE WHOPPER WITH CHEESE'], ['', '!']],
       [['', 'I GUESS BRO']],
       [['', 'HOLY SHIT GO BACK GO BACK GO BACK GO BACK GO BACK GO BACK']],
       [['', 'OH YEAH, THE ROARING KNIGHT IS '], ['bx-y', 'ROARY OLEARY'], ['', ' LMAO']]]
story = {'title': 'The Epic of Vinny', 'chapters': []}
SLUG = {'?': 'chapter-prologue'}
ch, nbox = None, 0
for b in blocks:
    if b['k'] == 'img':
        if b['w'] > 1000: ch['blocks'].append({'k': 'pic', 'file': 'story-island.jpg', 'alt': 'An island with a small building on top of a hill.'})
        else:
            ch['blocks'].append({'k': 'box', 'runs': BOX[nbox], 'text': ''.join(t for _, t in BOX[nbox])}); nbox += 1
        continue
    runs = tidy(b['runs']); text = ''.join(t for _, t in runs)
    if not text: continue
    if b['head']:
        m = re.match(r'chapter (\S+):', text, re.I)
        if not m: continue                                   # the title line
        n = m.group(1)
        ch = {'slug': SLUG.get(n, 'chapter-' + n), 'heading': text, 'hruns': runs, 'blocks': []}; story['chapters'].append(ch); continue
    if ch is None: continue                                  # the byline
    kind = 'quote' if ch['slug'] == 'chapter-prologue' and not ch['blocks'] else 'p'
    ch['blocks'].append({'k': kind, 'text': text, 'runs': runs})
def split_runs(runs, marker):
    # split a paragraph's runs before the first occurrence of marker
    a, b, done = [], [], False
    for k, t in runs:
        if not done and marker in t:
            i = t.index(marker); done = True
            if t[:i].strip(): a.append([k, t[:i].rstrip()])
            b.append([k, t[i:]])
        else: (b if done else a).append([k, t])
    return (a, b) if done and a else None
for c in story['chapters']:
    for marker in ['Bucee, the master of Oil-Bending', 'Kilroy, a WWII Veteran', 'Buc-ee’s HQ is the home of']:
        for i, b in enumerate(c['blocks']):
            if b['k'] == 'p' and marker in b['text'] and not b['text'].startswith(marker):
                r = split_runs(b['runs'], marker)
                if r:
                    c['blocks'][i:i + 1] = [{'k': 'p', 'text': ''.join(t for _, t in x), 'runs': x} for x in r]
                break
    for b in c['blocks']:
        if b['k'] == 'p':
            for r in b['runs']: r[1] = r[1].replace('C opium', 'Copium')
            b['text'] = ''.join(t for _, t in b['runs'])
json.dump(story, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for c in story['chapters']:
    print('=====', c['heading'], c['hruns'])
    for i, b in enumerate(c['blocks']):
        t = b.get('text', b.get('file', ''))
        print(f"[{i}] {b['k']}: {t[:110]}" + (' … ' + t[-60:] if len(t) > 180 else ''))
