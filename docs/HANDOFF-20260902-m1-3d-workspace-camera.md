# HANDOFF — Resizable/maximizable 3D workspace with view-only camera (M1)

Package: TASK-20260902-M1-3D-WORKSPACE-CAMERA (revision 1, R2, standard lane) · Run
RUN-20260902-M1-3D-WORKSPACE-CAMERA (completed) · 2026-09-02

## Objective and acceptance

Per the accepted ticket: turn the fixed 340x440 floating 3D preview into a viewport-bounded
resizable and maximizable workspace whose orbit, pan, zoom, reset, focus and front/side/top/free
presets are session-local view state that never enters choreography data, persistence, undo or
the network. AC-1..AC-12 map to the new offline workspace scenario plus the routed regression
suites; the module lane approved on independent re-execution (re-ran the 66-assertion scenario
and re-hashed the product twins itself), and global review is not required (no policy trigger,
single module, no persistence/protocol/security surface).

## Mechanism / red baseline

- Before the change, `#p3dPanel` was hard-fixed at 340x440 (CSS), `PerspectiveCamera(50, 340/340)`
  was created once, and `layoutDancers()` reset the camera on every call — so any performer-count
  change silently wiped camera state, and no camera interaction existed. Pre-ticket baselines:
  test-shell 45/45, offline 11/11 (2026-09-02).
- The required behavior change is that `layoutDancers()` no longer touches the camera: only first
  ready, an explicit preset, reset or focus may change geometry (INV-5). Default framing stays
  bit-identical: front/free land on the legacy `layoutDancers()` position within 1e-6 for n=1 and
  n=12, so nothing moves for an owner who never touches the new controls.
- Implementation and its 66-assertion CDP scenario landed in one pass; the deterministic gate
  passed on cycle 1 with zero repair attempts.

## What changed and behavior preserved

- `web/preview3d.js` (+428/-6): module-private view state (never written to store, projectRecord,
  repository, undo, localStorage, URL hash or HTTP); `buildPanel()`-built chrome — a
  maximize/restore header button, a six-button view toolbar (front/side/top/free/reset/focus) and
  a top-left resize grip (the panel is right/bottom-anchored); pointer-only camera control
  (primary drag orbit, Shift/secondary drag pan, wheel zoom, contextmenu suppressed only over the
  canvas); one gesture at a time keyed by pointerId, terminated by pointerup/pointercancel/blur/
  Escape/hidden visibility; camera clamps distance [0.6, 60] and polar [0.05, 3.091536] on every
  gesture; focus iteratively fits all visible performers (silent no-op at 0); backing store always
  equals content box × min(dpr, 2); `__p3dDebug().view` extended as the only new (read-only)
  observation surface, including one extra `fit` field accepted by review finding F-2.
- `web/choreo-helper-app.css` (+19/-6): `#p3dPanel` explicit `box-sizing: content-box`, chrome and
  grip styles, maximized state (full viewport, border/radius removed, grip hidden).
- `scripts/offline-verify.js` (+531): one isolated `workspace` scenario covering all twelve ACs —
  resize/clamp at two viewports, hostile drags, maximize/restore/Escape/re-clamp, camera component
  isolation and clamps, gesture termination matrix, preset geometry at n=1/n=12, focus at 1/12/0
  performers, camera survival across count changes and `__p3dReset()`, choreography invariance
  (content JSON, `_docRev`/`_tlRev`/`_tlRevision`, history, playhead, selection, zero
  addVersion/save calls) in paused and playing runs, accessibility/listener/rAF/GPU checks, and
  the network URL whitelist.
- Preserved: `web/choreo-helper-app.html`, `choreo-app.js` and every other prohibited path hold
  zero diff; no dependency, ES-module, generated asset or request-surface change; document/
  docwire/projects/show-compiler untouched; performer placement unchanged. The deferred HYGIENE
  panel-close rAF item is bounded (loop count asserted flat) but not fixed, per ticket non-goal.
- M1 view convention recorded verbatim in the module change record as the provisional convention
  M2-M4 must adopt or re-version with migration evidence.

## Verification actually observed

- Gate `GATE-RUN-20260902-M1-3D-WORKSPACE-CAMERA`: 14 checks + command fidelity all passed,
  cycle 1, repairs 0/2 — scope (source revision, status classification, prohibited paths, context
  hash 7/7 pins + 3 planned writeScope drifts), workspace 66/0, offline 11/0, perf 11/0,
  test-shell 45/0, test-engine 47/0, test-document 101/0, SHA256 twin identity
  (preview3d.js `5F485BCF…`, css `350E4F61…`), pipeline-cli check PASS, process-audit 25/25,
  git diff --check clean.
- Module review `REVIEW-MODULE-…`: APPROVE after independent re-execution (workspace 66/0
  re-run, twins re-hashed, diff read at -U0/-U3/-U8). Findings: F-1 line-budget overrun accepted
  as a one-time deviation (realized 979 product-source lines; 1426 including the mandatory dist
  twins; file budget 6/14 respected), F-2 `view.fit` seam extension accepted, F-3 top-preset
  polar-0 clamp interpretation accepted, F-4 +2px border bound accepted as conservative, F-5 two
  test-hardening follow-ups raised (orbit target assertion; literal AC-11 set difference) as a
  future ticket, F-6 policy-budget timing constraint with no action in this closeout. All
  dispositions are recorded in the module change record (revision 2) closeout section.
- Worker phase ran 88 min against the 90-min budget; gate and review lanes added ~35 min of
  owner-side wall clock. No live-install, staging, remote, push, publication or commit action was
  performed; only the repository `web/dist/ChoreoHelper` twin was synced.

## Remaining owner tails and why

- M1-DEPLOY: the two changed product files are synced to the repository dist twin only. Both live
  roots (`%AppData%/XIVLauncherCN/devPlugins/...` and the game dist root) still hold the pre-M1
  bytes (verified by hash), so the resizable workspace is not visible in the game-adjacent install
  until the owner authorizes a whole-tree deploy (GAMECLOCK/ARCH2 pattern, no deletes).
- POLICY-BUDGET: every role context budget except the worker's is below this ticket's 42435-byte
  implicit floor; a future claim of a ticket this size fails until the owner authorizes raising
  the sibling `roleContextBytes` in its own pipeline-policy package while no run is active.
- Follow-ups F-5 (two harness assertion hardenings) are noted for a future hardening ticket, not
  owner actions; no in-game acceptance is newly required (plugin and game-control paths are
  untouched).

## Files changed

web/preview3d.js, web/choreo-helper-app.css, scripts/offline-verify.js, plus the byte-identical
web/dist/ChoreoHelper twins of preview3d.js and choreo-helper-app.css; one disclosed
owner-authorized pre-run line in .agent/PIPELINE-POLICY.json (worker context budget, outside the
module change). Full inventory in
`.agent/modules/web-product/changes/CHG-TASK-20260902-M1-3D-WORKSPACE-CAMERA.json`.
