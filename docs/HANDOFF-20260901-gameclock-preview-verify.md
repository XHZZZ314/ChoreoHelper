# HANDOFF — Game-clock preview sync + clip verification (GAMECLOCK)

Package: TASK-20260831-GAMECLOCK-PREVIEW-VERIFY (revision 3, R3) · Worker run RUN-20260901-GAMECLOCK-PREVIEW-VERIFY-R2 · 2026-09-01

## Objective and acceptance

Per the accepted ticket: (1) the web 3D preview playhead follows the plugin's authoritative
playback clock during game-mode playback (poll an enriched `/playback/status`, dead-reckon
between polls, threshold resync, capability-gated so an old plugin keeps today's local-clock
behavior), and (2) a player-started clip verification channel: `POST /export/verify` re-triggers
one recorded command, samples live bones on the existing recorder pipeline, compares against the
stored clip with a deterministic pure comparator, and surfaces per-clip pass/deviation reports in
the recording UI. AC-1..AC-10 are in the ticket; evidence mapping below.

Non-goal confirmed with the owner before work started: per-bone real-time pose streaming from the
game to the web stays deleted (AUD2-002 security removal, `src/BoneAnimator.cs` dead arm). This
package's only preview-sync mechanism is clock-follow; a pose stream would need its own planner
pass and owner decision. The verify channel's sampled bone data never leaves the plugin.

## Preflight note (ticket revisions 1 → 3)

Two mechanical ticket amendments were needed before/during the run; neither touches goals,
non-goals, acceptance criteria, budgets or the test plan:

- **rev 1 → 2 (pre-claim):** the accepted ticket's `roleContextFiles` routed nine full source
  files (~346 KB) into the worker context manifest, which cannot pass the policy budget
  (`worker: 36000`; `choreo-app.js` alone is 144 KB; measured 364057 bytes, preflight exit 2).
  Revision 2 narrows the per-role context routing only (worker: AI-TEST-MATRIX + AI-RUNBOOK;
  reviewer: AI-TEST-MATRIX — same shape as the accepted MULTI-DANCER ticket). Sources are read
  with tools during work, not preloaded; both lanes stay inside `readScope`. Done pre-claim so
  the run's ticket revision stays stable.
- **rev 2 → 3 (mid-run, deterministic gate catch):** `check-ai-docs` flagged that the new
  datalayertest `Compile Include` for `ClipCompare.cs` requires editing
  `src/tests/datalayertest/datalayertest.csproj`, which the QA Lead's writeScope omitted (it
  listed `program.cs` and the plugin csproj but not the test csproj). The include is required by
  the ticket's own AC-1/AC-5 evidence mapping (datalayertest owns the pure pieces). Revision 3
  adds exactly that one path to `writeScope`; the run was closed `cancelled` (RUN-20260901-…,
  history) and re-claimed as RUN-20260901-…-R2 against revision 3 with identical context
  routing. No source byte changed between the cancelled run and R2 — all gate evidence below was
  produced by this exact source state.

## What changed and behavior preserved

Plugin (48794/48795):

