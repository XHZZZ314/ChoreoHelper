# HANDOFF 2026-08-31 — WP-5-DOC foundation: canonical performance document

Package: `AI-BACKLOG.md` §9 (first open unblocked package after 1–8 closed).
Status: **foundation landed**; package stays OPEN — repositories/UI wiring is the next increment.
Nothing committed, pushed or published; release staging untouched (still the FIX-K build).

## Reproduction first (red baseline)

The package's problem evidence ("fixed field lists silently drop unknown fields") was reproduced
against real code, not just read out of the source:

- A throwaway node script vm-loaded the real `web/choreo-app.js` with minimal `window/document`
  stubs, put a project content carrying unknown keys (`timing`, `stage`) through the actual
  `applyProjectContent(...) → projectRecord(...)` path, and observed both keys gone after one
  load→save round trip (`content` keys: `dancers, globalLyrics, dancerCount, showLyricMacro,
  totalDuration, markers`). Script deleted after the run; output recorded here.
- Code evidence for the other two loss points: `exportProject` (choreo-app.js:1249) builds the
  export file from a fixed whitelist; `importProject` (choreo-app.js:1321) rebuilds dancers with a
  fixed field list and re-numbers clip ids from array position (`{id:i,...}`), destroying identity.
- Dancer identity is array position (`makeDancer(idx) → id:idx`), time is float seconds — both
  contradict the ACTOR contract ("WP-5 must use stable actor IDs") and the design doc.

## What landed

- **`web/choreo-document.js`** — new pure classic module (no DOM/fetch/IndexedDB; node-testable
  via `globalThis.ChoreoDocument`). Owns schema, normalization, migration, structural validation,
  lossless unknown-field preservation and deterministic serialization:
  - Canonical schema v2 per `DESIGN-performance-script-v1.md` §2: integer milliseconds,
    stable IDs, `assetRef {kind,id}`, `timelineRevision`, six fixed track/event types
    (`motion/ability/movement/facing/cue/lyrics`), versioned `capabilities`
    (`{name, minProtocol}`), `timing`/`stage`/`metadata` sections per §3–§4.
  - Migration entry `ensureDocument(input)` auto-detects canonical document / WP-3 project record
    `{id,name,content}` / legacy 5-field draft; returns `{doc, issues, source}`. Fatal malformed
    input throws `ChoreoDocumentError` with a Chinese message (`E_NOT_OBJECT`, `E_NO_DANCERS`,
    `E_UNRECOGNIZED`, `E_PARSE`); the input object is never mutated, so the caller keeps the
    original file on failure (design doc §14).
  - Idempotent + deterministic: migration never reads clock/RNG — IDs derive from legacy identity
    (`actor-<legacyDancerId>`, `ev-<legacyClipId>` with deterministic dedupe, `tr-<i>-<type>`,
    `mk-<i>` for id-less markers); `ensureDocument(ensureDocument(x))` is byte-identical.
  - Lossless channels: unknown keys on canonical docs preserved in place; legacy extras frozen —
    clip extras → event `_extra`, dancer extras → performer `_extra`, unknown content top-level
    keys → document `_extra`; the whole legacy `data` payload rides along per event; migrated
    events carry `legacyLane` (`switch/action/lyric/globalLyric`) so the projection restores lanes
    exactly. `legacyLane`/`_extra` are migration-era reserved fields the future compiler ignores.
  - Unknown track/event types are disabled with a warning issue and kept, never deleted (§2).
  - `validate(doc)` → schema-level issues `{level, code, message(中文), path}` (duplicate/missing
    IDs, non-integer ms, bad `assetRef` shape, orphan track, missing performer start point → hint,
    future `schemaVersion` → hint, short duration → hint). Choreography-conflict checking stays in
    `choreo-check.js` later.
  - `toLegacyContent(doc)` → today's WP-3 content shape: numeric clip ids restored from
    `ev-<n>` suffixes (doc-native events get deterministic fresh numbers), lanes restored from
    `legacyLane`, view state (solo/mute/collapsed/laneScale/showLyricMacro) restored, `_extra`
    re-spread — current UI can consume the projection unchanged.
  - `serialize(doc)` → key-order-canonical compact JSON (same doc ⇒ same bytes regardless of key
    insertion order); `parse(text)` is its entry-point inverse; `bumpTimelineRevision(doc)`.
