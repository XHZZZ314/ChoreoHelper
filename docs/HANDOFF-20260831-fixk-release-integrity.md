# HANDOFF 2026-08-31 — FIX-K release integrity and provenance

## What closed

Package 8 in `docs/AI-BACKLOG.md` (FIX-K, P2 release blocker). The public-staging pipeline now
proves privacy instead of assuming it. Nothing was committed, pushed or published; `release/staging`
was rebuilt locally only.

## Reproduction evidence (before the fix)

1. **DLL shipped with owner-local build path.** The old staged `ChoreoHelper.dll` (from the
   RELEASE-G build) carries a CodeView debug entry `D:\choreohelper\src\obj\x64\Release\
   net10.0-windows\ChoreoHelper.pdb` (byte offset 198652). The old scanner only read
   `.html/.js/.json/.gltf/.txt/.css`, so the DLL was never content-scanned.
2. **Packaging flow was broken by SEC-1.** `make-release-staging.js` probed `48795/export/list`
   and `make-offline-assets.js` fetched `48795/export/skeleton` anonymously; both are paired reads
   since SEC-1 (`ReadAuthPolicy.IsPairedExportRead`). Live probe: anonymous `/export/list` → 403.
   The snapshot step (iron rule: regenerate live) could no longer run.
3. **Scanner blind spots** (AUD3-S1): case-sensitive patterns, no `C:/Users` slash variants, scan
   ran before README.txt/manifest writes, FORBIDDEN name check case-sensitive, `WEB_DIRS` copied
   whole `libs`/`libs-classic` directories blind.
4. **Dirty-source provenance lie.** Manifest `gitCommit` reported HEAD `522fbbd` while the actual
   source is a 155-entry dirty working tree (owner's uncommitted work — permanent state here).

## Root-cause fixes (minimal)

- `src/ChoreoHelper.csproj`: Release-only `PathMap` — repo root maps to `/build/`. The rebuilt DLL's
  CodeView entry now reads `/build/src/obj/...ChoreoHelper.pdb`; a byte sweep finds **no** `X:\…`
  absolute path at all. Debug build untouched. New Release DLL md5 `2a105682…` (the live devPlugins
  DLL stays the owner-managed FIX-J build `90759acf…`; it is NOT touched by this package).
- `scripts/release-gates.js` (new pure module): pattern variants (lowercase + `\` `/` `\\`),
  dynamic repo-root pattern, binary/latin1 `scanText`/`scanTree`, README-only documented-term
  allowlist (`%AppData%\XIVLauncherCN\devPlugins`, `XIVLauncherCN`), case-insensitive FORBIDDEN
  check, `inventoryDiff`, `diffTreeFiles` (per-file sha256), sha256 helpers.
- `scripts/test-release-gates.js` (new regression suite): **28/28** — variant hits, binary DLL
  blob scan, README exemption semantics (residue still scanned; non-README flagged), forbidden
  case-insensitivity, inventory missing/unexpected, tree diff changed/missing/unexpected, sha256
  known vector. Red-first evidence: the same gate run against the pre-FIX-K staging flagged
  `ChoreoHelper.dll → d:\choreohelper` (1 hit), and against the rebuilt staging → 0 hits.
- `scripts/make-offline-assets.js`: reads the local pairing code
  (`%APPDATA%\XIVLauncherCN\pluginConfigs\ChoreoHelper\pairing.json`, same source as
  offline-verify) and sends `X-Choreo-Token` on the 48795 skeleton read; 48794 public catalog
  reads stay anonymous. Clear Chinese failure if unpaired.
- `scripts/make-release-staging.js`: probe now token-authenticated (pairing code passed via env,
  never the command line); README written **before** scanning; manifest/SHA256SUMS written before
  the final gate; the gate scans **every** staged file as binary after **all** writes, case- and
  slash-insensitive, including the repo-root pattern, with only README's documented install terms
  exempt; `libs`/`libs-classic` copy is an explicit 8-file inventory (`LIB_FILES`) that rejects
  unexpected/missing files instead of blind `copyDir`; stand-in byte-check covers both trees;
  both zips are extracted to a temp dir, diffed per-file sha256 against the staged trees, rescanned
  with the same gate, then removed; manifest gains `sourceIdentity` (`gitHead`, `workingTree:
  dirty（155 项…）`, explicit note that HEAD is only a baseline) plus a content `sourceDigest`
  (sha256 over the sorted per-file hash lines). FORBIDDEN check is case-insensitive.

## Verified (this package)

| Check | Command | Result |
|---|---|---|
| Gates regression | `node scripts\test-release-gates.js` | 28/28 |
| Red on old artifact | scanTree(old staging, buildPatterns) | 1 hit `ChoreoHelper.dll → d:\choreohelper` |
| Green on new DLL | byte probe after PathMap rebuild | 0 hits, no `X:\` strings, CodeView `/build/…` |
| C# data layer | datalayertest `-c Release` | 245/245 |
| Release build | `dotnet build -c Release --no-incremental` | 0 errors / 0 warnings |
| Web suites | test-engine/edit/check/projects/library/shell | 47 / 93 / 73 / 96 / 91 / 33, all 0 fail |
| clip-check | default (game root) + `web\dist\ChoreoHelper\clip-check.html` | 134/134 both |
| offline-verify | `all` | run1 44/45 (transient flake, item name not captured), run2+run3 45/45 |
| library-verify | `all` | 117/117 |
| Staging acceptance | temp verify script (deleted after) | 16/16: staged DLL==build & path-clean, stand-in byte-equal in both trees, no model.bin, no forbidden files, whitelist ∪ {README,model} exact, manifest/SUMS/zip hashes consistent |
| Deploy roots | sync 2 regenerated snapshots → devPlugins + game roots, then `diff -rq` | recursive zero vs both roots; catalog `0767a152…`, skeleton `3ef1c320…` four-way equal |
| Hygiene | `git diff --check` | clean; temp files removed |

Staging rebuild output: snapshots regenerated live from the running game (token'd skeleton fetch;
305 emotes / 2121 actions / 44 classes, 101 bones), 118 files scanned incl. zip re-scan, 0 hits.
`MANIFEST.json`: `gitCommit 522fbbd…` + `sourceIdentity.workingTree dirty（155 项未提交改动）`
+ `sourceDigest 11675886804d…`; zips `ChoreoHelper-web-0.7.1.zip` 0.8MB, `ChoreoHelper-plugin-0.7.1.zip` 0.8MB.

## Constraints honored / owner tails

- No commit, push, publish, remote creation. Staging stays local and **unpublished**; the staged
  tree is now post-FIX-H/ARCH-1/SEC-1/FIX-J/FIX-K but release to GitHub still requires the owner's
  explicit authorization (SPEC §release line 94 untouched).
- The live plugin install (`devPlugins/ChoreoHelper/ChoreoHelper.dll`, `90759acf…`) was not touched;
  the path-mapped build reaches the live game only via a future owner-authorized DLL update.
- SPEC §release lines 92–93 remain accurate; FIX-K strengthens the same gates without changing
  product behavior (csproj PathMap affects Release metadata only; Debug build byte-path unchanged).
- Scripts/tests and docs are the only surfaces: no web product file changed (the two regenerated
  snapshots are script outputs, synced to all three roots).

## Next

WP-5-DOC (canonical performance document) is now unblocked — packages 1–8 are all CLOSED.
