# ChoreoHelper Project Continuation Document

> This file is the context feed for "the new conversation after getting home". Paste it into a new autoclaw conversation to continue seamlessly.

## One-Sentence Background

I am building a Dalamud plugin for an FF14 choreography timeline (ChoreoHelper): it reads game action data and exposes it to a web tool via a local HTTP API. On the company PC, .NET 10 on Windows 10 19045 has a CET compatibility problem that makes the latest XIVLauncherCN crash at launch, so work must continue on the home PC.

## All The Context You Need

### User Info

- FF14 CN-server player, using the Orange launcher (XIVLauncherCN / ottercorp branch)
- User GitHub: <https://github.com/XHZZZ314>
- User's existing project: <https://github.com/XHZZZ314/XHZZZ314.github.io> (FF14 choreography timeline web tool, React+Vite)
- Goal: a Dalamud plugin that reads game Excel-sheet data and serves it to the web tool via HTTP API, so a community-maintained action library is no longer needed

### Plan (Already Decided)

- Plan B: Dalamud plugin
- Phase 1 (current): plugin reads Action/Emote/Race Excel sheets → HTTP API → web tool syncs the action library
- Phase 2 (later): plugin creates a preview Actor for real-time in-game action preview
- Phase 3 (optional): fully in-game ImGui timeline editor

### Environment Status

- .NET 8 SDK: ✅ installed (8.0.411), path `C:\Program Files\dotnet`
- .NET 10 Runtime: ✅ installed (10.0.11), but CET-crashes on Win10 19045, unusable
- 7-Zip: ✅ installed, path `%LOCALAPPDATA%\7-Zip`
- XIVLauncherCN portable (.NET 8 build 6.4.8-1): ✅ downloaded and extracted to `%LOCALAPPDATA%\XIVLCN`, Update.exe disabled
- Plugin project code: ✅ written, see code section below

### Remaining Tasks

1. Start XIVLauncherCN (.NET 10 version) on the home PC
2. Log in to the CN account, enable Dalamud + Dev Mode
3. Launch the game, confirm `/xlsettings` opens the Dalamud settings
4. Confirm `%AppData%\XIVLauncher\dev\` exists (contains Dalamud.dll etc.)
5. Build the ChoreoHelper plugin with `dotnet build`
6. Load the plugin in game, visit <http://localhost:48794/actions> to verify data
7. Add a "sync from plugin" button in the web tool to hook up the API

### Important Notes

- **DOTNET_ROOT env var**: AutoClaw sets `DOTNET_ROOT` to its own .NET 8, which can interfere with XIVLauncher. Before launching, `set DOTNET_ROOT=C:\Program Files\dotnet` or clear it entirely
- **CN Dalamud API Level**: 10
- **CN plugin repo**: <https://github.com/gamous/DalamudPluginsCN-Dev>
- **ottercorp repo**: <https://github.com/ottercorp/FFXIVQuickLauncher>

---

## Plugin Code (4 Files)

### File 1: ChoreoHelper.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Platform>x64</Platform>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>ChoreoHelper</AssemblyName>
    <RootNamespace>ChoreoHelper</RootNamespace>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
    <NoWarn>CS0436;CS8618;CS8601;CS8602;CS8603;CS8604;CS8625</NoWarn>
    <Version>0.1.0.0</Version>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="Dalamud">
      <HintPath>$(AppData)\XIVLauncher\dev\Dalamud.dll</HintPath>
      <Private>false</Private>
    </Reference>
    <Reference Include="Dalamud.Common">
      <HintPath>$(AppData)\XIVLauncher\dev\Dalamud.Common.dll</HintPath>
      <Private>false</Private>
    </Reference>
    <Reference Include="Lumina">
      <HintPath>$(AppData)\XIVLauncher\dev\Lumina.dll</HintPath>
      <Private>false</Private>
    </Reference>
    <Reference Include="Lumina.Excel">
      <HintPath>$(AppData)\XIVLauncher\dev\Lumina.Excel.dll</HintPath>
      <Private>false</Private>
    </Reference>
  </ItemGroup>
  <ItemGroup>
    <Content Include="plugin.json" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
  <Target Name="CopyToDevPlugins" AfterTargets="Build" Condition="'$(Configuration)' == 'Debug'">
    <Copy SourceFiles="$(TargetPath)" DestinationFolder="$(AppData)\XIVLauncher\devPlugins\ChoreoHelper\" />
    <Copy SourceFiles="$(TargetDir)plugin.json" DestinationFolder="$(AppData)\XIVLauncher\devPlugins\ChoreoHelper\" />
  </Target>
</Project>
```

