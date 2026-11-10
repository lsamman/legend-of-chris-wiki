# The Legend Of Chris Wiki

A fan wiki for *The Legend Of Chris*, with an article on every character, location, planet, item and event in the MASTER FILE.

Live site: https://lsamman.github.io/legend-of-chris-wiki/

## Layout

- `content/book.txt` is the raw text of the book (`book-numbered.txt` has line numbers).
- `content/entries/*.json` holds the article text.
- `content/images/` and `content/images.json` hold the photos of real people and places, from Wikimedia Commons, with credits.
- `build/build.py` is the static site generator. It writes into `site/`.
- `build/fetch_images.py` re-fetches the photos.
- `site/` is the generated website. GitHub Pages deploys it on every push to `main`.
- `build/phone.js` and `build/phone.css` are the phone: the phone button in the toolbar (or `#iphone-3g` on any page) flies a sacred phone to the front of the screen with Will's real apps on it: MySpace v1.3.3, Twitter: Bluebird Variant, Snapchat: Ghost Protocol Edition, Facebook (Pre-Cringe), Apple Podcasts 2 and Settings (Full access), all on lsamman.github.io. A toggle switches between Steve Jobs's iPhone 3G (sideways, cracked) and the Nokia I-4500 flip phone (flips open, works with its keypad or the arrow keys and 1–9). The choice is saved in `loc.phone.model`. The wallpaper comes from the Settings app (`loc.phone.wallpaper`). App icons are `build/app-*.png`.
- `site/timeline.html` is the Timeline (see below). Its events are in `content/timeline.json`; the page is drawn by `build/timeline.js` and `build/timeline.css`.
- `site/maps.html` is the Maps page: the Multiverse, North America and Europe. The images and the list of articles each map covers are in `content/maps/` (`maps.json`); every listed article gets an "On the map" link.
- `site/read.html` is the complete book for readers. `site/write.html` is the author-only writing room. Both use `build/book.js`, `build/reader.js` and `build/editor.js`, and keep the text in Firebase (see below).

## Updating

```sh
python3 build/build.py   # regenerate site/ after editing content
git add -A && git commit -m "Update wiki" && git push
```

## The Timeline

