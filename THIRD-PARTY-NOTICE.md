# ChoreoHelper — THIRD-PARTY NOTICE / 第三方组件声明

> 中文摘要：本项目的第三方依赖只有一个——three.js r160（MIT，见根目录 `LICENSE`）。
> 其余功能全部是浏览器原生能力或本项目自有代码；插件侧零 NuGet 包；涉及游戏衍生数据
> 与 XAT 工具链的部分只描述来源与现状，**不作任何再分发的法务断言**（均属属主的
> 法律决定）。本文描述到 2026-09-25 的仓库现状。

This notice describes every third-party component in this repository and the
provenance of game-derived data, based on the release-preparation audit of
2026-09-25 (TASK-20260925-PROJECT-REMEDIATION, REPORT §3). It describes facts
only; where redistribution rights are an unresolved legal question, no right is
asserted here.

## 1. Web app dependencies

### 1.1 three.js r160 — MIT

- Bundled files: `web/dist/ChoreoHelper/libs/three.module.js` (module build,
  `Copyright 2010-2023 Three.js Authors`, `SPDX-License-Identifier: MIT`,
  `REVISION = '160'`) and `web/dist/ChoreoHelper/libs-classic/three.classic.js`
  (generated classic-script twin; the MIT header is preserved inside the wrapper).
- Locally modified copies of the three.js r160 `examples/jsm` files:
  `libs/loaders/GLTFLoader.js`, `libs/utils/BufferGeometryUtils.js`,
  `libs/utils/SkeletonUtils.js`, plus their generated classic-script twins under
  `libs-classic/` (`GLTFLoader.classic.js`, `BufferGeometryUtils.classic.js`,
  `SkeletonUtils.classic.js`). The only source change is rewriting bare `'three'`
  imports to relative file imports (recorded in the `scripts/make-classic-libs.js`
  header; the classic conversion itself is mechanical and changes no logic).
- **No license header on the examples files is upstream-normal** — upstream ships
  them headerless, covered by the three.js repository-level MIT License. The MIT
  terms and attribution text are reproduced in the root `LICENSE` file, which
  covers all bundled three.js-derived files.

### 1.2 Not third-party (browser-native / own code)

- **Gzip/backup compression** — the CHLB backup chain uses the browser-native
  `CompressionStream` / `DecompressionStream` APIs (`web/choreo-library.js`). No
  third-party compression library is bundled.
- **Project storage** — IndexedDB + localStorage dual-write in
  `web/choreo-projects.js` is hand-rolled. No third-party storage layer.
- **No npm ecosystem anywhere**: the repo contains no `package.json`, no
  `node_modules`, and no bundler output for the app itself; the web app is plain
  HTML + JS + classic scripts. `scripts/` tooling requires only the Node.js
  standard library (Node.js is the local runtime, not a bundled component).

## 2. Plugin (C#) dependencies

- **Zero NuGet / PackageReference** across the whole repository (audit-verified).
- Six compile-time references — Dalamud, Dalamud.Common, Lumina, Lumina.Excel,
  InteropGenerator.Runtime, FFXIVClientStructs — resolve from the local
  XIVLauncherCN Dalamud hooks directory (`%AppData%\XIVLauncherCN\addon\Hooks\dev\`)
  with `Private=false`. They are **runtime-environment dependencies**: provided by
  the player's own Dalamud installation, never copied into build output, and not
  part of any distributed package.

## 3. Game-derived data — provenance only, no redistribution assertion

The following tracked files are **derived from data read out of the FFXIV CN game
client** by this project's own recording/export tooling:

- `catalog-snapshot.js` (+ copies under `web/dist/ChoreoHelper/` and
  `web/live-era/`) — FFXIV CN Action catalog, 2243 rows,
  gameVersion 2026.09.15.0000.0000;
- `skeleton-snapshot.js`, `skeleton-pack.js` — character skeleton/reference data;
- `scripts/anim-pack/action-refs.tsv` and anim-pack outputs — action reference
  tables recorded from the game.

**This notice describes their provenance only.** Whether and how such game-derived
data may be redistributed is an unresolved owner legal decision (Square Enix
terms apply). Nothing in this file or in `LICENSE` asserts a right to redistribute
game-derived data.

## 4. XAT toolchain artifacts (`web/live-era/tools/xat/`) — posture unchanged

Legacy third-party tool artifacts are present in the repository with their own
notices:

- `LICENSE-XAT.txt` — BSD-3-Clause, Asgard 2022 (the XAT tool itself);
- `COMPONENTS.txt` — `XATHavokInterop.exe` including an embedded Havok 2014 SDK
  and Autodesk FBX SDK 2014.2.1 component;
- `VCREDIST-COMPONENTS.txt` — Microsoft VC++ 2012 x86 runtime DLLs.

The redistribution chain for the Havok/FBX components is **not closed**, and the
repository's `distribution-authorization.json` is `status=unauthorized`; the
release gate consequently blocks `tools/` subdirectories from any public package.
Review document: `docs/XAT-LICENSE-REVIEW-20260916.md`. **This notice changes
nothing about that posture** — any authorization or redistribution decision
belongs to the owner.
