# HANDOFF — RELEASE-G: docs, deploy, and release gates (2026-08-30)

> 给主人：本包全部在本机完成——没有创建远程、没有 push、没有发布任何东西。发布（GitHub 远程/Release/Pages）仍然需要您单独明确授权。

## Scope

RELEASE-G (AUD2-013, P3) per `docs/AUDIT-20260830-code-repair/07-RELEASE-G-DOCS-DEPLOY.md`. This package is hygiene only: status docs, deploy-location consistency, warning cleanup, staging rebuild. **Not a release**: nothing left this machine.

## 1. Consistency audit before starting (CONTINUITY/SPEC vs code)

- Version 0.7.1 in `plugin.json` + `csproj` ✓.
- Node suites reproduce recorded counts: engine 40 / edit 87 / check 73 / projects 96 / library 71 ✓.
- datalayertest 130/130 ✓ (unchanged sources, re-run as baseline).
- OPT-F feature markers all present in code (txDone, `choreo_deleted_projects` tombstones, `_modelCache`, DPR cap 2, visibilitychange stop, bin back-fill, `loadedBuf`) ✓.

**Conflict found (code wins, reported):** CONTINUITY item 29 and `HANDOFF-20260830-optf-txn-and-preview-perf.md` recorded deployed `preview3d.js` md5 `7e8a1ea7`, but all four roots actually held `afbf37e5` (mtime 18:01 — the final bin-back-fill fix landed after the hash was recorded; the handoff text documents the fix itself but its hash line was never refreshed). Resolution: treated current code as truth, re-ran the full online regression on it (library-verify **106/106**, game online; offline-verify **38/38**; modelswitch counts match the handoff exactly: A2/B2 = parse0/digest1/put0). Records updated in CONTINUITY.

## 2. AUD2-013 discrepancy list — what was still true and what was done

| Item from 07 | State found | Action |
|---|---|---|
| README-AI says WP-4 pending / next OPT-1 | Already fixed by the 08-30 English docs rewrite | none needed |
| CONTINUITY duplicate "next step" headings | Already fixed by rewrite | none needed |
| SPEC item 67 wording (skeleton mismatch reject) | Already fixed by rewrite | none needed |
| Game-dir `skeleton-snapshot.js` differs from other roots | **Still true**: game dir held the 08-28 20:14 generation, dist/devPlugins the 08-29 02:08 generation | synced newest generation, then superseded by pack-time regeneration (below) |
| `release/staging` still 0.6.7 | **Still true** | rebuilt at 0.7.1 (below) |
| Release build 6 warnings + broad `NoWarn` | **Still true** | cleaned (below); `NoWarn` line removed entirely |
| Home page renders literal `u4F4Du7F6E` | **Still true** (`choreo-helper-app.html:392`) | fixed to `位置：` |

## 3. Changes

### Web (1 file)
- `web/choreo-helper-app.html`: cursor-position readout `'u4F4Du7F6E: '` → `'位置: '` (escaped-unicode had lost its backslashes). New md5 `9c441d9a`, synced to all three deploy roots; also the version packaged into staging (MANIFEST sha256 `ac10310c…` matches).

### Deploy locations
- `skeleton-snapshot.js`: synced newest generation to game dir, then `make-release-staging.js` regenerated snapshots live from the running game (catalog 368031 B, 305 emotes, version ChineseSimplified; skeleton 12869 B, 101 bones; standin 26869 B unchanged). Final deployed set synced to all roots.
- **Three deploy roots verified byte-identical** (`diff -rq` recursive, zero differences; includes the owner's real `model.gltf`+`model.bin`, identical everywhere — local installs only, never packaged).

### C# (hygiene, no behavior change intended)
- `Plugin.cs`: removed duplicate `using Dalamud.Plugin.Services;` (CS0105).
- `Exporter/ExportServer.cs`: deleted `_lastStatus` (assigned, never read — CS0414; superseded by FIX-E `InFlightTracker`).
- `AnimationPoseFreezer.cs`: deleted never-referenced fields `_lastIdleObserve`, `_idleCandidate` + `_idleCandidateFrames` (marked deprecated since v0.5.19), `_lastLog` (CS0169 ×4).
- `HttpServer.cs`: deleted dead `ctx503()` (private, zero call sites, `throw NotImplementedException`); `Encoding.UTF8.GetBytes(json)` → `json ?? "{}"` (CS8604).
- 13 CS8604 log-arg sites coalesced: `_pendingCommand ?? "-"` ×10 (`AnimationPoseFreezer.cs`), `_recCmd ?? "-"` ×2 (`BoneAnimator.cs`), plus the `json` site above. Log text unchanged in all real paths.
- `ChoreoHelper.csproj`: **`NoWarn` line removed entirely.** Probe build with no suppressions: 0 warnings — the whole list (CS0436 + six CS86xx) was stale masking; none of those diagnostics occurs anymore.

### Docs
- `docs/README-AI.md`, `.agent/CONTINUITY.md`: RELEASE-G closed; misleading "only when releasing" phrasing corrected (the package was always pre-release hygiene; only remote/push/publish needs per-task authorization); next development package = WP-5, entered only with owner direction. SPEC staging boxes checked (below). This handoff.
- `docs/AUDIT-20260830-code-repair/07-RELEASE-G-DOCS-DEPLOY.md`: DoD checkboxes marked.

## 4. Verification actually run (2026-08-30)

- Release build **0 errors / 0 warnings** with `NoWarn` removed (`--no-incremental` full recompile); Debug build same, auto-copy to devPlugins OK.
- datalayertest **130/130** (`DOTNET_ROLL_FORWARD=Major`).
- Node suites: engine 40, edit 87, check 73, projects 96, library 71 — all pass.
- offline-verify **38/38** (run three times today: pre-change baseline, post-html-fix, final state).
- library-verify **106/106** against the real online plugin (today; this is the online regression evidence for the previously unrecorded `afbf37e5` preview3d state).
- Staging rebuild: `make-release-staging.js` — privacy scan pass (20 site files / 22 plugin files), `model.gltf` byte-equal to `web/model-standin.gltf`, no `model.bin`, MANIFEST (gitCommit `522fbbd`, protocolVersion 1) + SHA256SUMS + Chinese README. Output `release/staging/`: `ChoreoHelper-web-0.7.1.zip` + `ChoreoHelper-plugin-0.7.1.zip` (~0.8 MB each).

## 5. Not done / still open

- **Plugin zip real-install regression**: untested (would overwrite the owner's live install) — same limit as WP-2. Owner should install the 0.7.1 plugin zip when convenient.
- Public release items stay unchecked in SPEC (stand-in-only public release; GitHub ship) — they need the owner's explicit release authorization.
- C# test project stays net8.0 + roll-forward (unification goes through the old RELEASE-1/AUD-021 path, out of this package).
- Owner tails unchanged: Meddle model deploy, dual-profile on-machine acceptance, FIX-E pressure observation, OPT-F feel.

## 6. Next package

**WP-5: unified performance-script schema and migration** (`docs/AUDIT-20260830-code-repair/09-NEXT-DEVELOPMENT.md` §2). Gates are now met (repair set cleared, regressions green). Enter only with owner direction; it touches project schema and protocol semantics, so it deserves an explicit go.
