# HANDOFF 2026-08-31 — WP-5-WIRE: persistence routed through the canonical document

Package: `AI-BACKLOG.md` §9 second increment (foundation landed earlier the same day).
Status: **CLOSED** — §9 marked CLOSED, §10 EXEC-CORE unblocked and is the next open package.
Nothing committed, pushed or published; release staging untouched (still the FIX-K build);
C# untouched; live devPlugins DLL untouched (only web files were synced to the three roots).

## Reproduction first (red baseline)

A throwaway vm harness loaded the real `web/choreo-projects.js` / `choreo-edit.js` /
`choreo-app.js` and drove the three persistence paths; **8 losses confirmed** (script deleted
after the run, output recorded here):

- **S1 load→save**: `applyProjectContent → projectRecord` dropped unknown top-level content
  keys — `timing:{bpm:120}` and `stage:{yaw:30}` were gone after one round (saved content keys:
  `dancerCount, dancers, globalLyrics, markers, showLyricMacro, totalDuration`).
- **S2 import**: `importProject` renumbered clip ids by array position (file ids 7/4 became 1/2),
  dropped the dancer extra `group:'lead'` and forced `currentJob:null` (file said `PLD`).
- **S3 export**: the v5.0 whitelist dropped `group` and `currentJob`.

The same harness, re-run after the fix against the wired app: **0 losses** — and the exported
file is now the canonical document (top keys `schemaVersion, projectId, name, durationMs,
timing, stage, performers, tracks, lyrics, markers, capabilities, timelineRevision, metadata,
view`, `group` under `performers[0]._extra`, `job:'PLD'`, unknown content keys under `_extra`).

## What landed (second pass — found by clip-check)

The first full clip-check run on the wired game root hung at section ㉑ and failed §20; both
were real findings, one product-level:

- **Product fix (root cause): AUD-002 import rejection must precede migration coercion.** The
  old pipeline rejected `start:'x'` at `sanitizeImportProject` before anything touched the
  data; `importProjection` migrated first, and migration's time normalization silently coerced
  the bad value to 0, so the projection passed validation and the import wrongly succeeded
  (clip-check §20 freezes this contract: `导入非数字开始时刻被拒`). Fix in
  `web/choreo-docwire.js`: for non-document-shaped input, `legacySanitize` runs on the RAW data
  first (rejection semantics unchanged from the old pipeline); documents still go through
  `validate` + projection sanitize. `test-docwire.js` gained a freeze for it (45 checks now).
- **Harness adaptation in `web/clip-check.html` §21** (same class as library-verify): the
  undo/redo mirror assertions read `mir5.content.dancers[0]`, which throws on a document-shaped
  mirror and killed the page runner (title frozen → harness timeout). A shape-agnostic
  `mirDancer0()` helper now extracts "dancer 0 action-clip count + lyric-macro flag" from
  either storage shape; assertion semantics unchanged.

## What landed

- **`web/choreo-docwire.js`** (new, pure, classic, node-testable) — the wiring layer:
  - `loadProjection(ct)`: any stored shape → `ensureDocument` → `toLegacyContent` projection
    `{proj, rev, doc, source, warning?}`. Empty/`null` content opens silently as an empty
    project (old behavior); unidentifiable garbage yields the empty projection plus a Chinese
    `warning` so startup never blocks and the user is told honestly.
  - `persistDoc(proj, meta, rev)`: store projection (6 known fields + unknown-key carrier) →
    canonical document via the record-shaped entry, so `projectId`/`name` ride along;
    carries `timelineRevision` (floor 1).
  - `unknownTopKeys(proj)`: deep-clones the projection's unknown top-level keys into
    `store.contentExtra`; re-frozen into the document `_extra` on the next save — the lossless
    channel is now a closed loop (this is exactly what the old fixed field list dropped).
  - `importProjection(data, legacySanitize)`: one entry for document exports and legacy v5.0
    files; `ChoreoDocument.validate` errors reject with a Chinese message; the projection then
    goes through the existing AUD-002 `sanitizeImportProject` so both shapes face the same
    count/type/length caps. Clip numeric ids come from the migration's identity-preserving
    projection (`ev-<oldId>`), fixing the array-position renumbering.
- **`web/test-docwire.js`** (new) — 45 checks: auto-detection, read-only inputs, unknown-key
  round trip, byte-idempotent save→load→save, revision carry/floor, id preservation, duplicate
  clip-id dedupe to unique numeric ids, import rejections (caps, duplicate event ids, junk —
  Chinese errors; legacy numeric rejection before migration coercion), key-shuffle determinism,
  and the real clip-shape freeze (job-switch / recorded `data.id`/`jobAbbr` / lyric / `autoDur`)
  through the whole wire.