### File 2: plugin.json

```json
{
    "Name": "ChoreoHelper",
    "InternalName": "ChoreoHelper",
    "Author": "XHZZZ314",
    "Description": "FF14 编舞时间轴辅助插件 - 读取游戏动作数据并通过本地 HTTP API 暴露给网页工具",
    "ApplicableVersion": "any",
    "DalamudApiLevel": 10,
    "Punchline": "为编舞时间轴工具提供动作数据源",
    "Tags": [ "utility", "choreography", "dance" ]
}
```

### File 3: Plugin.cs

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dalamud.Data;
using Dalamud.Game;
using Dalamud.Game.Gui;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;
using Lumina.Excel;
using Lumina.Excel.Sheets;

namespace ChoreoHelper;

public sealed class Plugin : IDalamudPlugin
{
    [PluginService] public static IDataManager DataManager { get; private set; } = null!;
    [PluginService] public static IPluginLog Log { get; private set; } = null!;
    [PluginService] public static IChatGui Chat { get; private set; } = null!;

    public string Name => "ChoreoHelper";

    private HttpServer? _httpServer;

    public Plugin()
    {
        try
        {
            _httpServer = new HttpServer(DataManager, Log);
            _httpServer.Start();
            Log.Information("ChoreoHelper started. Listening on http://localhost:48794/");
            Chat.Print("ChoreoHelper 已启动，数据接口: http://localhost:48794/actions");
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to start ChoreoHelper");
        }
    }

