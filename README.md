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

## Updating

```sh
python3 build/build.py   # regenerate site/ after editing content
git add -A && git commit -m "Update wiki" && git push
```