- **`web/choreo-app.js`** — thin wiring: store gained `contentExtra:{}` + `_docRev:1`;
  `applyProjectContent` routes through `loadProjection` (seeds `_docRev` after its
  `bumpTimelineRev` so loading does not advance the persisted revision; toasts the warning);
  `projectRecord` routes through `persistDoc`; `bumpTimelineRev` also increments `_docRev`;
  `exportProject` downloads the document (pretty JSON); `importProject` routes through
  `importProjection` (ids from the projection, `recalcNextClipId()` instead of renumbering,
  keeps `autoFillGaps`/`repairClipNames`/history semantics). Snapshot baselines
  (`loadActiveProject`, `switchToRecord`) now stringify `projectRecord().content` so a legacy
  record's first session does not store a spurious "migration" auto-version.
- **`web/choreo-project-ui.js`** — same baseline change in `switchToRecord` (one line).
- **`web/choreo-helper-app.html`** — `choreo-document.js` + `choreo-docwire.js` load before the
  controller; **`web/test-shell.js`** asserts both in `orderedScripts` and `productFiles`
  (37 checks, was 33+1 added earlier); **`scripts/make-release-staging.js`** whitelist gained
  `choreo-docwire.js` (21 web entries); **`docs/AI-TEST-MATRIX.md`** fast suites gained
  `test-docwire`.
- **`scripts/library-verify.js`** — harness-only adaptation to the intended format change:
  `canonContent` is key-order-insensitive (projections rebuild objects; data equality, not byte
  equality, was always the assertion's intent) and the two crash-recovery mirror surgeries are
  doc-aware (`performers[0]` when the mirror holds a document, legacy `dancers` otherwise).
  Product code untouched by this item; every assertion's semantics preserved.
- **Docs**: `AI-BACKLOG.md` §9 CLOSED / §10 READY, `DESIGN-performance-script-v1.md` §15.1
  (wiring status + stale-snapshot policy), this handoff, `.agent/CONTINUITY.md`.

## Policy decisions locked (details in design doc §15.1)

1. Stored document = deterministic re-migration of the current projection, never a patch of the
   previous document → no stale `legacyLane`/`_extra` snapshots.
2. Only v0.7 data (motion/lyrics tracks) is round-tripped today; `movement`/`facing`/`cue`/
   `ability` tracks have no editor lanes yet — each future feature must extend the projection.
3. Record-layer `schemaVersion: 2` unchanged; the two version layers never read each other.
   Old builds would show a new-format record as empty (structural detection is the guard) —
   acceptable for a single-owner local app with synced roots; noted, not coded around.
4. The one-time `choreo_draft` migration (`legacyToProject`) still rebuilds 5 fixed fields —
   pre-existing, drafts never had extra keys, left out of scope.

## Verification (all observed this session)

- Red→green: vm repro above (8 losses → 0) against the real `choreo-app.js`.
- Eight Node suites green: engine **47**, edit **93**, check **73**, projects **96**,
  document **83**, **docwire 45**, library **91**, shell **37**.
- clip-check **134/134** on **both** the synced source-dist root and the synced game root
  (the first game-root run exposed the §20/§21 findings above — fixed, then re-run green on
  both roots), offline-verify **45/45**, library-verify **117/117** (library harness adapted:
  `canonContent` key-order-insensitive, mirror surgery doc-aware — assertion semantics
  preserved).
- Real-Chrome `file://` end-to-end smoke on the **deployed** copy, 13/13: IDB seeded with a
  legacy record carrying unknown keys/extra keys/id 7 → load (id/group/currentJob/autoDur/
  contentExtra/markers) → edit+save (mirror content is a schemaVersion-2 document, `_extra`
  carries `timing`/`stage`, `ev-7` at integer ms, revision 2) → reopen (everything back,
  second save byte-stable). Both temp scripts deleted after the runs.
- Release whitelist cross-check: 21 entries all exist in source-dist, `choreo-docwire.js`
  listed, no test files leaked, non-whitelisted dist files are exactly the 3 diagnostic pages
  plus `libs`/`libs-classic` (LIB_FILES inventory) and the owner-local `model.gltf`/`model.bin`
  (correctly excluded).
- Deploy sync: the changed web files (`choreo-app.js`, `choreo-project-ui.js`,
  `choreo-helper-app.html`, `choreo-docwire.js`, `choreo-document.js` unchanged,
  `clip-check.html` diagnostic) copied source → `web/dist/ChoreoHelper` → devPlugins
  root → game root; `diff -rq` source-dist vs each remote root both zero; four-way md5 equal
  for all of them (`choreo-app 4a8ea7ac…`, `choreo-project-ui 3c14eee8…`, html `8ab41360…`,
  `choreo-document 73de6435…` unchanged, `choreo-docwire 8c2c69ff…`, `clip-check 474cbec0…`).
  An accidental copy of `test-docwire.js` into source-dist was caught by the recursive diff and
  removed before the final verification (test files never ship).
- `git diff --check` clean; no C# changes (no build/run needed); release staging untouched.

## Owner tails

None new. Publication/commit remain owner-authorized only. The next owner-gated staging
rebuild will pick up `choreo-docwire.js` automatically via the whitelist entry.
