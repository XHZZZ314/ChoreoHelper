# HANDOFF — FIX-H closed (2026-08-30, audit3 P2 web UX)

> 给主人：本包按第三审计建议顺序修了 4 个网页 P2 问题，自动验收 119/119 + 38/38 全过，已同步到三个部署位，刷新浏览器即生效。详情如下（英文供后续 AI 会话用）。

## Scope and authorization

- Package: FIX-H per `docs/AUDIT-20260830-audit3/README.md` §8 item 1 — AUD3-W1 + W2 + W3 + W4, all four P2 findings in `choreo-helper-app.html`.
- Owner picked "FIX-H 修复包" from the FIX-H / FIX-H→K / WP-5 / report-only fork at session start (2026-08-30).
- Entry consistency check re-done this session first: CONTINUITY/SPEC vs code **zero conflicts** (0.7.1, node 40/87/73/96/71, datalayertest 130/130 re-run, three deploy roots md5-identical at afbf37e5/bb29d194/9c441d9a).

## The four fixes (all in `web\dist\ChoreoHelper\choreo-helper-app.html`, minimal diff)

1. **AUD3-W1 — sidebar state lost after any non-macro render.** `_applySideOpen()` sat (mis-indented) inside the `if(macroCaretRestore){…}` block in `render()`, so only macro-editing renders re-applied the sidebar `open` class + backdrop. In narrow/compact mode with the palette open, any other render (add clip, play, snap toggle) slid the palette away, left `#sbBackdrop` stuck, and made ☰ need two presses. **Fix:** moved the call to the end of `render()` (runs after every rebuild; no-ops unless `_sideOpen && store.compact`).
2. **AUD3-W2 — `LABEL_W=100` disagreed with the real lane-label width (112 normal / 64 narrow).** Every x↔time mapping (ruler, playhead, A–B band, marker flags, snap guide, zoom, scroll-to) was offset 12 px in normal mode (≈0.2 s at 60 px/s: clicking exactly on a clip's visual start seeked 0.2 s past it), 36 px the other way in narrow. Root cause of the stale value: the base CSS rule (`.lane-label{width:100px}`) is overridden later in the cascade by `width:112px`; JS had copied the base value. **Fix:** `LABEL_W` is now mode-driven — `applyCompact()` (the only place `body.narrow` is toggled) sets `LABEL_W = store.compact ? 64 : 112`, single source of truth keyed to the same switch the CSS uses. clip-check now asserts JS-vs-DOM width equality in both modes, so future CSS drift cannot pass silently.
3. **AUD3-W3 — Delete silently no-oped in a reachable selection state.** Ctrl+click A, Ctrl+click B, Ctrl+click B again → A still has `selected=true` but `store.selectedClip=null`; the Delete handler passed `edHasSel()` but `deleteSelectedClips`' `<=1` branch early-returned on `!store.selectedClip`. **Fix:** the `<=1` branch falls back to `sel[0].clip` (`store.selectedClip || (sel[0] && sel[0].clip)`), preserving the normal single-selection path.
4. **AUD3-W4 — health-check online skeleton compare never fired.** The check modal fetched `/export/skeleton` via `apiFetch` → 48794, where the endpoint does not exist (404 swallowed) → `onlineSkeletonHash` was always null → the "recorded under a different character" yellow rule could never trigger online. **Fix:** raw `timedFetch('http://localhost:48795/export/skeleton', …)` (GET read-only, no pairing header needed), guarded by the same `gameConnected && capsOk` gate, same catch-and-skip semantics. `__checkRun` (headless hook) intentionally still skips the online hash — untouched.

## Verification (all actually run)

- **clip-check: 119/119** (`scripts\clipcheck-run.js` default = game-dir deployment, so it also proves the deploy sync). Added 4 assertion groups ㉖–㉙ (108 → 119):
  - ㉖ W1: narrow mode → open sidebar → non-macro `render()` → sidebar still `open`, backdrop still `show`, ☰ closes in one press.
  - ㉗ W2: `LABEL_W === 112 === .lane-label` offsetWidth (normal) and `=== 64` (narrow); clicking the ruler exactly at a clip's visual left edge lands the playhead at exactly 1.0 s (was 1.2 s).
  - ㉘ W3: reproduces the exact orphan-selected sequence, Delete removes the remaining selected clip (was a silent no-op).
  - ㉙ W4: stubs ChoreoLibrary + intercepts fetch, calls `showCheckModal()`, asserts the request goes to `48795/export/skeleton` and never to 48794.
- **offline-verify: 38/38** (re-run after a first-run transient: the `[transition]` scenario's "3D panel auto-upgrade to real model (10 s probe)" hit its 40 s wait once — clean on re-run with zero code change in that path; flake under load, preview3d.js untouched this round).
- Node suites / datalayertest not re-run for this package: no changes outside app html + clip-check harness (baseline this session: 40/87/73/96/71 and 130/130).

## Deployment

- Canonical edit in `web\dist\ChoreoHelper\`, byte-copied to `web\choreo-helper-app.html` (harness twin) and deploy roots ② `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper` ③ game dir `...\game\dist\ChoreoHelper`. `clip-check.html` synced to the same four locations.
- New md5 (all 4 locations identical): **app html `91a61e7b`** (was `9c441d9a`), **clip-check `2c0e8049`**. preview3d/choreo-projects/engine untouched (`afbf37e5` / `bb29d194`).
- Browser refresh applies; no game restart needed.

## Left open / notes

- `release\staging` still contains the **pre-FIX-H** app html. Per audit §8 item 4, the next staging rebuild should land together with **FIX-K** (privacy-scan hardening) — rebuilding now would either ship stale files or skip FIX-K. Owner decision when to do that.
- Remaining audit3 proposals: **FIX-I** (AUD3-W11/W12/W13/W14 library+3D robustness), **FIX-J** (AUD3-C1/C2/C3 C# hardening), **FIX-K** (AUD3-S1 packaging privacy) — enter only with owner direction, in that recommended order.
- `_applySideOpen` still only handles the compact/narrow floating-sidebar case by design (`wide-nosb` lives on `<body>` and survives renders); no change needed there.