- `src/ClipCompare.cs` (new file, the ticket's one new-source budget; hosts both pure pieces):
  - `PlaybackStatusV2.BuildJson(...)`: enriched status JSON, `playing/time` byte-compatible legacy
    prefix (F1, lowercase bool), then additive `revision/speed/maxEnd/stampMs` (monotonic ms);
  - `PlaybackStatusV2.WithCapabilities(json, "statusV2")`: idempotent capability-array injection,
    returns the input unchanged on any parse failure;
  - `ClipCompare.Compare(expected, actual)`: deterministic AnimClipData-vs-AnimClipData compare —
    both sides normalized-progress aligned (64 steps, interpolated), per-bone max rotation delta
    (q/-q equivalence, same 0.5 rad tolerance as `MotionDetect.StillAngleRad`) and translation
    delta (0.10 m), aggregate = worst normalized multiple, verdict match/deviation, hotspot bones
    (top 5), zero comparable bones ⇒ deviation, all report values clamped finite (no NaN/Infinity);
  - `ClipCompare.VerifyReportJson(...)`: the AC-6 report shape (ok, command, verdict, aggregate,
    maxRotDelta, maxTransDelta, hotspots, comparedBones, frames, sampleHz, persistent, reason),
    invariant culture, half-away-from-zero rounding.
- `src/PlaybackManager.cs` — additive `StatusSnapshot()` returning
  `(Playing, Time, Revision, Speed, MaxEnd)` under `_stateLock` (no torn reads). No behavior change.
- `src/HttpServer.cs` — `HandlePlaybackStatus` now serves the enriched payload from the snapshot
  (auth policy unchanged: status is a SEC-1 paired read via `ReadAuthPolicy` — the ticket's
  planner fact calling it anonymous is stale; the web poller carries the token through `apiFetch`);
  the `/capabilities` route injects `statusV2` (48794 playback channel only; the 48795 copy is
  untouched).
- `src/Exporter/ExportServer.cs` — verify channel: `POST /export/verify` (one `RecGate`-held
  session: policy-validated command → stored clip lookup (404 if absent) → `_recorder.Record`
  re-trigger → compare → report; 409 on concurrent verify/batch/single-record; cancel flag
  consumed in the 250 ms wait loop; 30 s safety timeout; the `finally` block is the single
  exit that clears `_verifyRunning` and releases the gate — exactly-once), `GET /export/verifystatus`
  (paired read of in-flight state), both in the method whitelists. `HandleBatchCancel` now also
  ends an in-flight verify. Verify writes nothing anywhere.
- `src/RecorderService.cs` — **untouched** (verify reuses `Record()` as-is; the file is in
  writeScope but needed no change). `src/ChoreoHelper.csproj` — untouched (SDK globbing picks up
  the new file); `datalayertest.csproj` gained one `Compile Include` line for `ClipCompare.cs`.

Web (synced byte-identical to the local `web/dist/ChoreoHelper` twin; live roots untouched):

- `web/choreo-edit.js` — additive pure functions: `followAccept(prev, sample)` (rejects
  stale/duplicate/non-finite/out-of-range samples without throwing, `playing=false` → `local:true`
  hands control back, resync when |display − plugin time| > 0.12 s), `followProject(base, nowSec)`
  (dead-reckoned display time, null on bad base), `hasCap(caps, name)`.
- `web/choreo-app.js` — `startFollow/stopFollow/followCapable`: 200 ms polling of
  `/playback/status` only while playing in game mode with the `statusV2` capability; `playLoop`
  overlays the plugin-projected time on the local advance (no base ⇒ byte-identical old
  behavior); resync snaps `store.currentTime`; poll failure degrades silently to the local clock
  and recovery re-converges; plugin `playing=false` hands control back so the web playhead
  continues to project end; polling stops on pause/stop/natural end/mode switch. `web` preview
  mode never polls (AC-4).
- `web/choreo-recording-ui.js` — verify section in the recording modal's pick list: per-row 🔍
  single-clip verify, 「🔍 审核所选」 batch verify, progress line + result list (通过 / 偏差超标
  with worst-bone name), stop button; same pacing as the record center (walkreset/posture,
  beckon/persistent, 2.5 s spacing); zero clip writes (no `/export/clip`, no commit calls);
  `window.__verDebug` headless hook. The existing record-session failure rows (重录) are unchanged.
- `web/test-edit.js` — new GAMECLOCK section, 116 → 133 cases, purely additive.
- `scripts/library-verify.js` — mock mirrors the new contract surface (`/playback/status` scripted
  clock with hit counting, `/capabilities` dynamic `statusV2`, `/playback/start` real-shape
  `{status:'playing'}` response, `/export/verify`, `/export/verifystatus`, `/export/batchcancel`)
  plus two scenarios `clock` and `verify`, both also in `all`.

## Verification actually observed (all commands run in this package)

- Fast suites: `test-edit` 133/0 · `test-engine` 47/0 · `test-shell` 41/0 · `test-check` 73/0 ·
  `test-projects` 96/0 · `test-document` 88/0 · `test-docwire` 45/0 · `test-showcompiler` 37/0 ·
  `test-library` 91/0.
- C#: datalayertest **389/0** (20 new GAMECLOCK cases: AC-1 byte-compat/precision/injection,
  AC-5 identical/offset-pass/wrong-clip hotspots/sparse determinism/q-and-minus-q/no-NaN, AC-6
  report shape parseable without NaN/Infinity) · plugin Release build 0 errors (Debug never
  built — no devPlugins copy touched).
- Browser integration: `library-verify all` **146/0** (was 117 baseline; +29: clock 9/9 covers
  AC-3 convergence ≤0.35 s / +3 s jump resync / poll-failure local-clock degradation / recovery /
  pause stops polling, and AC-4 old-plugin zero-poll; verify 20/20 covers AC-6 405/403/contract
  keys/single-trigger/verifystatus/concurrent-409/batchcancel and AC-7 UI verdicts with hotspot
  bone, zero record/commit requests, batch cancel) · `clipcheck-run` 148/0 · `offline-verify all`
  45/0.
- AC-9: the three touched product files hash-identical between `web/` and
  `web/dist/ChoreoHelper/`; no live-install writes (Debug build target never invoked; the two
  live deploy roots untouched).
