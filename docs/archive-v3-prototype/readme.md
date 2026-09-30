# choreo-src-v3 · Plugin Export Pipeline (Complete Code Package)

> The full plugin-side code delivered in one shot by the author AI (2026-08-25).
> Positioning: out-of-game rendering solution (web 3D preview engine + export pipeline).
> Two products with separate duties: **web side** = choreo-engine.js + engine-demo.html (done);
> **plugin side** = this directory (character collection → pap parsing / recording fallback → character pack → HTTP endpoints).

## File List

| File | Status | Notes |
|---|---|---|
| ChoreoHelper.csproj | ✅ done | net10 / Dalamud API 15, references Penumbra.Api (AGPL — API calls only) |
| plugin.json | ✅ done | v3 metadata |
| Plugin.cs | ✅ done | Assembly: existing v0.5 core + v3 export pipeline |
| Exporter/AnimWriter.cs | ✅ done | Animation data model + contract JSON serialization (matches ENGINE.md) |
| Exporter/PackWriter.cs | ✅ done | Character pack directory + index.json (job pack structure) |
| Exporter/PapResolver.cs | ⚠️ done + verification points | command→pap path; candidate-path scanning method (TODO_VERIFY[P0]: normalization rules) |
| Exporter/PapParser.cs | ⚠️ skeleton + calibration points | Havok parsing framework (outer decompression fully usable; inner layout TODO_VERIFY[P0/P1], ScanForAnimation needs calibration) |
| Exporter/RecorderService.cs | ✅ done | Recording fallback: read bone transforms → same-format clips (no pap parsing dependency) |
| Exporter/ExportService.cs | ✅ done | Orchestration: character collection / full emotes / per-job increments / on-demand export / parse-first with recording fallback |
| Exporter/ModelExporter.cs (inside ExportService.cs) | ⚠️ interface + integration point | IModelExporter interface done; Penumbra adapter TODO_VERIFY[P0] |
| Http/ExporterEndpoints.cs | ✅ done | /export/start|progress|cancel|pack|clip (dedicated port 48795 suggested) |
| Http/HttpServer-patch-notes.md | ✅ notes | Two mounting approaches (SetCustomHandler / dedicated port) |

## Verification Checklist (Phase 0 after getting home, by priority)

- [ ] **P0 PapParser inner layout calibration**: parse an emote pap with FFXIV-Explorer for comparison; verify magic/header offsets/classnames/track layout; after calibration, fill in the ScanForAnimation implementation
- [ ] **P0 PapResolver path rules**: candidate-path scanning is the fallback; converge to a single rule after calibration; confirm weapon-variant directory rules
- [ ] **P0 Penumbra model export**: confirm whether Penumbra.Api has a public export entry; if not, implement mdl→glTF independently (or via IPC)
- [ ] **P1 Customize index constants / weapon model sets / Equipment reading**: cross-check FFXIVClientStructs fields
- [ ] **P1 PartialBone.Transform**: confirm it is the same field Brio/Ktisis write
- [ ] Build: dotnet build (needs Dalamud dev environment + Penumbra devPlugins)

## Architecture Decisions (why designed this way)

1. **Parse-first, recording-fallback**: before pap parsing is calibrated, the recording route (RecorderService) produces data today — same AnimClipData format, invisible to the web engine. The two routes auto-degrade; there is no "stuck on parsing → everything stops".
2. **Dedicated port suggestion**: the v0.5 HttpServer (48794) is stable; export endpoints go to 48795 to avoid touching old code; the web API base is configurable.
3. **Dual bone-name conventions**: the parsing route uses original sklb names; the recording route uses bone_N + skeleton.json mapping — the engine only passes names through.
4. **Job packs**: emotes (static) exported in full; abilities incremental per current job; web job selector + un-exported badge.
5. **Penumbra AGPL compliance**: call its public API only, never copy source; if the API has no export entry, implement mdl→glTF independently (algorithm ideas are not copyright-encumbered).

## Next Steps (parts doable without a game environment are done)

- [x] Web engine v0.1 (choreo-engine.js)
- [x] Engine demo (engine-demo.html)
- [x] Data contract (ENGINE.md)
- [x] Full plugin export pipeline (this directory)
- [ ] Phase 0 calibration (needs game environment): PapParser layout / PapResolver rules / Penumbra export
- [ ] Engine v0.2: seek timeline look-back / glTF integration / material mapping table (can continue without the game)