    public void Dispose()
    {
        _httpServer?.Dispose();
        Log.Information("ChoreoHelper disposed.");
    }
}
```

### File 4: HttpServer.cs

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using Lumina.Excel;
using Lumina.Excel.Sheets;

namespace ChoreoHelper;

public sealed class HttpServer : IDisposable
{
    private readonly IDataManager _dataManager;
    private readonly IPluginLog _log;
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _serverTask;

    private const int Port = 48794;

    private static readonly string[] CorsHeaders =
    [
        "Access-Control-Allow-Origin: *",
        "Access-Control-Allow-Methods: GET, OPTIONS",
        "Access-Control-Allow-Headers: Content-Type"
    ];

    public HttpServer(IDataManager dataManager, IPluginLog log)
    {
        _dataManager = dataManager;
        _log = log;
    }

    public void Start()
    {
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://localhost:{Port}/");
        _listener.Start();

        _cts = new CancellationTokenSource();
        _serverTask = Task.Run(() => ListenLoop(_cts.Token));
    }

    private async Task ListenLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener!.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync();
            }
            catch (HttpListenerException)
            {
                break;
            }
            _ = Task.Run(() => HandleRequest(ctx, ct), ct);
        }
    }

    private void HandleRequest(HttpListenerContext ctx, CancellationToken ct)
    {
        try
        {
            var path = ctx.Request.Url?.AbsolutePath ?? "/";
            var query = System.Web.HttpUtility.ParseQueryString(ctx.Request.Url?.Query ?? "");

            if (ctx.Request.HttpMethod == "OPTIONS")
            {
                ctx.Response.StatusCode = 204;
                AddCorsHeaders(ctx.Response);
                ctx.Response.Close();
                return;
            }

            ctx.Response.ContentType = "application/json; charset=utf-8";
            AddCorsHeaders(ctx.Response);

            var json = path switch
            {
                "/health" => "{\"status\":\"ok\"}",
                "/actions" => GetActionsJson(query["id"]),
                "/actions/emotes" => GetEmotesJson(),
                "/actions/races" => GetRacesJson(),
                "/version" => "{\"version\":\"0.1.0\",\"gameVersion\":\"" + GetGameVersion() + "\"}",
                _ => "{\"error\":\"not found\"}"
            };

            if (path == "/" )
            {
                json = "{\"name\":\"ChoreoHelper\",\"version\":\"0.1.0\",\"endpoints\":[\"/actions\",\"/actions/emotes\",\"/actions/races\",\"/health\",\"/version\"]}";
            }

            var bytes = System.Text.Encoding.UTF8.GetBytes(json);
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Error handling HTTP request");
            try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { }
        }
    }

    private void AddCorsHeaders(HttpListenerResponse response)
    {
        foreach (var h in CorsHeaders)
        {
            var parts = h.Split([':'], 2);
            if (parts.Length == 2)
                response.Headers.Add(parts[0].Trim(), parts[1].Trim());
        }
    }

    private string GetActionsJson(string? filterId)
    {
        var actions = new List<object>();

        var emoteSheet = _dataManager.GetExcelSheet<Emote>();
        if (emoteSheet != null)
        {
            foreach (var emote in emoteSheet)
            {
                var id = (int)emote.RowId;
                if (!string.IsNullOrEmpty(filterId) && id.ToString() != filterId)
                    continue;

                var name = emote.Name?.ToString() ?? "";
                if (string.IsNullOrEmpty(name)) continue;

                var command = emote.Command?.ToString() ?? "";
                var textCmd = "";
                try
                {
                    var textCmdRow = emote.TextCommand;
                    if (textCmdRow.IsValid)
                        textCmd = textCmdRow.Value?.Command?.ToString() ?? "";
                }
                catch { }

                actions.Add(new
                {
                    id,
                    name,
                    command = !string.IsNullOrEmpty(textCmd) ? textCmd : $"/{command}",
                    category = "emote",
                    duration = 0f,
                    iconId = (ushort)0,
                });
            }
        }

        var actionSheet = _dataManager.GetExcelSheet<Action>();
        if (actionSheet != null)
        {
            foreach (var action in actionSheet)
            {
                var id = (int)action.RowId;
                if (!string.IsNullOrEmpty(filterId) && id.ToString() != filterId)
                    continue;

                var name = action.Name?.ToString() ?? "";
                if (string.IsNullOrEmpty(name)) continue;

                var category = "action";
                var actionCategory = action.ActionCategory?.Value;
                if (actionCategory != null && actionCategory.Value.IsValid)
                {
                    category = actionCategory.Value.Name?.ToString() ?? "action";
                }

                string animPath = "";
                try
                {
                    var timeline = action.AnimationTimeline?.Value;
                    if (timeline.IsValid)
                    {
                        animPath = timeline.Value?.Key?.ToString() ?? "";
                    }
                }
                catch { }

                actions.Add(new
                {
                    id,
                    name,
                    command = $"/ac \"{name}\"",
                    category,
                    duration = action.Cast100ms / 100f,
                    iconId = (ushort)action.Icon,
                    animPath,
                });
            }
        }

        var timelineSheet = _dataManager.GetExcelSheet<ActionTimeline>();
        var timelines = new List<object>();
        if (timelineSheet != null)
        {
            foreach (var tl in timelineSheet)
            {
                timelines.Add(new
                {
                    id = (int)tl.RowId,
                    key = tl.Key?.ToString() ?? "",
                });
            }
        }

        var result = new
        {
            totalActions = actions.Count,
            totalTimelines = timelines.Count,
            gameVersion = GetGameVersion(),
            actions,
            timelines,
        };

        return JsonSerializer.Serialize(result, JsonOptions);
    }

    private string GetEmotesJson()
    {
        var emotes = new List<object>();
        var sheet = _dataManager.GetExcelSheet<Emote>();
        if (sheet != null)
        {
            foreach (var e in sheet)
            {
                var name = e.Name?.ToString() ?? "";
                if (string.IsNullOrEmpty(name)) continue;

                var cmd = "";
                try
                {
                    var tc = e.TextCommand;
                    if (tc.IsValid)
                        cmd = tc.Value?.Command?.ToString() ?? "";
                }
                catch { }

                emotes.Add(new
                {
                    id = (int)e.RowId,
                    name,
                    command = cmd,
                    category = e.EmoteCategory?.Value?.Name?.ToString() ?? "",
                });
            }
        }
        return JsonSerializer.Serialize(new { emotes }, JsonOptions);
    }

    private string GetRacesJson()
    {
        var races = new List<object>();
        var sheet = _dataManager.GetExcelSheet<Race>();
        if (sheet != null)
        {
            foreach (var r in sheet)
            {
                races.Add(new
                {
                    id = (int)r.RowId,
                    name = r.Name?.ToString() ?? "",
                    femaleName = r.FemaleName?.ToString() ?? "",
                    maleName = r.MaleName?.ToString() ?? "",
                });
            }
        }
        return JsonSerializer.Serialize(new { races }, JsonOptions);
    }

    private string GetGameVersion()
    {
        try
        {
            return _dataManager.Language.ToString();
        }
        catch
        {
            return "unknown";
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public void Dispose()
    {
        _cts?.Cancel();
        _listener?.Stop();
        _listener?.Close();
    }
}
```