- Gate artifact: `.agent/runs/GATE-RUN-20260901-GAMECLOCK-PREVIEW-VERIFY.json` (12 required
  checks, all passed, evidence hashes recorded; includes `process-audit --check` 21/21,
  `check-ai-docs` 45/45, `pipeline-cli check` PASS).

## Remaining owner tails and why

- **AC-10 real-game acceptance**: preview visibly following the in-game character, fresh-record
  verify passes, deliberately mismatched clip fails. The new DLL is deployed and live (see the
  deployment section); what remains is the owner actually playing a timeline in game mode with
  the 3D preview open and running one verify from the recording UI.
- ~~Live deploy sync of the web twins / DLL~~ — done 2026-09-01 with owner authorization (above);
  rollback point: `ChoreoHelper.dll.pre-gameclock.bak` + git-tracked dist twins.
- Threshold calibration (`ClipCompare` 0.5 rad / 0.10 m, web resync 0.12 s) comes from the
  record-era calibration; real-game feel may warrant constant-only adjustments.

## Owner-authorized deployment + live smoke (2026-09-01)

The owner authorized the gated deployments with a single 「授权」 right after the worker report.
Both actions are now done and verified:

- **Web twins synced to both live roots** (full-tree copy, no deletes): `web/dist/ChoreoHelper/`
  → `%AppData%/XIVLauncherCN/devPlugins/ChoreoHelper/dist/ChoreoHelper/` and
  → `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper\`.
  `diff -r` clean both sides (file sets and bytes identical; owner's `model.gltf/model.bin`
  hash-equal across repo/dev/game, nothing overwritten with different content). This also ships
  the previously unsynced MULTI-DANCER web features.
- **New plugin DLL deployed to devPlugins** following the existing backup convention:
  old live DLL (audit-4, 236544 B) saved as `ChoreoHelper.dll.pre-gameclock.bak`, then
  Release DLL (247808 B, sha256 2f1949a41d8f9c92ca2e…) + unchanged `plugin.json` copied to
  `%AppData%/XIVLauncherCN/devPlugins/ChoreoHelper/`.
- **Live smoke (read-only only, no game action triggered)**: Dalamud hot-reloaded the dev plugin
  on file change — the running process already serves `statusV2` in 48794 `/capabilities`;
  `GET /export/verifystatus` with the local pairing code → `200 {"running":false,...}` (old
  plugin would 404); `GET /playback/status` with code → `200 {"playing":false,"time":0,
  "revision":0,"speed":1,"maxEnd":0,"stampMs":97583031}` (enriched payload live; note it is a
  paired read — see the HttpServer bullet above); `/export/list` still 200 with 264 clips.
- Remaining for the owner: AC-10 real-game behavioral acceptance (preview following the
  character, fresh-record verify pass, mismatched clip fail). `POST /export/verify` was NOT
  called live — it re-triggers a real in-game action and is the owner's call, from the paired
  web page, like any recording.

## Known review seeds (for the module/global lanes)

- Ticket `roleContextFiles` narrowing (revision 2) — context routing only, pre-claim, rationale above.
- 48795 `/capabilities` intentionally lacks `statusV2`; the recording UI detects an old plugin for
  verify via 404 handling instead of a capability bit.
- A-B loop in game mode with follow active is a legacy combination (UI already restricts A-B to
  web playback); follow projection and the loop branch contend per-frame if forced.
- Follow attaches only at playback start: a hot plugin upgrade mid-page needs a new play press.

## Files changed

`src/ClipCompare.cs` (new) · `src/PlaybackManager.cs` · `src/HttpServer.cs` ·
`src/Exporter/ExportServer.cs` · `src/tests/datalayertest/{datalayertest.csproj,program.cs}` ·
`web/choreo-edit.js` · `web/choreo-app.js` · `web/choreo-recording-ui.js` · `web/test-edit.js` ·
`web/dist/ChoreoHelper/{choreo-edit.js,choreo-app.js,choreo-recording-ui.js}` (twins) ·
`scripts/library-verify.js` · `.agent/tickets/TASK-20260831-GAMECLOCK-PREVIEW-VERIFY.json` (rev 2) ·
`.agent/modules/plugin-product/changes/CHG-…json` (draft) ·
`.agent/modules/web-product/changes/CHG-…json` (draft) ·
`.agent/runs/GATE-RUN-20260901-GAMECLOCK-PREVIEW-VERIFY.json` · this handoff.
Run RUN-20260901-GAMECLOCK-PREVIEW-VERIFY-R2 (ticket revision 3) stays **active** for the
reviewer lanes (module + global) and context-sync closeout per the standard flow;
RUN-20260901-GAMECLOCK-PREVIEW-VERIFY is closed `cancelled` (superseded by the rev-3 re-claim,
see preflight note). Budgets: 17 files touched (≤20), ≈1,150 changed lines (≤1,200).
