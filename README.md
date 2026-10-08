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
- `site/read.html` is the complete book for readers. `site/write.html` is the author-only writing room. Both use `build/book.js`, `build/reader.js` and `build/editor.js`, and keep the text in Firebase (see below).

## Updating

```sh
python3 build/build.py   # regenerate site/ after editing content
git add -A && git commit -m "Update wiki" && git push
```

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

### Testing locally with the Firebase emulators

```sh
npx firebase-tools emulators:start --project demo-loc   # Auth on :9099, Firestore on :8080
python3 -m http.server 8000 -d site                      # then open http://localhost:8000/write.html?emulator
```

With `?emulator` on localhost the pages talk to the emulators instead of the real project. Put the emulator user's ID into `firestore.rules` while testing.
