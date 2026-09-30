# HANDOFF 2026-08-29 — OPT-2: Large-Project Performance & GPU Lifecycle (AUD-018/019/020)

> Work entry: `docs\HANDOFF-20260829-code-audit-fix-optimization.md` (21-item audit list).
> Previous package: `docs\HANDOFF-20260829-opt1-recording-robustness.md` (OPT-1).
> Scope: audit section 9 "OPT-2: large-project performance & GPU lifecycle (P2)". C# untouched, version still 0.7.1, not committed, not published.

## 1. What Changed

### AUD-018: per-frame full rebuild/sort/full-table scan → dirty flag + per-character index + binary search

**Engine `web\choreo-engine.js`**

- `timeline` became an accessor (getter/setter): assignment sorts and **builds a per-character bucket index** (`_byChar`, each bucket kept start-ascending), without touching the playhead.
- `scrubTo()` went from "linear full-table scan per character O(D·N)" to **per-character binary search for "the last clip with start ≤ t" O(D·logN)**; falls back to linear scan if `_byChar` is missing. Semantics verbatim-equivalent to the old implementation (stable sort + tied starts take the later one in sort order, matching the old "keep overwriting" behavior); `web\test-engine.js` adds 200 random-timepoint equivalence assertions to pin this.
- Incidentally fixed a **latent old bug**: when the timeline was replaced mid-playback, the old implementation kept the old `timelineIdx`, which misaligned if the array shrank or content changed (wrong triggers / missed triggers). It now aligns to "the first clip with start ≥ playhead" (`firstAtOrAfter`) — neither replays old clips nor misses triggers (note: upperBound cannot be used — it would skip the first clip when start=0; existing case 5 caught this).
- `setTimeline()`'s external semantics unchanged (sort, time=0, back to idle).

**Panel `web\preview3d.js`**

- The per-frame `rebuildTimeline()` in tick became a **dirty flag**: the homepage's `render()` and content-changing drags increment `store._tlRev`; the panel rebuilds + sorts only when the version number changes. A static timeline now does 0 re-sorts per frame (the old implementation did a full O(N log N + D·N) per frame plus short-lived arrays).
- The action-name signature `usedNamesSig()` (a full-table scan + sort every 30 frames) is also computed only when the version changes or libDirty.
- `window.__p3dDebug()` gained diagnostic fields: `tlRebuilds` (re-sort count), `gpu` (renderer geometry/texture/program counts); new `window.__p3dReset()` debug hook (same hardReset→init path as the 10s auto-upgrade; for acceptance).

**Homepage `web\choreo-helper-app.html`**

- `render()` increments `store._tlRev` and `store._renderCount` at its start (diagnostic counters); a drag that actually moves a clip also increments `_tlRev` (the basis for the 3D panel tracking drags in real time).

### AUD-019: drag rebuilt the whole page's DOM every frame → during drag, only the dragged clip's left/width change

- `dragClip`'s rAF callback no longer does `updateTotalDuration(); render()`; instead:
  - `updateTotalDuration()` stays (cheap; end-clamping needs the latest value);
  - new `_clipNodes` (clip.id → array of all DOM nodes for that clip; a global-lyrics clip has two DOM nodes; refilled when render() rebuilds) — during drag, used to **change only the dragged clip's (multi-select = whole group's) left/width**;
  - `mouseup` then does `saveHistory(); render()` for the full rebuild (outlines / conflict highlights / persistence restored).
- The during-drag bubble, snap guides, click dead zones, marquee live count, and similar mechanisms are all untouched.

### AUD-020: hardReset didn't release GPU resources → deduplicated dispose

- New `disposeObject()`: traverses and releases geometry / material / textures on materials (`Set`-deduplicated — clones sharing resources are neither double-released nor missed); after hardReset, calls `renderer.renderLists.dispose()`.
- **A real leak was caught in the process**: three r160's `SkinnedMesh` has no `dispose()` (added in later versions), so the skeleton skinning texture (skeleton boneTexture) leaked one per reset — measured 20 resets: texture count 2→21, linear growth. After switching to calling `Skeleton.dispose()` directly: **1→1** (geometry 3→3).

## 2. Acceptance Evidence (all actually run)

- **node tests**: test-engine 35→**40/40** (new: binary vs linear verbatim equivalence over 200 timepoints, probe count ≤ D·⌈log2(N+1)⌉, tied starts take the later one, 600-frame × 3000-clip benchmark 1ms, mid-playback replace replays nothing); test-edit 85, test-projects 77, test-check 73, test-library 26 all green.
- **offline-verify full suite 27/27** ("all" run with game online): offline 11 + **new perf scenario 6** (static ~130 frames, 0 re-sorts / a re-sort happens after an edit / checkup outlines' render settles to zero / 20 resets: geometry 3→3, texture 1→1 / zero JS exceptions) + online 4 + transition 3 + both diagnostics pages.
- **clipcheck-run 103→108/108** (new ㉕ group, 5 items: a 6-step drag triggers exactly one full render (the mousedown one) / dragged clip's left goes 0px→120px in real time / mouseup's final render happens exactly once / drag result correct / the other clip unaffected).
- **library-verify all 103/103** (real plugin online).
- mode-check PASS (included in offline-verify).
- C# untouched, datalayertest not re-run (no C# change); Debug/Release not rebuilt.
- All four deploy locations md5 identical: choreo-engine=cffe0213…, preview3d=98d15934…, app html=267ef918…, clip-check=d9a69396… (backslashes in the third location's output are a known Git Bash display artifact).

## 3. Semantic Boundaries & Known Notes

- The per-edit realtime checkup (FIX-4 addendum) renders once more after outlines are applied → `_tlRev` bumps again → the 3D panel re-sorts the timeline once more. **At most 1 extra re-sort per edit round, not per frame**; the perf scenario asserts exactly this (≤3).
- Clicking / shift-clicking clips renders (selected state) → the panel re-sorts once. One click, one re-sort — acceptable; not optimized in this package (eliminating it needs a finer-grained content signature on the store; the complexity isn't worth it).
- Red/yellow outlines don't refresh mid-drag (outlines are restored by mouseup's full render) — the realtime checkup is already an 800ms debounce after render, so this matches old behavior.
- The engine timeline accessor's alignment of `timelineIdx` fixed a misalignment and is a **behavior correction** (the old behavior risked wrong triggers when "changing the timeline during playback"); equivalence is guarded by unit tests, test-engine all green.
- Benchmark numbers archived: 3 dancers × 1000 events, 600-frame scrubTo runs in **1ms** on node (old full-scan criteria estimated around milliseconds ×20; see the probe-count assertion 30 vs 3000).

## 4. Owner Live Observation Points (non-blocking; glance when next using the web app)

1. Dragging clips should feel more responsive than before (especially on large projects).
2. 3D panel as usual: scrubbing the playhead / playback / loop rewinding should feel unchanged (engine semantics have equivalence assertions — a regression confirmation).

## 5. Next Steps

- Audit list remaining: **RELEASE-1 (AUD-021 P3)** — test-project target, the 6 pre-existing warnings, status-doc unification, pre-release Release rebuild + repackaging (only when releasing).
- Awaiting owner live acceptance: FIX-4 checkup (WP-4 closeout), phase-4 tail (pose-category round + cancel-and-resume recording), FIX-3's three items (optional).
- No commit, no remote, no push, no publish without the owner's authorization.
