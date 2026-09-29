# Nos Recettes — native application

## Product

An Expo/React Native recipe book for iOS, designed so the same TypeScript code
can later ship on Android. Google Drive is the source of truth and no application
backend is required.

## Architecture

- `App.tsx` owns the small screen-state router.
- `src/auth/googleAuth.ts` is the platform authentication boundary.
- `src/api/drive.ts` owns all Google Drive operations.
- `src/data/recipeStore.ts` is the cache-first read model every screen renders
  from. Screens never call Drive directly.
- `src/data/mediaStore.ts` owns media *bytes* and transfers; `recipeStore` owns
  the media *list*, which lives in the manifest. The dependency runs one way,
  media store to recipe store.
- `src/storage/recipeCache.ts` persists recipe metadata, bodies and media to files.
- `src/storage/keychain.ts` persists the selected root folder securely.
- `src/ocr/textRecognition.ts` is the platform boundary for reading text out of
  an image, wrapping the local Expo module in `modules/vision-text`.
- `src/import` holds both importers. Everything under `src/import/image` is pure
  TypeScript operating on an `OcrPage`, which is what lets the whole parse run
  under `node --test` with no device.
- `src/screens` contains native React Native screens.
- Recipe format remains one `recipe.md` per Drive subfolder, with photos and
  videos as ordinary files beside it in the same folder.

## Caching

The Drive folder is shared, so the cache must be fast *and* must notice edits
made on someone else's device.

- Reads are answered from cache and are synchronous, so screens paint on the
  first frame. Drive is consulted to revalidate, never to render.
- Freshness comes from Drive's per-file validators (`md5Checksum`, falling back
  to `modifiedTime`), not HTTP ETags. Those fields arrive inside a `files.list`
  response, so two batched queries revalidate the entire cookbook and only
  genuinely changed bodies are downloaded. Conditional GETs would cost one round
  trip per recipe to learn the same thing.
- `listRecipeFiles` folds many folders into one `... in parents or ...` query.
  Never reintroduce a per-folder lookup; that was the original slowness.
- Saves are written through with the validator from the upload response, so a
  device never re-downloads what it just wrote.
- Picking a folder fills the cache behind a progress screen. That one-time cost
  buys an instant app afterwards, including offline.
- Revalidation runs on launch, on foreground, and on pull-to-refresh, throttled
  and de-duplicated in the store.

## Media

Photos and videos live next to `recipe.md` in the recipe's folder, named
`photo-<timestamp>-<suffix>.jpg` at capture. The random suffix is not decoration:
Drive allows duplicate names in one folder, so two phones adding a photo in the
same second would otherwise point one name at two files.

- Order is recorded in `recipe.md` as a `## Photos` section of plain markdown
  image references, **by file name, not by Drive id** — ids change when a file is
  replaced, and a name is something a person can read. `recipeDocument.parse`
  lifts that section into `document.media`, but only when every line in it is an
  image reference; anything else and it stays an ordinary section, written back
  untouched. A recipe with no photos gets no section, so it is stored exactly as
  it was before media existed.
- The first photo is the cover. That is the whole ordering model, and it is why
  reordering in the editor is what chooses the cover shown on the recipe list.
- Reconciliation is forgiving in both directions. A file in the folder that the
  markdown never mentions is still shown, which is what makes dropping a photo in
  from a laptop work; a name with no file behind it is skipped rather than drawn
  broken.
- `listFolderFiles` deliberately does not filter by name: one batched query
  returns `recipe.md` and the folder's media together, so media revalidation
  costs no extra round trip. Never split it back into two queries.
- Capture is local-first. The bytes are written to their final cache path and the
  entry is recorded *before* anything touches the network, so the photo is on
  screen immediately and a photo taken with no signal is never lost. The upload
  queue drains on add, on foreground, and on each sync. A failed upload keeps its
  local copy, which is still the only copy.
- A new recipe has no folder yet, so its photos stage under a `draft:` id and the
  first save hands them to the folder Drive creates.
- Downloads are lazy and tiered, because a shared cookbook on cellular should not
  cost hundreds of megabytes: thumbnails (from Drive's `thumbnailLink`, never
  persisted — they expire in hours) as tiles appear, full images when a recipe is
  opened, and videos only when one is played. Media freshness uses the same
  validator scheme as bodies, via `RecipeMedia.cached`.
- Media is cached in `media/<folderId>/` and `thumbs/`, both *beside* `bodies/`.
  `pruneBodies` deletes every file it does not recognise, so a photo filed under
  `bodies/` would be swept away on the next sync.
- Images are re-encoded to JPEG at 2048px before upload: iOS hands back HEIC,
  which Android cannot display, and a raw phone photo is several megabytes on a
  folder the family syncs to several devices. Videos are passed through.

## Importing a recipe

Two ways in, one destination: both importers produce an `ImportedRecipe`, hand it
to `toDocument`, and stop at a filled-in editor. Neither ever writes to Drive.
That is what makes a parser that is right most of the time good enough — a miss
costs the cook a few taps rather than putting a bad recipe in a shared folder.

- From a link, `src/import/structuredData.ts` reads the page's `schema.org/Recipe`
  data. Exact where it works, and it needs no model.
