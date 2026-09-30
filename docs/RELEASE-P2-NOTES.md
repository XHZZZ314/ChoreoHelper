# RELEASE-P2-NOTES (agent-facing, English)

Batch: TASK-20260927-RELEASE-P2, Phase A (offline, 2026-09-27). This file is the
stale-item inventory plus the reproducible-build note required by contract §A5.
Nothing here authorizes publication, push, or whole-product acceptance.

## 1. Stale / superseded items (do not act on without a scoped task)

1. **Staging README pairing note** (`scripts/make-release-staging.js` template
   ~:254-255: "pairing unavailable"): stale relative to the Plugin.cs recovery —
   `/choreo pair` is wired in source (`src/Plugin.cs:260`, startup print `:182`,
   help `:173`). Rewording requires in-game pairing-handshake evidence (owner step
   unless Phase B proves the HTTP handshake). Left untouched this batch.
2. **`docs/WORK-INSTALL-STARTUP.md` 2026-09-25 status block**: reconciled by a new
   dated 2026-09-27 block on top (this batch). The older paragraphs underneath are
   history; the open `/choreo web` rework discussion there is superseded by
   "removed, stays removed".
3. **Release number question**: csproj `<Version>` was aligned to
   `plugin.json` + `.0` (0.6.2.0 → 0.7.1.0) with no bump decision. Whether 0.7.1 is
   the right public release number is an owner decision, recorded here, not taken.
4. **Pre-existing csproj drift vs HEAD**: the working tree already carried an
   added `Dalamud.Bindings.ImGui` reference block (+4 lines, UTF-8 BOM) before this
   batch (porcelain-before line `M src/ChoreoHelper.csproj`; HEAD blob sha
   `eb41a343…` 2540 B vs batch-start `02a33d73…` 2735 B). It comes from the
   earlier PLUGIN-CS-RECOVERY batch, is required to build, and was NOT touched
   here — this batch's edit is exactly line 13 (before `02a33d73…` → after
   `f2f8d67d…`, same length). Do not "clean it up" in a release batch.
5. **N1/N2 wording notes** (RELEASE-P1): untouched per standing instruction;
   still open, still out of scope.
6. **12 runtime-risk items** (PLUGIN-CS-RECOVERY R2-RECORD: BeginPath-6,
   OwnedShowLoadPolicy, fail-closed adapters, …): never game-verified (no game
   ops authorized in this batch or that one). Still open.
7. **Old 2026-09-20 `release/staging/MANIFEST.json`**: superseded, preserved as
   `phase-a-impl-20260927/before/staging-MANIFEST-20260920.json`
   (sha `c4d0c11e…`). Phase B wipes and rebuilds `release/staging/`.
8. **Snapshot bytes**: `web/dist` snapshots in this batch are the pre-existing
   on-disk files (catalog 724757 B `5af1dcf8…`, skeleton 12932 B `79089407…`,
   standin 26869 B `f73dfba4…`); they were NOT regenerated (that needs the game).
   Phase B regenerates them in place via `make-offline-assets.js`.
9. **Drill method limits** (recorded, not hidden): headless Chrome used
   `--enable-unsafe-swiftshader` (software WebGL) — the 3D panel reported
   ready/offline-standin; real-GPU rendering is owner-hardware territory. Native
   file-chooser dialogs do not exist headless: the real Input-domain clicks on
   import buttons happened, file provision used `DOM.setFileInputFiles`
   (Chromium dispatches the change event); `Page.handleFileChooser accept` was
   tried first and left `files` empty, recorded in the driver log. The
   crash-drill mirror bump (+9999 savedAt, proj-⑤口径) needed a 4 s settle before
   SIGKILL (LevelDB flush window) — first attempt without the settle recovered
   via the normal load path instead; both runs are on record.
10. **Offline library is empty**: with HTTP(S) blocked and no plugin, library
    stats are all-zero (nothing to sync from), so the CHLB round-trip proves the
    export→import mechanism (140 B bundle, stats identical), while the project
    JSON round-trip proves content recovery (marker + /bow). Not a product
    defect — online sync is covered by `library-verify.js`.

## 2. Reproducible-build note (per WORKPLAN-20260829 WP-2)

WP-2 states the rule verbatim (WORKPLAN line 80): when the CN-local Dalamud DLLs
cannot be obtained in CI, use an auditable local plugin build with a CI
verify/release split instead of faking reproducible builds.

What this batch did under that rule:

- Isolated out-of-repo Release build (copied tree, `CopyToDevPlugins`
  neutralized in the COPY only): exit 0, 0 errors, 5 pre-existing warnings
  (CS0649/CS0414 unused fields). DLL sha `26bad755…` (851456 B).
- In-repo Release build: exit 0, 0 errors, same 5 warnings. DLL
  `src/bin/x64/Release/net10.0-windows/ChoreoHelper.dll` sha `0f6eadf4…`
  (851456 B), produced for Phase B packaging. The two DLLs differ in hash
  (different build paths embedded); both lengths equal, both logged.
- Release builds do not write external roots: `CopyToDevPlugins` is
  `Condition="'$(Configuration)' == 'Debug'"` (csproj:52); the devPlugins DLL
  hash is unchanged (`4ab9f457…` before and after).
- `src/bin` / `src/obj` are cleaned at closeout (recorded in RESULTS.md).
- No CI involved: the Dalamud/FFXIVClientStructs/Lumina references resolve from
  `%AppData%\XIVLauncherCN\addon\Hooks\dev\` (CN launcher local files,
  not fetchable by CI). A future CI lane may verify/test/package-shape, but the
  signed-byte build stays local and auditable; Phase C reviews this evidence,
  it does not rebuild.

## 3. Phase A provenance (binds logs to bytes)

- Baseline: branch master, HEAD `e795d84efb1843b76d8e29b7226c70bf25554739`
  (unmoved, no commit).
- Version gate now passes: `D:\nodejs\node.exe scripts\make-release-staging.js`
  offline exits 1 at the 48795/pairing gate (step 1), no longer at the version
  gate (step 0); staging untouched (MANIFEST still `c4d0c11e…`).
- Gates: `scripts\test-release-gates.js` 39/39 exit 0 on current bytes.
- Crosscheck: 75 local `<script src>` refs across the 2 shipped html files, all
  covered by WEB_FILES(78)∪LIB_FILES(8) and on disk; standin == live-era source
  (`9f416267…`); XAT switch unauthorized.
- Browser drills (real Chrome headless, file:// daily entry, throwaway profile
  per drill, HTTP(S) Fetch-blocked, Input-domain mouse/keyboard, screenshots):
  A 10/10 (snapshots 305/101/standin, default project, first落条 via real
  click+type, mirror written, 3D ready standin); B 10/10 (legacy fixture →
  migrated project + byte backup + flag + version); C1 4/4 + C2 3/3 (CHLB +
  project export via real clicks, wipe, import, content restored); D1-kill 2/2
  + D2 4/4 (taskkill /F, reopen, mirror recovery + auto version).
  Driver: `drills/driver-p2-drills.cjs` (sha `7f62368d…`).
