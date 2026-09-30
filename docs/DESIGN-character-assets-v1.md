# Character Asset Scheme v1 Design (per-dancer local profiles)

> Status: design contract; the six registered implementation packages (P1–P6) all closed
> 2026-09-04/05 in the working tree (live roots pre-P2). §13 records the
> implementation-verified constraints from those closeouts.
> Ticket: `.agent/tickets/TASK-20260903-PER-DANCER-CHARACTER-ASSETS.json`.
>
> Local-first invariants (apply to every section below): personal models, actions and projects
> stay on the player's own machine; no accounts, no cloud storage, no telemetry and no
> community library. Sharing is local point-to-point file exchange between owners only.

## 0. Ground truth: the current v2 profile library

- The library keeps one active character profile behind the legacy API: the `activeProfile`
  meta pointer plus legacy `getSkeleton`/`putModelFile` thin wrappers
  (evidence: `web/choreo-library.js` header lines 12-18, `web/choreo-library.js:247`,
  `web/choreo-library.js:358`, `web/choreo-library.js:397`).
- Profile bodies live in the `meta` store as `profile:<pid>` records with inlined skeleton;
  model files live in the `files` store under `pfile:<pid>:<name>` keys
  (evidence: `web/choreo-library.js:212-214`, `web/choreo-library.js:239-250`).
- Migration from legacy fixed names (`model.glb`/`model.gltf`/`model.bin`) runs once on first
  access and retries after transient failure
  (evidence: `web/choreo-library.js:206`, `web/choreo-library.js:225-262`).
- Every model file carries a content hash and every action carries `profileId`/`skeletonHash`;
  backup `CHLB v2` runs an atomic whole-bundle preflight (structure, hashes, skeleton
  relation, glTF-to-bin pairing) and refuses the entire bundle on any failure
  (evidence: `web/choreo-library.js:20-28`, `web/choreo-library.js:886-949`).
- The 3D preview drives all rigs from one model master with `usedStandin`, `profMismatch`
  and `autoSwitched` flags; a game/local mismatch keeps the profile and offers one-click
  adopt-as-new-profile (evidence: `web/preview3d.js:54-69`, `web/preview3d.js:699-727`).
- Per-dancer editing exists (track copy, unison insert) but per-performer asset binding does
  not: game preview sends only the single preview dancer
  (evidence: `web/choreo-edit.js:299-317`, `SPEC.md` game-preview acceptance row).
- Public staging is whitelist-only and stand-in-only; personal model binaries, clips,
  diagnostic pages, local paths and private configuration never ship
  (evidence: `SPEC.md` release-and-security rows, `docs/PRODUCT-ROADMAP-20260829.md` §5 rule 6).

## 1. Per-dancer profile binding

- Each dancer (performer slot, 1-8 for this scheme; documents validate up to 12) references
  one local character profile id (`profileId`) instead of the single global `activeProfile`.
  The reference rides the existing per-dancer document shape so unknown keys ride `_extra`
  and six-track carriers (`_doc`) keep working
  (evidence: `web/choreo-library.js:239-247`, `web/choreo-edit.js:299-317`,
  `docs/DESIGN-performance-script-v1.md` §5).
- Binding is local-only: a profile id resolves against the owner's own `meta` store; a
  reference that resolves to nothing is not an error at load time — it triggers the
  stand-in fallback (§4) and a health-check hint, never a silent rebind
  (evidence: `web/preview3d.js:66-69`, `web/choreo-library.js:358-361`).
- The current single-active-profile preview flow is preserved as "no per-dancer binding
  set": an empty/missing reference means the existing `activeProfile` behavior
  (evidence: `web/preview3d.js:54-69`).
- Invariants: local-first, no accounts, no cloud, no community library; binding edits never
  touch another performer's game client.

## 2. Direct GLB and Meddle glTF+bin import

- The web app imports a user-picked `.glb` file or a Meddle-exported `.gltf` + companion
  `.bin` directly into the bound profile's `pfile:<pid>:` namespace. No copying files into
  `web/dist` roots and no renaming to fixed filenames
  (evidence: `web/choreo-library.js:206-214`, `SPEC.md` character-model-route row).
- A `.gltf` import must resolve every external-buffer `uri` against files imported in the
  same operation (the `model.gltf` ↔ `model.bin` pairing rule already enforced by backup
  preflight), else the import is rejected with a plain-language reason
  (evidence: `web/choreo-library.js:923-939`).
- Imported bytes are content-hashed at intake; the hash is stored beside the file record
  and reused by reuse (§8) and share (§3) validation
  (evidence: `web/choreo-library.js:906-922`).
- Invariants: local-first, no accounts, no cloud, no community library; imports never
  upload user models anywhere.

## 3. Single-role .choreochar share package

- `.choreochar` is a new single-role share format: exactly one character profile (skeleton
  + its model files + profile-scoped action clips + catalog slice), never project data,
  never personal configuration, never absolute paths. Format and material-scope choices
  stay owner decisions until a later package's QA review records them
  (evidence: `web/choreo-library.js:20-28` for the CHLB v2 envelope pattern to mirror,
  `SPEC.md` explicit non-goals).
