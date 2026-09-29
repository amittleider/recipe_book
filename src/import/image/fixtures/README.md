# Test pages

Photographs and rendered pages, and the OCR output recorded from each.

- `pages/` holds the images, and `pages/pages.json` says which fixture each one
  produces. `real-*` are photographs the cook actually took; the rest are
  rendered pages built to imitate one of them.
- The `*.json` beside this file are **derived**: Apple Vision's reading of those
  images, recorded through the very Swift that runs on the phone.

## Regenerating

```sh
npm run ocr:fixtures                     # all of them
npm run ocr:fixtures -- salade-photo     # just one
```

Do this after any change under `modules/vision-text/ios`, because every fixture
is stale the moment that Swift changes, and a suite passing against stale
fixtures is testing a pipeline that no longer exists.

Expect the results to move a little: recognition is not a pure function of the
bytes. Read the diff rather than waving it through — it is the only honest
record of what the change did.

## Adding a page

```sh
cp ~/Desktop/photo.jpg src/import/image/fixtures/pages/real-tarte.jpg
# add it to pages/pages.json, then:
npm run ocr:fixtures -- real-tarte
npm run ocr:inspect src/import/image/fixtures/real-tarte.json
```

`ocr:inspect` prints every stage — the turn, the skew, the regions, how each
block was classified, and the finished `recipe.md` — so when a page comes out
wrong it names the stage rather than only the symptom.

Then add a row to `PAGES` in `../fixtures.test.ts`. A page the parser reads
badly is not a reason to leave it out: mark it `hard` and its numbers become
floors, which may rise freely and must never fall.

## Why real photographs

Every synthetic page here was written to imitate a real one, and every time a
real photograph has been added it has broken something no synthetic page did —
a gutter narrower than a constant allowed, a list aligned on its right edge, an
author's name set sideways down the margin whose bounding box was tall enough to
prevent the page from ever being cut into regions. Rendered pages are useful for
isolating one variable. They are not evidence.