- **`web/test-document.js`** — 76-check regression suite, house ✔/✘ style. Covers: ms conversion
  and serialization determinism; legacy-draft and schema-2 migration; stable IDs under reorder and
  deterministic dedupe; unknown-field preservation (content-, clip-, dancer-level); input
  read-only; migration idempotency; projection round trip (ids, lanes, view state, markers,
  unknown keys back on content); unknown-type disable-not-delete; malformed inputs and Chinese
  errors; `timelineRevision`; capability validation; `validate` catalog; API surface.
- **Registration**: `choreo-document.js` added to the `WEB_FILES` whitelist in
  `scripts/make-release-staging.js` (the file ships with the app but is not yet referenced by
  `choreo-helper-app.html` — wiring is intentionally out of this package, so loading order is
  unchanged); `web/test-document.js` added to the fast suites in `docs/AI-TEST-MATRIX.md`.
- **Docs**: `DESIGN-performance-script-v1.md` gained §15 "Implementation status" locking the
  naming/layering decisions (two version layers, `assetRef` over `sourceRef`, `_extra`/`view`
  placement, two lyrics homes, sub-ms quantization); `AI-BACKLOG.md` §9 records the landed
  increment; `.agent/CONTINUITY.md` updated.

## Verification (all observed this session)

- `test-document.js` **83/83** (red baseline = the live repro above; green after implementation).
  Extended beyond the first 76 checks with §12 "real shape freeze": the exact clip insertion
  shapes from `choreo-app.js:845/848/865` (job-switch `isJobSwitch/jobName/jobId`, recorded
  action `data.id/jobAbbr`, lyric `isLyric`, the clip-level `autoDur` key, and the `clips` alias
  that `importProject` accepts) now round-trip byte-exactly — a code-derived start on design doc
  §14's "freeze old-project samples" requirement.
- Deepened self-test (same session, owner delegated full self-testing):
  - Real-Chrome file:// smoke of the **deployed** copy (`web/dist/ChoreoHelper/choreo-document.js`)
    — headless Chrome parsed and executed it as a classic script and the in-page
    migrate→idempotency→projection assertion passed (`WP5DOC-SMOKE-PASS` in `title`/`#out`); so the
    shipped file cannot be silently broken before WP-5-WIRE wires it into the shell.
  - 300-case fuzz over randomly malformed legacy docs (missing/duplicated ids, sub-ms and
    non-numeric times, unknown keys at every level): input read-only, byte idempotency,
    key-order-shuffle determinism, zero error-level issues, projections built — 300/300.
  - Release whitelist cross-check: all 20 `WEB_FILES` entries exist in source-dist, the new module
    is listed, no `test-*` file leaked into the whitelist, and the only non-whitelisted dist pages
    are the three diagnostic pages that must not ship (correct per FIX-K).
- Seven Node suites green: engine **47**, edit **93**, check **73**, projects **96**, document
  **83**, library **91**, shell **33**.
- clip-check **134/134** on source-dist **and** game root.
- offline-verify **45/45**; library-verify **117/117**.
- Deploy sync: module copied to all three roots; `diff -rq` source-dist vs devPlugins root and vs
  game root both zero; new file four-way md5 `73de6435d2324761fcebdf73b218dcef` (the module itself
  did not change after sync — only the test suite grew, and test files do not ship).
- C# untouched (no build/run needed); release staging untouched.

## Next increment: WP-5-WIRE (claim after this)

Route `projectRecord`, `applyProjectContent`, `exportProject`, `importProject` (and the mirror /
version snapshots) through the document module so repositories store documents and the UI edits
projections. Constraints to honor then:

1. `ACTOR`: keep stable actor IDs out of array positions; the plugin payload builder keeps using
   its own sanctioned path until EXEC-CORE.
2. Editor edits bump `timelineRevision` through the document, not only `store._tlRevision`.
3. Once documents are the edit surface, projections must derive from canonical fields — decide the
   policy for stale `legacyLane`/`_extra` snapshots at that point (documented in design doc §15).
4. Data-format change rules apply: migration + old-data tests + three-root sync + shell gate.

## Owner tails

None new. Publication/commit still owner-authorized only.