`timeline.html` (in the sidebar as **The Timeline**) puts every event of the MASTER FILE on one page. It can be sorted two ways: **As it happened** (in-universe, from the Cycle of Chris to chicken hour in O'Block 2) and **As told in the book** (by chapter). Readers can pick which storylines to follow, open any event for the details, a quote, and links to its article and to the chapter in the MASTER FILE. The sorting and the storylines go into the address, so a view can be shared. Chapter articles link to their part of the Timeline, and event articles to their event.

To add or change events, edit `content/timeline.json` and rebuild:

- Events are listed **in the order they happened**. Put a new one where it belongs in the story's own time.
- `line` is the line in `content/book.txt` where the book tells it. That is what puts it in the right place in **As told in the book** order and under the right chapter.
- `era` is one of the `eras` at the top of the file. `lanes` are the storylines it belongs to (from `lanes`, first one sets the dot colour).
- `when` (optional) is the in-universe time shown above the title, `quote` (optional) is `{"text": …, "by": …}`, and `article` is the wiki article it links to.
- `text` uses the same `[[slug|label]]` links as the articles. The build lists any link that points nowhere.

### The "By group" view

The third button on the Timeline follows the separate groups (the Reformed Crips, the New Crips, the Goober Gang, the Propane Dropouts, the Propane Gang), and the New Apple Employees when the last two combine: a **Where everyone is now** card for each, then a chapter-by-chapter map showing what each group does, when members join or leave, and when groups combine (they then share one card). It comes from `content/groups.json` (see the notes at the top of that file). The build stops with a clear message if a link or event id in it doesn't exist.

The tracker only knows the chapters in `groups.json`. If the live published book has more chapters than that, the page shows "A newer chapter has been published. This tracker hasn't caught up with it yet."

**After you publish a new chapter**, tell Claude. It updates `content/timeline.json` (the new events), `content/groups.json` (a cell for each group in the new chapter, each group's `now`, and `asOf`), and the wiki's chapter article.

## The Epic of Vinny Wiki (spin-off)

*The Epic of Vinny* is a spin-off set on planet Garth in the Kanye System, in 1995 and 1996. It has its own wiki at `site/epic-of-vinny/` (https://lsamman.github.io/legend-of-chris-wiki/epic-of-vinny/), with its own look, search, categories and timeline. It is separate from the Legend Of Chris wiki but deployed with it.

- **Where things are.** Articles are in `teov/content/*.json`, the look is in `teov/assets/`, and `teov/build.py` writes the site. `python3 build/build.py` runs it automatically after the main build.
- **Links between the two wikis.**
  - A button in the Legend Of Chris toolbar ("The Epic of Vinny"), a sidebar link and a box on the main page take readers to the spin-off.
  - The spin-off has a "← Legend Of Chris" button on every page.
  - `TEOV_LINKS` in `build/build.py` adds an "In the spin-off" line to the Legend Of Chris articles it relates to.
  - A spin-off article lists its Legend Of Chris counterparts in its `loc` field.
  - In text, `[[loc:slug|label]]` links to a Legend Of Chris article (in the spin-off), and `[[teov:slug|label]]` links to a spin-off article (in the Legend Of Chris timeline).
- **Timeline and maps.** The spin-off's events are in the Legend Of Chris Timeline as the "Epic of Vinny" storyline (events with `"spinoff": true` in `content/timeline.json`; they sit after the eight chapters in "As told in the book"). The Maps page has a map of Garth, and the Multiverse map shows Garth in the Kanye System. Garth is not Earth: Earth is in the New Jersey System.
- **After a new chapter.** Tell Claude and send the new PDF. The steps:
  1. `python3 teov/extract_story.py <story.pdf> teov/content/story.json` rebuilds the full text for `read.html`, with the PDF's fonts, colours, text boxes and pictures (needs `pip install pymupdf`). The byline is left out on purpose: the wiki credits no author.
  2. Add the chapter to `teov/content/chapters.json`, update the articles it touches, and add new characters, places and events (events carry `timeline: {when, order}`).
  3. Add the new events to the Legend Of Chris timeline (`content/timeline.json`, `"spinoff": true`).
  4. If Vinny goes somewhere new, redraw the map: `python3 teov/garth_map.py <countries.geojson> <states.geojson> content/maps/garth.png` (the Natural Earth files are linked in the script), and update `ROUTE` in `teov/build.py`, which draws "The weird route" on the main page.
- **The look.** Grey and coral blue, Comic Sans, a white light mode. It borrows from the story: quotes are game-style text boxes, the main page has a save-file panel (where the story stands), Vinny's route and party cards (`ROUTE` and `PARTY` in `teov/build.py`). The story page is a white sheet set like the PDF and loads the PDF's display fonts from Google Fonts.

## The MASTER FILE: reading page and writing room

- **Read the MASTER FILE** (`read.html`, linked in the sidebar) shows the complete book. It starts with the original text built from `content/book.txt`, and switches to whatever was last published from the writing room as soon as Firebase answers. If someone has the page open when a new version is published, it updates without a reload.
- **The writing room** (`write.html`, also the ✎ next to "Original edition" / "Updated …" on the reading page) is a Pages-style editor. Only the author can sign in.
  - Typing saves a private draft automatically, every couple of seconds. Readers don't see the draft.
  - **Publish** puts the draft on the reading page. Every published version is kept under **More → Version history**, and any of them can be opened back into the draft.
  - **More → Import the original book** loads the original MASTER FILE text into the draft. The writing room offers this the first time, while the draft is empty.
  - If the writing room is open on two devices, a change on one appears on the other. If both changed at once, it asks which version to keep.
  - **✎ Notes** (top bar) opens a private "Notes for later" drawer: a list of notes with a title and text, saved as you type to `book/notes` in Firestore and kept on the device too. Readers never see them. If notes say "Not synced", re-paste `firestore.rules` into the Firebase console (it gained a `book/notes` rule).
  - Pictures go in by link (the picture button), not by pasting files, so the book stays under Firebase's 1 MB-per-document limit.

### Writing room setup (once)

1. Go to https://console.firebase.google.com, **Create a project** (any name, Google Analytics not needed).
2. In the project, click **</> (Web)** to add a web app, give it a name, skip Hosting. Copy the `apiKey`, `authDomain`, `projectId` and `appId` values into `build/firebase-config.js`, then rebuild and push.
3. **Build → Authentication → Get started → Email/Password → Enable**. Then **Users → Add user** with your email and a password. Under **Settings → Authorized domains**, add `lsamman.github.io`.
4. **Build → Firestore Database → Create database** (production mode, any location). Open `write.html` on the live site and sign in. It shows your user ID. Put that ID in place of `PASTE-YOUR-USER-ID-HERE` in `firestore.rules`, paste the whole file into **Firestore → Rules**, and press **Publish**. Reload the writing room.

The values in `firebase-config.js` are public by design. `firestore.rules` is what stops anyone else from writing.

### New-chapter notifications

Readers can tap **🔔 Notify me** on `read.html` to get a push notification when a new chapter comes out. On iPhone and iPad they first have to add the wiki to their Home Screen (Share → Add to Home Screen) and open it from there. That's an Apple rule for web notifications.

When you press **Publish** in the writing room, the dialog has a **Send a notification to readers** checkbox. It's ticked automatically when the draft has a chapter heading (Heading 1) that the published version doesn't. The box under it names the chapter the notification opens. Untick the box to publish quietly.

**What the notification says** is picked at random from the title + text combos in `notify/messages.json`, never the same one twice in a row. Edit that file to change or add combos (an empty `"body"` shows the title only). Tapping any of them opens the new chapter.

The notifications are sent by the **Send new-chapter notifications** GitHub Action (`.github/workflows/notify.yml`, code in `notify/`). It checks every 15 minutes, so a notification arrives anywhere from a few minutes to about half an hour after you publish. GitHub's schedule can run late. To send one right away, go to **Actions → Send new-chapter notifications → Run workflow**.

Setup (once):

1. Firebase console → ⚙️ **Project settings → Service accounts → Generate new private key**. This downloads a `.json` file. Keep it private.
2. On GitHub, open the wiki repo → **Settings → Secrets and variables → Actions → New repository secret**. Name it `FIREBASE_SERVICE_ACCOUNT` and paste the **entire contents** of that `.json` file as the value. Then delete the downloaded file.
3. Firestore → **Rules**: paste the new `firestore.rules`, put your user ID back in place of `PASTE-YOUR-USER-ID-HERE`, and press **Publish**. It adds the `subscribers` list and `book/announce`.

Until the secret is set, the Action just logs "not configured" and stops. Expired subscriptions are removed automatically when sending.

Optional: Firebase console → Project settings → **Cloud Messaging → Web Push certificates → Generate key pair**, then put the key in `vapidKey` in `build/firebase-config.js`. If you leave it empty, Firebase's built-in key is used, which works too. Changing it later means readers have to turn notifications on again.

### Testing locally with the Firebase emulators

```sh
npx firebase-tools emulators:start --project demo-loc   # Auth on :9099, Firestore on :8080
python3 -m http.server 8000 -d site                      # then open http://localhost:8000/write.html?emulator
```

With `?emulator` on localhost the pages talk to the emulators instead of the real project. Put the emulator user's ID into `firestore.rules` while testing.

### The Epic of Vinny: full text, theme and canon import
- `teov/content/story.json` holds the full story text (chapters of paragraphs, quotes and the game-style text boxes) and renders `epic-of-vinny/read.html`. Add new chapters there.
- The EOV wiki is grey with a white light mode (toggle in the top bar) and set in Comic Sans.
- Its non-chapter articles are imported into the Legend Of Chris wiki at build time (`import_spinoff` in `build/build.py`) as canon, each linking to its full page; the hub article is `the-epic-of-vinny`.
- To use a custom logo, put a background-free `logo.png` in `teov/assets/`.

### Word export and file import (writing room)
- **Export** (writing room, top bar) offers Word (`.docx`), PDF (the browser's print window, "Save as PDF"), Rich Text (`.rtf`, which Pages opens), a web page (`.html`), Markdown (`.md`) and plain text (`.txt`). Word and Rich Text keep the formatting; HTML keeps it too; Markdown keeps bold, italics, headings, lists, links; text keeps the words and list marks. The Word file contains: bold, italic, underline, strikethrough, colours, highlights, Comic Sans (the default) or Arial, text sizes, headings (real Word heading styles), numbered and bulleted lists (numbering restarts), alignment, indents, quotes, links, and the editor's paragraph spacing and line height. Pictures become links (they're only ever linked in the editor).
- **Import** reads `.docx`, `.pages`, `.txt`, `.md` and `.html`, then asks whether to replace the draft, add to the end, or insert at the cursor (all undoable with ↶). A `.docx` keeps bold, italics, underline, colours, highlights, Comic Sans, sizes, headings, lists, alignment and links. A `.pages` file brings only its text (Pages keeps formatting out of a browser's reach); export from Pages as Word for full formatting. Old `.doc` and `.rtf` files need a "Save as .docx" first.
- All of it runs in the browser (`build/docx.js`), with no libraries. The editor can't store custom paragraph spacing, so imported spacing becomes the editor's standard spacing.

### Main page panels, cards and pictures
- The main page shows where the story stands (from `content/groups.json` `asOf`), stats, "The Prophecy's phone" (`PROPHECY` in `build/build.py`: update a row's status when an app is found) and "The squad" (`SQUAD`).
- Category pages are cards. A card shows the article's picture when it has one (thumbnails are made at build time, with Pillow).
- `build/fetch_stand_in_images.py` picks a freely licensed Wikimedia Commons photo for every article that has no picture, and labels it as a stand-in. It needs network access to en.wikipedia.org, commons.wikimedia.org and upload.wikimedia.org.
- When the MASTER FILE gets new text: append it to `content/book.txt`, regenerate `content/book-numbered.txt`, update the chapter's line range in `build/manifest.py`, then the articles, `content/timeline.json` and `content/groups.json`.