- From a photograph, the page is flattened first and Apple Vision then reads it,
  and `src/import/image` puts the recipe back together. Photographing goes
  through `VNDocumentCameraViewController`, the system scanner, which finds the
  page edges live and corrects the shot before we see it; a picture already in
  the library goes through `DocumentImage`, which does the same job after the
  fact with `VNDetectDocumentSegmentationRequest`, `CIPerspectiveCorrection` and
  `CIDocumentEnhancer`. `DocumentImage.swift` is compiled into both the app and
  the fixture recorder, so a fixture cannot be testing a different pipeline. The engine is Vision rather than a cross-platform
  package because it is markedly better on French printed type, has some chance
  at handwriting, and — decisively — runs on a Mac over a saved photo, so
  `scripts/ocr/fixture.sh` records test fixtures from the very engine the phone
  uses. Android would add an ML Kit branch inside `textRecognition.ts` and
  change nothing else.

The parser's rules are typographic rather than positional, because "ingredients
are on the right" is true of one book and false of the next:

- The page is put the right way up before anything reads its layout. A cookbook
  spread is wider than it is tall, so the phone gets turned and the text runs up
  the frame; Vision reads that well but not perfectly, and a page found to be
  sideways is rotated and read *again* — coordinates can be rotated after the
  fact, but text never recognised cannot be recovered. A cheap `.fast` probe to
  find the orientation does not work: on a sideways page `.fast` returns nothing
  at all.
- Residual tilt is levelled from the angle of the text lines themselves rather
  than the paper's corners — a curved spine bows every line by a different
  amount, which no four-corner correction can undo.
- Columns are found next. OCR reports a two-column page in roughly raster order,
  so the columns arrive interleaved and sorting by `y` alone yields alternating
  stripes of method and ingredients. The gutter is swept for and measured **in
  characters**: a real photograph narrows the gutter, and a threshold in page
  widths rejected a perfectly clean one, collapsing the page to a single column.
- Size is measured as **average character advance**, never box height. Vision
  fits each box to the glyphs in it, so a line with no descenders comes back
  half again shorter in the very same font.
- Blocks break where the leading changes against a **local** window, not the
  column average. One column routinely holds two leadings, and a single
  threshold either shatters a large-type title or welds the body onto it.
- A line break inside a block is wrapping, not meaning. A new ingredient starts
  at a bullet, failing that at an indent, failing both at a new line.
- A bullet is a *mark followed by a space*, not a character from a list this
  codebase knows. One book sets its steps with `❖`, which Vision reads as `→`,
  `«` or `¿` depending on how the ink caught the light; matching glyphs finds
  some of a page's steps and welds the rest onto their neighbours.
- Which edge a list is aligned on is measured, never assumed. Indentation marks
  a continuation only on a list set flush left; on a right-aligned list every
  line begins somewhere different, and reading those offsets as indentation
  folds seventeen ingredients into two.
- A page that marked its own steps has said where they begin, so they are not
  cut further at sentence boundaries. Sentences are consulted only when the page
  offers nothing of its own.
- A heading starts a list and its absence continues the one above. Blocks with no
  heading are merged as *lines*, before items are read from them, because a list
  broken across blocks is usually broken mid-item.
- No document may carry two sections of one name. `toDocument` folds them, so no
  caller can emit a recipe whose sections cannot be told apart.
- Nothing is discarded. Text that matches nothing becomes a closing `Notes`
  section, because an ingredient lost to an over-eager filter is far worse than
  a line the cook deletes.

## Testing

`npm test` runs the suite on Node's built-in runner — no jest, no vitest, no
transform. `scripts/tsResolve.mjs` teaches Node the extensionless imports Metro
resolves; Node strips the types itself. Node's stripper cannot handle
constructor parameter properties, which is why `ImportError` declares its field
explicitly.

Fixtures in `src/import/image/fixtures` are real Vision output over real images,
and the images live beside them in `fixtures/pages` so every fixture can be
re-recorded with `npm run ocr:fixtures`. Do that after any change under
`modules/vision-text/ios`: a suite passing against stale fixtures is testing a
pipeline that no longer exists. Fixtures are never hand-written — invented OCR
is always tidier than the real thing and would certify a parser that cannot cope.

The corpus deliberately differs in language, column count, bulleting, print
versus handwriting, camera angle and orientation, and a set of invariants runs
over *every* page — so a threshold nudged to rescue one must keep the others
passing. A page marked `hard` records **floors** rather than expectations: they
may rise freely and must never fall, so a page read badly today can only get
better. See `fixtures/README.md`.

The `real-*` pages are photographs the cook actually took, and they earn their
place: every one of them has broken something no rendered page did.

Authentication must use the native Google SDK. Never persist access tokens in
AsyncStorage, local files, or application state beyond the current process. On
iOS the SDK persists its durable sign-in credential in Keychain and refreshes
access tokens as needed. SecureStore is used for application-owned persistent
metadata.

The app requests full Google Drive access because the native folder browser must
find an existing folder shared by another user. If a future native Picker or a
backend-mediated sharing workflow is introduced, reconsider the narrower
`drive.file` scope.

## Visual direction

- Warm cookbook feel rather than productivity software.
- Off-white `#FAFAF7`, near-black `#1A1A18`, subtle `#E5E5E0` borders.
- Georgia for recipe headings and system fonts for controls.
- Mobile-first, with generous whitespace and native touch targets.

## Verification

Run `npm run typecheck` after changes. Native Google Sign-In, the camera, the
gallery and video playback all require a development build (`npm run ios`), so
none of them can be tested in Expo Go.