- Adoption is atomic: the receiver validates the whole package before touching the local
  library (structure, per-file hashes, skeleton-hash-vs-content, glTF-to-bin pairing —
  the same four preflight classes as `preflightV2`), and any failure leaves existing data
  byte-unchanged (evidence: `web/choreo-library.js:883-949`).
- Imported profiles arrive under fresh local ids; name collisions are resolved locally
  without overwriting the receiver's profiles or clips
  (evidence: `web/choreo-library.js:30-33` composite action identity).
- Invariants: local-first point-to-point file exchange only; no accounts, no cloud, no
  community library; the sender's projects and pairing state never travel.

## 4. Stand-in fallback on missing or incompatible assets

- Any dancer whose bound profile is missing, whose model bytes fail hash check, or whose
  skeleton fingerprint mismatches the clip set renders with the built-in stand-in model
  and a per-dancer notice; choreography data is never blocked
  (evidence: `web/preview3d.js:66`, `web/preview3d.js:801`, `web/preview3d.js:1046`,
  `SPEC.md` character-model-route row).
- The mismatch rule mirrors today's `profMismatch` semantics (bone count + hash shown,
  profile kept, explicit adopt offered) extended per dancer
  (evidence: `web/preview3d.js:67-69`, `web/preview3d.js:220-221`).
- Public staging and the published site always use the stand-in regardless of local
  bindings (evidence: `SPEC.md` release-and-security rows,
  `docs/PRODUCT-ROADMAP-20260829.md` §5 rule 6).
- Invariants: local-first, no accounts, no cloud, no community library; fallback never
  phones home or downloads a model.

## 5. Performer asset reference migration

- Existing single-profile libraries migrate untouched: `ensureProfiles`/`ensureClips`
  behavior is preserved, and all current dancers initially resolve to the migrated
  `activeProfile` (evidence: `web/choreo-library.js:225-262`,
  `web/choreo-library.js:270-279`).
- Pure-legacy v0.7 saves stay byte-stable and six-track `_doc` carriers keep riding
  through; migration only adds per-dancer references, never rewrites clip bytes
  (evidence: `docs/AI-ARCHITECTURE.md` runtime-shape note,
  `docs/DESIGN-performance-script-v1.md` §5).
- Ambiguous legacy clips keep today's `__pending__` claim flow instead of silent binding
  (evidence: `web/choreo-library.js:30-33`, `web/choreo-library.js:47`).
- Invariants: local-first, no accounts, no cloud, no community library; failed migration
  never overwrites the original project or library (roadmap §5 rule 5 pattern).

## 6. Multi-skeleton and multi-model preview

- The preview keeps one model master per distinct bound skeleton and instantiates per-dancer
  rigs from the matching master; today's single `modelRoot`/`rigs` flow becomes one entry
  in a small master table keyed by skeleton fingerprint
  (evidence: `web/preview3d.js:52-59`, `web/preview3d.js:593`).
- Clip cache keys already include the profile id; multi-model preview extends that rule so
  two dancers sharing one action name never share normalized clips across skeletons
  (evidence: `web/preview3d.js:61`).
- Online game skeleton still upgrades only the matching profile; other dancers keep their
  own masters and mismatch notices (evidence: `web/preview3d.js:699-727`).
- Invariants: local-first, no accounts, no cloud, no community library; preview works
  with the game closed using cached masters and the stand-in.

## 7. Action clip namespaces

- Action identity stays the composite `(profileId, actionName)` in `profileClips` /
  `profileClipData`; per-dancer binding therefore namespaces clip lookup automatically:
  dancer → profile → namespaced clip (evidence: `web/choreo-library.js:30-33`).
