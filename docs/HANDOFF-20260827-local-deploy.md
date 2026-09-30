# ChoreoHelper v0.6 · Local Deployment Delivery Log (Late Night 2026-08-27)

> Predecessor docs: HANDOFF-v06-recording.md (recording pipeline), final-delivery.md (v0.6 overall architecture).
> This doc records the whole process of "installing v0.6 into the local game": two pitfalls in the new Dalamud, both fully diagnosed and solved. Complete handoff for the next AI.

## 1. What Was Achieved

**The v0.6 plugin loaded in the local game; both port services verified working:**

```
2026-08-27 23:43:55 dalamud.log：
  [ChoreoHelper] ExportServer listening on localhost:48795
  [ChoreoHelper] ChoreoHelper v0.6.0 started. API: 48794 + Export: 48795
  [ChoreoHelper] HTTP server listening on http://localhost:48794/
实测：GET http://localhost:48794/health → {"status":"ok"} ✓
实测：GET http://localhost:48795/export/recstate → 正常 JSON ✓
```

Only leftover: none — the 48795 static pages initially 404'd; located and solved (see section 3). /viewer and / both verified 200 with content identical to source.

## 2. Pitfall Log (Pit 1: New Dalamud Changed Dev-Plugin Loading)

**Symptom**: files in the right place + DevMode=true + game restart → the log shows no plugin-discovery attempt at all; 0 plugins loaded.

**Cause**: this machine's Dalamud (Core 26-08-27-01, new 2026-08-27 build) **has abolished automatic scanning of the devPlugins folder**. Official discussion goatcorp/Dalamud#892 confirms the removal. Old tutorials ("drop three files into devPlugins\ChoreoHelper\ → start the game") are all dead on the new version.

**Evidence**:
- The "devPlugins" string cannot be found in Dalamud.dll (addon\Hooks\26-08-27-01\)
- Boot log with DevMode=true shows zero scanning traces
- A new config field `DevPluginLoadLocations` appeared (empty at the time)

**New mechanism (verified in source, goatcorp/Dalamud master PluginManager.cs)**:
- At startup Dalamud walks the `DevPluginLoadLocations` list (requires DevMode=true)
- Each entry's `Path` points to the **plugin DLL file**; for a manifest entry it auto-takes the same-named .json in the same directory (ChoreoHelper.dll → ChoreoHelper.json)
- plugin.json inside the install directory is not read at all by the new version (harmless to leave)
- In-game UI entry: /xlsettings → Experimental → Dev Plugin Locations
- **Editing dalamudConfig.json while the game runs gets overwritten by the write-back at game exit** — only edit after the game has fully exited (this project used a background watcher that waited for ffxiv_dx11.exe to disappear before touching it)

**Registration done on this machine** (in `%AppData%\XIVLauncherCN\dalamudConfig.json`):

```json
"DevPluginLoadLocations": {
  "$values": [
    {
      "$type": "Dalamud.Configuration.DevPluginLocationSettings, Dalamud",
      "Path": "C:\\Users\\xhz\\AppData\\Roaming\\XIVLauncherCN\\devPlugins\\ChoreoHelper\\ChoreoHelper.dll",
      "IsEnabled": true,
      "Nickname": null
    }
  ]
}
```

Pre-edit backup: `dalamudConfig.json.choreo-backup-20260827` in the same directory. DevMode=true (owner enabled it in game).
Note: a dev plugin is disabled by default the first time it is discovered; enable it once manually in /xlplugins (owner did this; the profile recorded true; after that the plugin auto-loads at game start).

## 3. Pitfall Log (Pit 2: ExportServer Web Pages 404)

**Symptom**: after the plugin loaded, 48795 `/` and `/viewer` both 404 (API endpoints fine).

**Cause**: ExportServer.cs `FindWebRoot()` (~lines 311-323) looks up the web directory at plugin startup in candidate order; when none exists it falls to a dead path:
1. `AppDomain.CurrentDomain.BaseDirectory + dist\ChoreoHelper`
2. BaseDirectory up 5 levels + dist\ChoreoHelper
3. `C:\Users\Administrator\ChoreoHelper\dist\ChoreoHelper` (old-machine dead path)

Key insight: **the plugin process's BaseDirectory = the game directory** `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\` (the .NET runtime is hosted inside the game process; the app base directory is the host ffxiv_dx11.exe directory), so candidate ① really means `...\最终幻想XIV\game\dist\ChoreoHelper\`. On the old machine candidate ③ (project directory) silently saved it, which is why this never surfaced before.

**Localization method (more reliable than theorizing; reusable)**: first find where the game process locks the .NET runtime (`Get-Process ffxiv_dx11 -Module`; actually under %AppData%\XIVLauncherCN\runtime\ locally), then drop page copies with distinct HTML markers into all 8 candidate directories → reload the plugin once → whichever marker the served page shows is the hit. This time the hit was the "game directory"; the other 7 candidates (two runtime spots, game install root, several AppData spots, the Dalamud Hooks directory, D:\ root) were all cleaned up.

**Fix (in effect)**: the official web pages now live at `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper\` (byte-identical to source). Note: WebRoot is a static value computed at plugin startup; after moving files you must reload the plugin / restart the game; a game reinstall/migration loses that folder — just replay the copy if lost.

**Root fix (bundle with the build chain)**: change the first FindWebRoot candidate to `Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) + dist\ChoreoHelper` (the real directory of the plugin DLL; the copy for devPlugins\ChoreoHelper\dist\ChoreoHelper\ is already staged), and delete the old-machine dead-path candidate.

## 4. Local State Snapshot

| Location | Content | Status |
|---|---|---|
| `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\` | three-file set + dist\ChoreoHelper\ two pages | deployed (the new version reads the DLL + same-named json only from here) |
| `D:\Program Files\上海数龙科技有限公司\最终幻想XIV\game\dist\ChoreoHelper\` | two pages (pit 2 fix; what the plugin actually reads) | in effect; lost on game reinstall/migration |
| `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\dist\ChoreoHelper\` | two-page copy (for the root-fixed new build) | deployed |
| `%AppData%\XIVLauncherCN\dalamudConfig.json` | DevMode=true + DevPluginLoadLocations entry | verified working, backed up |
| `D:\choreohelper\release\devPlugins\ChoreoHelper\` | compiled three-file set (source) | untouched |
| `D:\choreohelper\web\dist\ChoreoHelper\` | web source (matches the two files at web\ root) | untouched |

## 5. Next Steps (Priority)

1. **Closing verification** (needs the owner): reload ChoreoHelper via /xlplugins → http://localhost:48795/viewer returns 200 → smoke-record /bow on the preview page
2. **Build chain**: install the .NET 10 SDK → fix the ExportServer.cs hardcoding (root fix in section 3) → add dist page copying to ChoreoHelper.csproj's CopyToDevPlugins (lines 46-48) → dotnet build and verify output lands in devPlugins
3. **Real 3D player model** (the owner's chosen next big feature): first cheaply verify Penumbra works on CN XIVLauncherCN (橙月); if not, switch route (game file parsing / FFXIV-Explorer manual export) — explain the switch to the owner first

## 6. Rollback

- Uninstall: after game exit delete `%AppData%\XIVLauncherCN\devPlugins\ChoreoHelper\` and clear DevPluginLoadLocations in dalamudConfig.json (or restore the whole backup `dalamudConfig.json.choreo-backup-20260827`, then manually set DevMode back)
- The dist folder under the Hooks directory can just be deleted (no Dalamud files of its own were ever touched)
