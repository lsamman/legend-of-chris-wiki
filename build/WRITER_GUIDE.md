# Writer guide — The Legend of Chris Wiki

You are writing articles for a fan wiki (in the style of a Fandom wiki) about "The Legend of Chris", an absurdist, meme-heavy comedy book written by a group of friends.

Source text: `/home/dreamliner/legend-of-chris-wiki/content/book-numbered.txt` (line-numbered). READ THE WHOLE BOOK FIRST (about 1256 lines; read it in chunks). Lines 1-303 are mostly one origin paragraph repeated about 9 times, so you can skim the repeats.

Full list of valid page slugs (link ONLY to these): `/home/dreamliner/legend-of-chris-wiki/build/all-slugs.txt`

## Voice
- Write like an earnest, slightly over-serious fan-wiki editor documenting lore that makes no sense. The joke is that the wiki treats the absurdity with total encyclopedic sincerity ("According to the Chapter Triangle, Plankton has no last name, as he is an orphan.").
- Stay faithful to the book. Quote it a lot, keeping its original spelling and typos inside quotes. Don't invent major plot events. You MAY add fan-wiki flavor: "Trivia", "Behind the scenes", "Continuity errors", "Fan theories" (clearly labelled as theories), real-world references explained in one line (e.g. that Spamton and [kromer] come from Deltarune).
- Note continuity errors gleefully: Toyota Corolla vs. Camry vs. Honda Accord, Obama vs. Putin at the center of Constantinople, chapter numbering, "Chapter 2" title vs. contents, different spellings of names.
- Real public figures appear as absurd characters. Describe only what the book says they do. Do NOT add new sexual, criminal, or defamatory claims about real people beyond the book.
- Content limits: the book has a few offensive jokes (an accidental universe described with an ethnic slur-joke; a stray line about slaves). Do NOT reproduce or explain those phrasings. Call that universe "the Cringe Universe" or "a universe of nazis", and use "nazi ants" for its Shadow Realm remnants. Never quote the slavery line. Mild swearing that appears in quotes is fine.

## Length
- Major entities (Chris, RFK, Plankton, MF Vroom, Kanye, ChatGPT, Steve Jobs, McQueen, Hank Hill, Osama, the Inav, iPhone 3G, the Verizon contract, the Prophecy, the Projects, Dunder Mifflin, the Shadow Realm, etc.): 350-700 words with several sections.
- Medium entities: 150-350 words.
- One-line mentions: 60-150 words. Keep these short and funny, e.g. "X is mentioned exactly once in the canon…", and explain the context.

## Output
Write ONE JSON file: `/home/dreamliner/legend-of-chris-wiki/content/entries/batch-<LETTER>.json`. It must be a JSON array with one object per assigned slug (use EVERY slug from your batch file; do not add new slugs):

```json
{
  "slug": "plankton",
  "title": "Plankton",
  "category": "characters",          // copy from batch file
  "subtitle": "Orphan. Strategist. Folding-chair enjoyer.",   // short tagline, optional
  "infobox": {                        // 3-8 rows; values may contain [[links]]
    "Aliases": "None (no last name)",
    "Affiliation": "[[new-crips|New Crips]]",
    "Weapon": "[[metal-folding-chair|Metal folding chair]]",
    "Status": "Alive",
    "First appearance": "[[chapter-triangle]]"
  },
  "quote": {"text": "My name is Plankton, no last name I'm an orphan.", "by": "Plankton, [[chapter-triangle]]"},   // optional but encouraged
  "lead": "Opening paragraph(s). Bold the subject's name on first mention like **Plankton**.",
  "sections": [
    {"heading": "Biography", "body": "Paragraphs separated by \\n\\n. Sub-headings allowed as a line starting with '### '. Bullet lists as lines starting with '- '."},
    {"heading": "Trivia", "body": "- fact\n- fact"}
  ],
  "appearances": ["chapter-triangle", "dunder-mifflan-chapter"],   // chapter slugs, in order
  "related": ["rfk", "mf-vroom"]       // 2-8 slugs
}
```

Markup allowed in strings: `[[slug]]` or `[[slug|display text]]` for internal links, `**bold**`, `*italic*`, `> ` at the start of a line for a block quote. No HTML. Link generously (the first mention of each entity per article). Every link target MUST be a slug from all-slugs.txt; otherwise use plain text.

Chapter slugs: chapter-before-chapter-2, chapter-2, chapter-triangle, chapter-the-fourth, dunder-mifflan-chapter, flashback-chapter, chapter-maybe-seventh, chapter-4-point-1.

Build the JSON with a Python script (json.dump, ensure_ascii=False, indent 1) so escaping is right. Then validate it: it loads, every batch slug is present, and every [[link]] target is in all-slugs.txt. Fix any problems. When you're done, reply with just a one-line summary (count of entries written and any problems). Do not send the content back in your reply.