- Same-name actions of different profiles never overwrite each other; cross-profile
  fallback (e.g. playing another profile's clip on this dancer) is explicit UI, never
  implicit, and stays a later package's decision
  (evidence: `web/choreo-library.js:270-279`, `SPEC.md` character-vs-action asset row).
- Health check keeps reporting clip↔skeleton fingerprint mismatches per dancer
  (evidence: `SPEC.md` health-check row, `docs/WORKPLAN-20260829.md` WP-4).
- Invariants: local-first, no accounts, no cloud, no community library.

## 8. Resource reuse across profiles

- Identical model bytes across profiles are stored once and referenced by content hash;
  the `files` store already carries per-file hashes to key that dedupe
  (evidence: `web/choreo-library.js:906-922`).
- Gzip-compressed action storage keeps its byte-exact round-trip guarantee; reuse never
  introduces lossy quantization (evidence: `SPEC.md` lossless-compression row,
  `web/choreo-library.js:4-7`).
- Deleting a profile removes only unreferenced bytes; bytes still referenced by another
  profile or by an exported share draft are retained
  (evidence: `web/choreo-library.js:248-257` move-without-duplication pattern).
- Invariants: local-first, no accounts, no cloud, no community library.

## 9. Dancer-count acceptance (1-8)

- The scheme accepts 1-8 visibly bound dancers with per-dancer fallback notices; document
  import validation (up to 12) is unchanged and out of scope for this acceptance
  (evidence: `SPEC.md` performance-script foundation row,
  `docs/HANDOFF-20260901-six-track-roundtrip.md`).
- Acceptance per dancer count: every dancer resolves to its bound profile, the stand-in,
  or an explicit missing notice; no dancer silently borrows another dancer's model
  (evidence: `web/preview3d.js:66-69`, `web/preview3d.js:801`).
- Game preview still drives exactly the one explicitly selected dancer; multi-dancer web
  rehearsal is unaffected (evidence: `SPEC.md` game-preview acceptance row).
- Invariants: local-first, no accounts, no cloud, no community library.

## 10. Compatibility with the v2 store, legacy saves and carriers

- The v2 store shape (`profile:<pid>`, `pfile:<pid>:<name>`, `activeProfile`, composite
  clip keys, content hashes, glTF/bin pairing, legacy fixed-name migration) is extended,
  not replaced (evidence: `web/choreo-library.js:204-262`,
  `web/choreo-library.js:883-949`).
- `CHLB v1` backups stay read-only importable; per-dancer references are a v2-level
  addition that degrades to "all dancers use activeProfile" on older readers
  (evidence: `web/choreo-library.js:20-21`).
- `librarySchemaVersion` guards the on-disk change; protocol/capability versions RTC
  follow the existing `/capabilities` handshake pattern when a later package needs them
  (evidence: `docs/PRODUCT-ROADMAP-20260829.md` §5, `SPEC.md` capabilities row).
- Invariants: local-first, no accounts, no cloud, no community library.

## 11. Privacy and security for local-first sharing

- `.choreochar` payload is privacy-minimal: one profile's skeleton, model bytes,
  namespaced clips and catalog slice only. Excluded by construction: projects, lyrics,
  audio, pairing tokens, plugin sessions, credentials, absolute paths and local
  configuration (evidence: `SPEC.md` explicit non-goals,
  `docs/PRODUCT-ROADMAP-20260829.md` §2 explicitly-not-doing).
- Validation-before-adoption (§3) plus stand-in fallback (§4) means a hostile or corrupt
  package can at worst refuse to import; it can never alter existing library bytes
  (evidence: `web/choreo-library.js:883-886` all-or-nothing preflight comment).
- Sharing transport is the owner's own file exchange (removable media, direct
  machine-to-machine copy); no endpoint, upload or directory service is introduced, and
  game-control pairing rules are untouched
  (evidence: `SPEC.md` game-control-endpoints row, `src/HttpServer.cs` via
  `docs/AI-ARCHITECTURE.md`).
- Invariants restated: local-first, no accounts, no cloud storage, no community library;
  personal model binaries, clips, diagnostic pages, local paths and private configuration
  must not ship to public staging (evidence: `docs/PRODUCT-ROADMAP-20260829.md` §5 rule 6).

## 12. Dependency-ordered implementation split (this package registers)

Six deferred packages, each a `PROCESS-STATE` deferred row plus a thin draft ticket whose
`prerequisites` array encodes the order; full BDD contracts are authored at each package's
own QA review after the owner enables it:

1. Binding + performer migration (§1, §5).
2. Direct import UX (§2).
3. Multi-model preview + stand-in fallback (§6, §4).
4. Namespaces + resource reuse (§7, §8).
5. `.choreochar` share package (§3, §11).
6. 1-8 dancer acceptance (§9, §10).

See `.agent/PROCESS-STATE.json` deferred orders 31-36 and
`.agent/tickets/TASK-20260903-CHARACTER-ASSETS-*.json`.

## 13. Implementation-verified constraints (P1–P6 closeouts)

Recorded from the P1–P6 closeouts (2026-09-04/05, working tree) so the entry continuity can
stay a pointer; current code and the P1–P6 handoffs remain the evidence:

- Binding: `profileId` binds only as a non-empty same-name string (other shapes ride
  `_extra`); `resolveBindings` never silently rebinds. Binding entry is one dancer-row
  select via `setDancerBinding` (clear removes the key); no-binding sessions keep the
  single-master fast path. `getProfile(pid)` is the read-only accessor.
- Import: `importModelSet` validates exactly one model set (GLB magic, glTF parse,
  companions matched by basename against the picked set), then replaces the profile's
  `pfile` rows + `modelNames` in one transaction; imported sets ride the same three load
  gates; fixed-name paths stay byte-identical.
- Preview: `planRender` is the pure master planner — one master per distinct resolvable
  fingerprint; skeletoned model-less profiles keep their own master (reason `no-model`).
- Reuse: model bytes live once per SHA-256 (`mblob:` payload + `pfile:` reference rows;
  legacy inline reads; bundles export inline and re-dedupe); reclamation follows surviving
  references in-transaction. `copyClipToProfile` is the only (user-confirmed) cross-profile
  writer; preview/check resolve per dancer's own namespace (`missing-clip-ns`).
- Share: `.choreochar` v1 envelope magic is `CHRC` (distinct from `CHLB`); adoption is one
  transaction with a fresh profile id.