---

## Steps After Getting Home

### Step 1: Launch XIVLauncherCN (.NET 8 Version)

On the home PC, open PowerShell and run:

```powershell
# 如果还没有 XIVLauncherCN，下载 .NET 8 版本（6.4.8-1）
$ProgressPreference='SilentlyContinue'
Invoke-WebRequest -Uri 'https://ghproxy.net/https://github.com/ottercorp/FFXIVQuickLauncher/releases/download/6.4.8-1/XIVLauncherCN-win-Portable.7z' -OutFile "$env:TEMP\XIVLauncherCN.7z" -UseBasicParsing
# 需要安装 7-Zip 来解压
# 解压后，把 Update.exe 重命名为 Update.exe.bak 禁止自动更新
# 启动前清空 DOTNET_ROOT 避免读到 AutoClaw 的 .NET
$env:DOTNET_ROOT = $null
Start-Process "解压路径\current\XIVLauncherCN.exe"
```

**Critical: do NOT let XIVLauncherCN auto-update!** Updating to 6.8.x requires .NET 10, which CET-crashes on Win10. Rename Update.exe to Update.exe.bak before launching.

### Step 2: Configure Dalamud

1. Log in to the CN account
2. ⚙️ Settings → Dalamud → check Enable Dalamud
3. Experimental → check Enable development mode
4. Add a path under Dev Plugin Locations (e.g. `C:\Users\MAR\devPlugins`)
5. Launch the game
6. In game type `/xlsettings` — seeing the Dalamud window = success

### Step 3: Create the Plugin Project

```powershell
mkdir ChoreoHelper
cd ChoreoHelper
# 创建上面 4 个文件（.csproj / plugin.json / Plugin.cs / HttpServer.cs）
```

### Step 4: Build

```powershell
dotnet build
```

On success the DLL is auto-copied to `%AppData%\XIVLauncher\devPlugins\ChoreoHelper\`.

If the build fails saying Dalamud.dll cannot be found, check that `%AppData%\XIVLauncher\dev\` exists. If not: in game `/xlsettings` → Experimental → confirm Dev Mode is enabled, then restart the game.

### Step 5: Load the Plugin

In game `/xlsettings` → Installed Plugins → find ChoreoHelper → Load. The chat shows "ChoreoHelper 已启动".

### Step 6: Verify

Visit <http://localhost:48794/actions> in a browser — JSON data showing = success.

---

## Web Tool Integration Code (Add To Your React Project)

```javascript
// 在动作库面板加一个"从游戏同步"按钮
async function syncFromGame() {
  try {
    const res = await fetch('http://localhost:48794/actions');
    const data = await res.json();
    // data.actions = [{ id, name, command, category, duration, iconId, animPath }, ...]
    // data.timelines = [{ id, key }, ...]
    // 写入你的 actionDb
    console.log(`同步了 ${data.totalActions} 个动作`);
  } catch (e) {
    alert('无法连接 ChoreoHelper 插件，请确认游戏已启动且插件已加载');
  }
}
```

---

## API Endpoints

| Endpoint            | Description                          |
| ------------------- | ------------------------------------ |
| GET /               | Service info                         |
| GET /actions        | All action data (emote + action)     |
| GET /actions?id=N   | Single action by ID                  |
| GET /actions/emotes | Emotes only                          |
| GET /actions/races  | Race data                            |
| GET /health         | Health check                         |
| GET /version        | Version info                         |

Listen address: <http://localhost:48794>
CORS enabled; web pages can fetch directly.
