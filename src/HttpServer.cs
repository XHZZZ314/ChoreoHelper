using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using Lumina.Excel;
using Lumina.Excel.Sheets;
using Action = Lumina.Excel.Sheets.Action;

namespace ChoreoHelper;

public sealed class HttpServer : IDisposable
{
    private readonly IDataManager _dataManager;
    private readonly IPluginLog _log;
    private readonly IFramework _framework;
    private readonly ActionPreviewer? _previewer;
    private readonly PlaybackManager? _playback;
    private readonly AnimationPoseFreezer? _freezer;
    private readonly ShowRunner? _showRunner;
    public Func<string>? InputStatus { get; set; }
    public string PluginInstanceId { get; } = Guid.NewGuid().ToString("D");
    private readonly string _pairingCode;
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _serverTask;
    private const int Port = 48794;
    // CORE-HTTP：请求不再在接受循环里串行 await（旧实现的队头阻塞：一条慢歌词能把
    // 停止/seek/状态压住 10s）。接受即按车道分发给调度器，慢车道满员只拒歌词本身。
    // FIX-E 的在途登记/排空职责并入调度器（内部 InFlightTracker）。
    private readonly RequestDispatcher _dispatcher = new(
        HttpDispatchPolicy.FastMaxConcurrency, HttpDispatchPolicy.OutboundMaxConcurrency);

    private static readonly HttpClient _httpClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    // CORE-HTTP：POST 变更互斥闸。旧实现靠接受循环串行让所有请求天然互斥；请求并发后
    // 用这条闸保持 POST 之间的互斥语义不变（处理器都是毫秒级，停止最坏也只等一个
    // 毫秒级变更，不会等歌词/游戏线程慢路径——那些都在 GET 快车道上并发执行）。
    private readonly SemaphoreSlim _postGate = new(1, 1);

    public HttpServer(IDataManager dataManager, IPluginLog log, IFramework framework, ActionPreviewer? previewer = null, PlaybackManager? playback = null, AnimationPoseFreezer? freezer = null, string pairingCode = "", ShowRunner? showRunner = null)
    {
        _dataManager = dataManager;
        _log = log;
        _framework = framework;
        _previewer = previewer;
        _playback = playback;
        _freezer = freezer;
        _pairingCode = pairingCode;
        _showRunner = showRunner;
    }

    public void Start()
    {
        // 双开客户端会抢注 http.sys 前缀：另一客户端的监听器在它重载/关闭前一直占着端口。
        // 立即放弃 = 本客户端从此无 API（实测热重载后端口被另一客户端抢走）。
        // 后台有限重试 —— 对端监听器消亡后本实例即可接上（绝不阻塞插件加载线程）。
        _cts = new CancellationTokenSource();
        _serverTask = Task.Run(() => BindLoop(_cts.Token));
    }

    private async Task BindLoop(CancellationToken ct)
    {
        // 无限重试：90 次内每 2s（3 分钟，覆盖对端重载窗口），之后每 30s 低频兜底 ——
        // 双开客户端只要对端让出端口（关闭/重载），本实例最终必然接管 API。
        for (var attempt = 1; ; attempt++)
        {
            if (ct.IsCancellationRequested) return;
            HttpListener? candidate = null;
            try
            {
                candidate = new HttpListener();
                candidate.Prefixes.Add($"http://localhost:{Port}/");
                candidate.Start();
                if (ct.IsCancellationRequested) // Dispose 与绑定竞速：绑定成功但已取消 → 立即关掉防泄漏
                {
                    try { candidate.Close(); } catch { }
                    return;
                }
                _listener = candidate;
                _ = ListenLoop(ct);
                _log.Information("HTTP server listening on http://localhost:{port}/ (attempt {a})", Port, attempt);
                return;
            }
            catch (Exception ex)
            {
                try { candidate?.Close(); } catch { }
                if (attempt == 1 || attempt % 15 == 0)
                    _log.Error(ex, "HTTP port {port} busy (attempt {a}, likely another game client)", Port, attempt);
                var delay = attempt <= 90 ? 2000 : 30000;
                try { await Task.Delay(delay, ct); } catch (TaskCanceledException) { return; }
            }
        }
    }

    private async Task ListenLoop(CancellationToken ct)
    {
        // v0.5.27：整体 try/catch —— 本任务是 fire-and-forget，Dispose 关闭监听器时在途的
        // GetContextAsync 会抛 ObjectDisposedException，未观察的异常会被终结器重抛 →
        // Dalamud 判定插件崩溃并禁用（实测 00:49 重载后被禁用）。绝不让异常逃出。
        try
        {
            while (!ct.IsCancellationRequested && _listener?.IsListening == true)
            {
                HttpListenerContext ctx;
                try { ctx = await _listener.GetContextAsync(); }
                catch { break; } // HttpListenerException / ObjectDisposedException（关闭竞速）→ 正常退出
                // CORE-HTTP：接受后立即分发，绝不内联 await handler——
                // 串行等待就是队头阻塞的根因（一条慢歌词把停止/seek/状态压住 10s）
                DispatchAccepted(ctx, ct);
            }
        }
        catch { /* 兜底：任何逃逸异常都不出任务边界 */ }
    }

    /// <summary>CORE-HTTP：分发单个已接受请求。按车道过调度器（满员 503），调度器负责
    /// 在途登记与 Dispose 排空；handler 业务异常在 RunAccepted 里兜底关响应。</summary>
    private void DispatchAccepted(HttpListenerContext ctx, CancellationToken ct)
    {
        try
        {
            var path = ctx.Request.Url?.AbsolutePath ?? "/";
            var method = ctx.Request.HttpMethod;
            var accepted = _dispatcher.TryAccept(
                HttpDispatchPolicy.LaneFor(method, path),
                () => RunAccepted(ctx, ct));
            if (!accepted)
            {
                _log.Warning("Request lane full, reject {method} {path} with 503", method, path);
                LocalApiSecurity.RespondJson(ctx,
                    "{\"error\":\"busy\",\"message\":\"请求繁忙，请稍后重试\"}", 503);
            }
        }
        catch { try { ctx.Response.Close(); } catch { } }
    }

    private async Task RunAccepted(HttpListenerContext ctx, CancellationToken ct)
    {
        try { await HandleRequest(ctx, ct); }
        catch { try { ctx.Response.Close(); } catch { } }
    }

    private async Task HandleRequest(HttpListenerContext ctx, CancellationToken ct)
    {
        try
        {
            var path = ctx.Request.Url?.AbsolutePath ?? "/";
            var query = System.Web.HttpUtility.ParseQueryString(ctx.Request.Url?.Query ?? "");
            var method = ctx.Request.HttpMethod;

            // v0.6.7：OPTIONS 预检一律零副作用，来源不允许直接 403（预检失败真请求发不出来）
            if (method == "OPTIONS")
            {
                LocalApiSecurity.HandlePreflight(ctx);
                return;
            }

            // Phase 1 会话签发（POST-only，需配对码，无游戏副作用；策略表未收录时在此直管）。
            if (path == LocalApiSecurity.SessionAuthPath)
            {
                if (method != "POST") { LocalApiSecurity.MethodNotAllowed(ctx, "POST"); return; }
                if (!LocalApiSecurity.CheckToken(ctx.Request, _pairingCode))
                {
                    _log.Warning("Pairing check failed for POST {path} (token {state})",
                        path, ctx.Request.Headers[LocalApiSecurity.TokenHeader] != null ? "mismatch" : "missing");
                    LocalApiSecurity.PairingRequired(ctx);
                    return;
                }
                LocalApiSecurity.RespondJson(ctx,
                    LocalApiSecurity.SessionTokenJson(LocalApiSecurity.MintSessionToken(_pairingCode)));
                return;
            }

            if (method == "POST")
            {
                // v0.6.7：POST 一律是写操作（播放/预览/录制/引擎开关），先过配对码。
                // Phase 1 双接受：配对码（legacy）或活会话令牌（preferred）；配对读仍只认配对码。
                // 防的是别的网页偷偷发 localhost 请求控制角色——配对头浏览器外拿不到
                if (!LocalApiSecurity.CheckWriteToken(ctx.Request, _pairingCode))
                {
                    _log.Warning("Pairing check failed for POST {path} (token {state})",
                        path, ctx.Request.Headers[LocalApiSecurity.TokenHeader] != null ? "mismatch" : "missing");
                    LocalApiSecurity.PairingRequired(ctx);
                    return;
                }
                // 路径在但方法不对 → 405（POST 打只读端点属于误用，明说）；两用端点与
                // 未知路径不在这一级拦（未知路径闸后 404）
                if (PlaybackApiPolicy.PostWrongMethodAllow(path) is { } postAllow)
                {
                    LocalApiSecurity.MethodNotAllowed(ctx, postAllow);
                    return;
                }
                // CORE-HTTP：POST 变更互斥（保持旧接受级串行的 POST↔POST 语义：快速连点
                // 播放/seek/stop 仍不交错）。闸内处理器全是毫秒级同步操作，停止最坏也只等
                // 一个毫秒级变更；歌词/游戏线程慢路径都是 GET，不进这条闸。
                await _postGate.WaitAsync();
                try
                {
                    // 请求体大小统一在 ReadPostBody 里限（声明长度/chunked 都拦，超限 413）
                    string? postJson;
                    if (path == "/preview") { postJson = HandlePreview(ctx); }
                    else if (path == "/playback/start") { postJson = HandlePlaybackStart(ctx); }
                    else if (path == "/playback/timeline") { postJson = HandlePlaybackTimeline(ctx); }
                    else if (path == "/playback/seek") { postJson = HandlePlaybackSeek(ctx); }
                    else if (path == "/playback/freeze") { postJson = HandlePlaybackFreeze(ctx); }
                    else if (path == "/playback/stop") { postJson = HandlePlaybackStop(ctx); }
                    else if (path == "/shows/validate") { postJson = HandleShowValidate(ctx); }
                    else if (path == "/shows/load") { postJson = await _framework.RunOnFrameworkThread(() => HandleShowLoad(ctx)); }
                    else if (path == "/shows/arm") { postJson = await _framework.RunOnFrameworkThread(() => HandleShowArm(ctx)); }
                    else if (path == "/shows/start") { postJson = await _framework.RunOnFrameworkThread(() => HandleShowStart(ctx)); }
                    else if (path == "/shows/stop") { postJson = await _framework.RunOnFrameworkThread(() => HandleShowStop(ctx)); }
                    else if (path is "/shows/arm-owned" or "/shows/schedule" or "/shows/stop-owned")
                    { postJson = await _framework.RunOnFrameworkThread(() => HandleOwnedShow(ctx, path)); }
                    else if (path == "/gpose/toggle")
                    {
                        // GPose 精确编辑模式开关：发 /gpose 命令 + 切换内部精确管线
                        postJson = _freezer?.GposeToggle() ?? "{\"error\":\"no freezer\"}";
                    }
                    else if (path == "/settings/engine") { postJson = HandleEngineSetting(ctx); }
                    else { AddCorsHeaders(ctx); ctx.Response.StatusCode = 404; ctx.Response.Close(); return; }
                    if (postJson == null) return;   // handler 已自行回 4xx/5xx（413/400/409/500/503）
                    ctx.Response.ContentType = "application/json; charset=utf-8";
                    AddCorsHeaders(ctx);
                    var postBytes = System.Text.Encoding.UTF8.GetBytes(postJson);
                    ctx.Response.OutputStream.Write(postBytes, 0, postBytes.Length);
                    ctx.Response.Close();
                    return;
                }
                finally { _postGate.Release(); }
            }

            // v0.6.7：GET/HEAD 之外的怪方法（PUT/DELETE…）不进任何业务逻辑——
            // 路径认得回 405，认不得回 404
            if (method != "GET" && method != "HEAD")
            {
                var otherAllow = PlaybackApiPolicy.OtherMethodAllow(path);
                if (otherAllow != null)
                    LocalApiSecurity.MethodNotAllowed(ctx, otherAllow);
                else
                {
                    ctx.Response.StatusCode = 404;
                    ctx.Response.Close();
                }
                return;
            }

            // SEC-1：GET/HEAD 里的私有读（角色/会话/调试状态，含原本就当写管的 /debug/poke）
            // 一律要配对码——授权只认配对头不认 Origin（"null" 是任意不透明来源都能发的）
            if (ReadAuthPolicy.IsPairedPlayRead(path) && !LocalApiSecurity.CheckToken(ctx.Request, _pairingCode))
            {
                _log.Warning("Pairing check failed for {method} {path} (token {state})",
                    method, path, ctx.Request.Headers[LocalApiSecurity.TokenHeader] != null ? "mismatch" : "missing");
                LocalApiSecurity.PairingRequired(ctx);
                return;
            }

            ctx.Response.ContentType = "application/json; charset=utf-8";
            AddCorsHeaders(ctx);

            string? json;

            // Async endpoints (lyrics via NetEase Music API)
            if (method == "GET" && path == "/lyrics/search")
            {
                json = await SearchLyrics(query["s"] ?? "", ct);
            }
            else if (method == "GET" && path == "/lyrics")
            {
                json = await GetLyrics(query["id"], query["url"], ct);
            }
            // FIX-E 线程契约：以下三个端点会读本地角色/ObjectTable——依赖在位时一律调度进
            // 框架线程（只带出 JSON 字符串）。依赖缺失时落到下方 switch 的 `?.` 短路臂，
            // 照旧回 {"error":"no freezer"}，不碰游戏。
            // PLUG-1（FIX-J）：HEAD 与 GET 同路——旧分支只认 GET，HEAD 会掉进下方 switch
            // 在监听线程上直读游戏对象（/debug/poke 还会在非框架线程触发调试动作）。
            // HEAD /lyrics 两臂维持 GET-only，落到 switch 无臂 → 404，一致拒绝不碰游戏。
            else if (path == "/x1/status" && InputStatus != null)
            {
                json = await GameThreadJson(ctx, InputStatus, "x1/status");
                if (json == null) return;
            }
            else if ((method == "GET" || method == "HEAD") && path == "/debug/animstate" && _freezer != null)
            {
                json = await GameThreadJson(ctx, _freezer.GetDebugAnimState, "animstate");
                if (json == null) return;
            }
            else if ((method == "GET" || method == "HEAD") && path == "/debug/poke" && _freezer != null)
            {
                json = await GameThreadJson(ctx, () => _freezer.DebugPoke(query["action"]), "poke");
                if (json == null) return;
            }
            else if ((method == "GET" || method == "HEAD") && path == "/dancers" && _previewer != null)
            {
                json = await GameThreadJson(ctx, GetDancersJson, "dancers");
                if (json == null) return;
            }
            else
            {
                json = path switch
                {
                    "/health" => "{\"status\":\"ok\"}",
                    // GAMECLOCK：本端口（48794 播放通道）的 /capabilities 注入 statusV2 能力位，
                    // 网页凭它启用时钟跟随；注入失败/旧载荷原样返回（PlaybackStatusV2 纯函数，测试直测）
                    "/capabilities" => CapabilitiesJson(),
                    "/actions" => GetActionsJson(query["id"]),
                    "/actions/emotes" => GetEmotesJson(),
                    "/actions/emote-durations" => GetEmoteDurationsJson(),
                    "/actions/measured-durations" => GetMeasuredDurationsJson(),
                    // 以下三臂只是依赖缺失（_freezer/_previewer==null）时的兜底：`?.` 短路
                    // 不会执行游戏对象读取（依赖在位时上方分支已调度进框架线程）
                    "/debug/animstate" => _freezer?.GetDebugAnimState() ?? "{\"error\":\"no freezer\"}",
                    "/debug/diag" => _freezer?.GetDebugDiag() ?? "{\"error\":\"no freezer\"}",
                    "/debug/tlinfo" => GetTimelineInfo(query["id"]),
                    "/debug/poke" => _freezer?.DebugPoke(query["action"]) ?? "{\"error\":\"no freezer\"}",
                    "/settings/engine" => "{\"pinMode\":" + (AnimationPoseFreezer.PinModeEnabled ? "true" : "false") + "}",
                    "/gpose/state" => _freezer != null ? ("{\"gpose\":" + (_freezer.IsGposeActive ? "true" : "false") + "}") : "{\"gpose\":false}",
                    // /bonerec/* 与 /debug/boneprobe 已删（BoneAnimator 死臂 / v0.7.1 FIX-A AUD2-002：免配对骨骼直写端点不允许在生产存在）
                    "/debug/emotefamily" => _freezer?.GetDebugEmoteFamily(query["cmd"],
                        (query["ids"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                            .Select(s => ushort.TryParse(s.Trim(), out var v) ? v : (ushort)0).Where(v => v != 0).ToArray())
                        ?? "{\"error\":\"no freezer\"}",
                    "/actions/races" => GetRacesJson(),
                    "/dancers" => GetDancersJson(),
                    "/classjobs" => GetClassJobsJson(),
                    "/version" => GetVersionJson(),
                    "/playback/status" => HandlePlaybackStatus(),
                    // EXEC-CORE：演出执行器只读状态（私有读——已在 ReadAuthPolicy 配对表里）
                    "/shows/clock" => ShowClockJson(),
                    "/shows/status" => _showRunner?.StatusJson(true)
                        ?? "{\"error\":\"no show runner\",\"message\":\"演出执行器不可用（插件初始化未完成）\"}",

                    _ => null
                };

                if (json == null && path != "/")
                {
                    ctx.Response.StatusCode = 404;
                    ctx.Response.Close();
                    return;
                }

                if (path == "/")
                {
                    json = JsonSerializer.Serialize(new
                    {
                        name = "ChoreoHelper",
                        version = GetPluginVersion(),
                        endpoints = new[] { "/actions", "/actions/emotes", "/actions/emote-durations", "/actions/races", "/dancers", "/preview", "/playback/start", "/playback/timeline", "/playback/stop", "/playback/seek", "/playback/freeze", "/playback/status", "/lyrics/search", "/lyrics", "/health", "/version", "/capabilities" }
                    }, JsonOptions);
                }
            }

            var bytes = Encoding.UTF8.GetBytes(json ?? "{}");
            ctx.Response.ContentLength64 = bytes.Length;
            // FIX-J 实机自测：HEAD 响应不能写实体 body（HttpListener 抛异常 → 兜底 catch
            // 变 500）——与 LocalApiSecurity.RespondJson 同口径：保留 Content-Length，跳过写体
            if (!string.Equals(method, "HEAD", StringComparison.OrdinalIgnoreCase))
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Error handling HTTP request");
            try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { }
        }
    }

    /// <summary>/preview：预览一条动作。AUD-012：依赖缺失回 503、坏 JSON 回 400，
    /// 不再把错误包在 HTTP 200 里。返回 null = 响应已自行写完（调用方不再重复写）。</summary>
    private string? HandlePreview(HttpListenerContext ctx)
    {
        try
        {
            var body = ReadPostBody(ctx);
            if (body == null) return null;
            using var req = ParseBodyJson(ctx, body, "/preview");
            if (req == null) return null;
            string command;
            try { command = req.RootElement.GetProperty("command").GetString() ?? ""; }
            catch (Exception)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.PreviewCommandRequiredJson, 400);
                return null;
            }
            if (_previewer == null)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.NoPreviewerJson, 503);
                return null;
            }
            if (!ChatCommandPolicy.TryValidate(command, out var reason))
            {
                // AUD2-005：预览命令同样过安全策略（会真正进游戏聊天系统）
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InvalidCommandJson("预览", reason), 400);
                return null;
            }
            string json;
            try { _previewer.Preview(command); json = JsonSerializer.Serialize(new { status = "ok", command }, JsonOptions); }
            catch { json = JsonSerializer.Serialize(new { status = "error", message = "Preview failed" }, JsonOptions); }
            // 预览顺便实测该动作的动画时长，前端用于显示/校正 clip 时长
            _freezer?.MeasureDurationDelayed(command);
            return json;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Preview handler failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    /// <summary>/settings/engine：双引擎切换（经典/增强）。坏 JSON 回 400（原先容忍后照常 200）。</summary>
    private string? HandleEngineSetting(HttpListenerContext ctx)
    {
        var body = ReadPostBody(ctx);
        if (body == null) return null;
        try
        {
            using var req = ParseBodyJson(ctx, body, "/settings/engine");
            if (req == null) return null;
            if (req.RootElement.TryGetProperty("pinMode", out var pm))
            {
                var newVal = pm.GetBoolean();
                if (newVal != AnimationPoseFreezer.PinModeEnabled)
                {
                    AnimationPoseFreezer.PinModeEnabled = newVal;
                    // 切引擎时安全收尾：解钉 + 停预览（钉住会话跨引擎残留 = 半冻结状态）
                    _freezer?.StopPreview();
                    _log.Information("Engine mode set: {m}", newVal ? "pin" : "classic");
                }
            }
            return "{\"pinMode\":" + (AnimationPoseFreezer.PinModeEnabled ? "true" : "false") + "}";
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Engine setting failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    /// <summary>CORS 响应头：v0.6.7 起从通配 * 收紧为来源允许列表（file:// 入口、本机端口、
    /// 以后的正式站），来源不允许就不带头——浏览器自然读不到响应。</summary>
    private static void AddCorsHeaders(HttpListenerContext ctx) => LocalApiSecurity.AddCors(ctx);

    /// <summary>FIX-E 线程契约（AUD2-010）：把碰游戏对象的读取调度进框架线程执行，只把
    /// 不可变 JSON 字符串带出线程（不把 Dalamud 对象/裸指针带出）。等待有 5 秒上限——
    /// 游戏线程忙/插件正在关闭时明确 503，不吊死在途请求（Dispose 排空依赖这个上限）。
    /// 返回 null = 响应已自行写完（503/500），调用方直接结束请求。</summary>
    private async Task<string?> GameThreadJson(HttpListenerContext ctx, Func<string> fn, string what)
    {
        try
        {
            return await _framework.RunOnFrameworkThread(fn).WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (TimeoutException)
        {
            _log.Error("{what}: game thread dispatch timed out (5s)", what);
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.GameThreadBusyJson, 503);
            return null;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "{what}: game thread dispatch failed", what);
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    // ===== NetEase Music API =====

    private async Task<string> SearchLyrics(string searchQuery, CancellationToken ct)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(searchQuery))
                return "{\"error\":\"empty query\"}";

            // If it looks like a URL with id=, extract ID and go straight to lyrics
            if (searchQuery.Contains("music.163.com") && searchQuery.Contains("id="))
            {
                var songId = ExtractSongId(searchQuery);
                if (!string.IsNullOrEmpty(songId))
                    return await GetLyrics(songId, null, ct);
            }

            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["s"] = searchQuery,
                ["type"] = "1",
                ["limit"] = "10",
                ["offset"] = "0"
            });

            using var req = new HttpRequestMessage(HttpMethod.Post, "https://music.163.com/api/search/get")
            {
                Content = content
            };
            req.Headers.Add("Referer", "https://music.163.com");
            req.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

            // CORE-HTTP：SendAsync 带服务生命周期令牌——Dispose 排空时在途歌词立即中断，
            // 不把 6s 排空窗口拖满 10s 超时
            using var resp = await _httpClient.SendAsync(req, ct);
            var json = await resp.Content.ReadAsStringAsync();
            return json;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "SearchLyrics failed");
            return "{\"error\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}";
        }
    }

    private async Task<string> GetLyrics(string? songId, string? url, CancellationToken ct)
    {
        try
        {
            if (!string.IsNullOrEmpty(url))
            {
                songId = ExtractSongId(url) ?? songId;
            }

            if (string.IsNullOrEmpty(songId))
                return "{\"error\":\"no song id\"}";

            // HYGIENE(AC-7)：songId 来自链接截取，可能带 URL 元字符——必须转义，
            // 防止拼进查询串后改写请求结构（纯数字 id 转义后逐字节不变）
            using var req = new HttpRequestMessage(HttpMethod.Get,
                $"https://music.163.com/api/song/lyric?os=pc&id={Uri.EscapeDataString(songId)}&lv=-1&kv=-1&tv=-1");
            req.Headers.Add("Referer", "https://music.163.com");
            req.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

            using var resp = await _httpClient.SendAsync(req, ct);
            var json = await resp.Content.ReadAsStringAsync();
            return json;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "GetLyrics failed");
            return "{\"error\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}";
        }
    }

    private static string? ExtractSongId(string url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        if (url.Contains("id="))
        {
            var after = url.Substring(url.IndexOf("id=") + 3);
            var id = after.Split(['&', '#', '?', '/'])[0];
            return string.IsNullOrEmpty(id) ? null : id;
        }
        return null;
    }

    // ===== Game Data Endpoints =====

    

    /// <summary>统一读 POST 请求体（v0.7.1 AUD-011）：声明长度/chunked 都走 ReadBodyLimited，
    /// 超限直接回 413 并返回 null——调用方看到 null 就结束请求，不再写响应。
    /// InputStream 读写出错按请求错误回 400。上限与响应字节形状在 PlaybackApiPolicy。</summary>
    private string? ReadPostBody(HttpListenerContext ctx)
    {
        try
        {
            var body = LocalApiSecurity.ReadBodyLimited(ctx.Request, PlaybackApiPolicy.MaxPostBodyBytes);
            if (body != null) return body;
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.BodyTooLargeJson, 413);
            return null;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Read POST body failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.BodyUnreadableJson, 400);
            return null;
        }
    }

    /// <summary>解析请求体 JSON；失败回 400 并返回 null（AUD-012：输入错误不能再按 200 放行）。
    /// 解析与错误形状在 PlaybackApiPolicy，这里只补一行 Debug 日志。</summary>
    private System.Text.Json.JsonDocument? ParseBodyJson(HttpListenerContext ctx, string body, string endpoint)
    {
        if (PlaybackApiPolicy.TryParseBodyJson(body, endpoint, out var doc, out var rejection)) return doc;
        if (rejection?.DebugDetail != null)
            _log.Debug("{ep}: invalid JSON body: {msg}", endpoint, rejection.Value.DebugDetail);
        LocalApiSecurity.RespondJson(ctx, rejection!.Value.Json, rejection.Value.Status);
        return null;
    }


    /// <summary>解析并校验时间轴条目（AUD2-005/AUD2-003）：条数上限、命令安全策略、单演员
    /// 约束都在 PlaybackApiPolicy.ParseClips；这里只补 Debug 日志并把策略 DTO 映射成
    /// PlaybackClip（该类型宿主在 PlaybackManager，Dalamud 工程）。</summary>
    private List<PlaybackClip>? ParsePlaybackClips(HttpListenerContext ctx, System.Text.Json.JsonElement clipsEl, string endpoint)
    {
        var specs = PlaybackApiPolicy.ParseClips(clipsEl, out var rejection);
        if (specs == null)
        {
            if (rejection?.DebugDetail != null)
                _log.Debug("{endpoint}: {detail}", endpoint, rejection.Value.DebugDetail);
            LocalApiSecurity.RespondJson(ctx, rejection!.Value.Json, rejection.Value.Status);
            return null;
        }
        var clips = new List<PlaybackClip>(specs.Count);
        foreach (var s in specs)
            clips.Add(new PlaybackClip
            {
                Id = s.Id, ActorId = s.ActorId, Start = s.Start, Duration = s.Duration,
                Command = s.Command, Type = s.Type, Name = s.Name
            });
        return clips;
    }

    /// <summary>/playback/start：发整条时间轴并开始播放（AUD-012 统一错误语义）。
    /// 依赖缺失 503、坏 JSON/缺字段/条数超限/命令不合格 400、空时间轴 400 带「时间轴为空」、
    /// 播放中替换 409、启动失败 409、内部异常 500——不再把错误包在 HTTP 200 的 {"error":...} 里。
    /// AUD2-003：请求必须携带 revision（时间轴修订号），与 clips 一起原子生效。</summary>
    private string? HandlePlaybackStart(HttpListenerContext ctx)
    {
        try
        {
            if (_playback == null)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.NoPlaybackJson, 503);
                return null;
            }
            var body = ReadPostBody(ctx);
            if (body == null) return null;
            using var data = ParseBodyJson(ctx, body, "/playback/start");
            if (data == null) return null;

            List<PlaybackClip>? clips = null;
            if (data.RootElement.TryGetProperty("clips", out var clipsEl))
            {
                if (clipsEl.ValueKind != System.Text.Json.JsonValueKind.Array)
                {
                    LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.ClipsMustBeArrayJson, 400);
                    return null;
                }
                clips = ParsePlaybackClips(ctx, clipsEl, "/playback/start");
                if (clips == null) return null;
            }
            if (clips == null || clips.Count == 0)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.EmptyTimelineJson, 400);
                return null;
            }
            float fromTime = -1;
            if (data.RootElement.TryGetProperty("fromTime", out var ft) && ft.TryGetSingle(out var ftv)) fromTime = ftv;
            float speed = 1.0f;
            if (data.RootElement.TryGetProperty("speed", out var sp) && sp.TryGetSingle(out var spv)) speed = spv;
            // AUD2-003：revision 必带（新网页）；缺失（旧网页过渡）按 0 记，seek 不带 revision 时不受影响
            long revision = 0;
            if (data.RootElement.TryGetProperty("revision", out var rv) && rv.TryGetInt64(out var rvv)) revision = rvv;
            _playback.SetSpeed(speed);
            // 播放中拒绝替换（409）：SetTimeline 会清已执行集合，播放中放行 = 历史命令补发
            if (!_playback.SetTimeline(clips, revision))
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.StartPlayingConflictJson, 409);
                return null;
            }
            if (!_playback.Play(fromTime))
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.CannotStartJson, 409);
                return null;
            }
            return JsonSerializer.Serialize(new { status = "playing", clipCount = clips.Count, revision }, JsonOptions);
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or KeyNotFoundException or FormatException or InvalidCastException)
        {
            _log.Debug("Playback start: bad clip fields: {msg}", ex.Message);
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.ClipFieldsIncompleteJson, 400);
            return null;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Playback start failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    /// <summary>/playback/timeline（AUD2-003）：网页在进入游戏模式、编辑防抖结束、
    /// 撤销/重做、导入、切换项目后，把规范时间轴快照 + revision 推给插件原子替换，
    /// 让之后的 seek 永远作用在当前时间轴上（旧实现 seek 只发时间，会作用在空/过期时间轴）。
    /// 允许空数组=清空插件时间轴。依赖缺失 503、坏 JSON/条数超限/命令不合格 400、
    /// 播放中替换 409（SetTimeline 会清已执行集合，播放中放行 = 历史命令补发）。</summary>
    private string? HandlePlaybackTimeline(HttpListenerContext ctx)
    {
        try
        {
            if (_playback == null)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.NoPlaybackJson, 503);
                return null;
            }
            var body = ReadPostBody(ctx);
            if (body == null) return null;
            using var data = ParseBodyJson(ctx, body, "/playback/timeline");
            if (data == null) return null;
            if (!data.RootElement.TryGetProperty("clips", out var clipsEl)
                || clipsEl.ValueKind != System.Text.Json.JsonValueKind.Array)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.ClipsMustBeArrayJson, 400);
                return null;
            }
            var clips = ParsePlaybackClips(ctx, clipsEl, "/playback/timeline");
            if (clips == null) return null;
            // 注意：timeline 端点允许空数组（网页删光动作后同步清空插件时间轴，
            // 之后的 seek 走「无动作→停止定格」分支）；/playback/start 仍要求非空。
            long revision = 0;
            if (data.RootElement.TryGetProperty("revision", out var rv) && rv.TryGetInt64(out var rvv)) revision = rvv;
            // 播放中拒绝替换（409）：网页正常不会在播放中推快照；带 force 的旧网页/失控客户端
            // 在这里被明确挡下，而不是让插件补发一整串历史命令
            if (!_playback.SetTimeline(clips, revision))
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.TimelinePlayingConflictJson, 409);
                return null;
            }
            return JsonSerializer.Serialize(new { status = "ok", clipCount = clips.Count, revision }, JsonOptions);
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or KeyNotFoundException or FormatException or InvalidCastException)
        {
            _log.Debug("Playback timeline: bad clip fields: {msg}", ex.Message);
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.ClipFieldsIncompleteJson, 400);
            return null;
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Playback timeline failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    private string? HandlePlaybackStop(HttpListenerContext ctx)
    {
        if (_playback == null)
        {
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.NoPlaybackJson, 503);
            return null;
        }
        _playback.Stop();
        return "{\"status\":\"stopped\"}";
    }

    /// <summary>/playback/freeze：定格/解冻。依赖缺失 503、坏 JSON 400（原先 200+error）。</summary>
    private string? HandlePlaybackFreeze(HttpListenerContext ctx)
    {
        try
        {
            if (_freezer == null)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.NoFreezerJson, 503);
                return null;
            }
            var body = ReadPostBody(ctx);
            if (body == null) return null;
            string command = "";
            float time = 0;
            if (!string.IsNullOrWhiteSpace(body))
            {
                using var data = ParseBodyJson(ctx, body, "/playback/freeze");
                if (data == null) return null;
                if (data.RootElement.TryGetProperty("command", out var cmd)) command = cmd.GetString() ?? "";
                if (data.RootElement.TryGetProperty("time", out var t) && t.TryGetSingle(out var tv)) time = tv;
            }
            if (!string.IsNullOrEmpty(command) && !ChatCommandPolicy.TryValidate(command, out var reason))
            {
                // AUD2-005：定格命令同样过安全策略（会真正进游戏聊天系统）
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InvalidCommandJson("定格", reason), 400);
                return null;
            }
            if (string.IsNullOrEmpty(command))
            {
                _freezer.StopPreview();
                return "{\"status\":\"unfrozen\"}";
            }
            _freezer.RequestFreezePreview(command, time);
            return JsonSerializer.Serialize(new { status = "freezing", command, time = Math.Round(time, 1) }, JsonOptions);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Freeze failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    /// <summary>/playback/seek：拖动定位。AUD2-003：带 revision 且与插件当前时间轴不一致时
    /// 回 409（网页会重新推快照后重试），绝不静默使用旧时间轴；不带 revision（旧网页过渡）照旧。
    /// 依赖缺失 503、坏 JSON 400、版本过期 409。</summary>
    private string? HandlePlaybackSeek(HttpListenerContext ctx)
    {
        try
        {
            if (_playback == null)
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.NoPlaybackJson, 503);
                return null;
            }
            var body = ReadPostBody(ctx);
            if (body == null) return null;
            float time = 0;
            long? revision = null;
            if (!string.IsNullOrWhiteSpace(body))
            {
                using var data = ParseBodyJson(ctx, body, "/playback/seek");
                if (data == null) return null;
                if (data.RootElement.TryGetProperty("time", out var t) && t.TryGetSingle(out var tv)) time = tv;
                if (data.RootElement.TryGetProperty("revision", out var rv) && rv.TryGetInt64(out var rvv)) revision = rvv;
            }
            if (!_playback.Seek(time, revision))
            {
                LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.StaleTimelineJson, 409);
                return null;
            }
            return "{\"status\":\"seeked\",\"time\":" + time.ToString("F1") + "}";
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Seek failed");
            LocalApiSecurity.RespondJson(ctx, PlaybackApiPolicy.InternalErrorJson, 500);
            return null;
        }
    }

    private string HandlePlaybackStatus()
    {
        if (_playback == null) return "{\"error\":\"no playback\"}";
        // GAMECLOCK：旧载荷 {"playing":..,"time":..} 只对本地时钟一无所知，网页 3D 预览在
        // 游戏模式下必然漂。改为同一把状态锁里取快照，追加 revision/speed/maxEnd/单调采样戳
        // （stampMs），旧字段名与 F1 格式不动——旧网页解析不受影响；新网页凭 /capabilities
        // 的 statusV2 能力位才启用跟随（HttpServer.Capabilities 路由处注入）。
        var s = _playback.StatusSnapshot();
        return PlaybackStatusV2.BuildJson(s.Playing, s.Time, s.Revision, s.Speed, s.MaxEnd, Environment.TickCount64);
    }

    // ===== EXEC-CORE：演出执行端点（POST 全部过配对码 + POST 闸；GET /shows/status 走配对读） =====
    // 设计文档 §8：能力握手、显式开始（只收 Armed）、幂等停止、方法白名单都是硬规矩。
    // validate 语义校验（200 + ok:false + issues）；load/arm/start 状态不对回 409 带中文原因。

    /// <summary>POST /shows/validate：插件侧二次校验，不进执行器、不改状态。</summary>
    private string? HandleShowValidate(HttpListenerContext ctx)
    {
        var body = ReadPostBody(ctx);
        if (body == null) return null;
        using var data = ParseBodyJson(ctx, body, "/shows/validate");
        if (data == null) return null;
        var pr = ShowProtocolParser.Parse(ShowApiPolicy.PackageElement(data));
        if (pr.Error != null || pr.Package == null)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.InvalidShowJson(pr.Error), 400);
            return null;
        }
        var v = pr.Package.X1 == null ? ShowValidator.Validate(pr.Package) : ShowValidator.ValidateForPreparation(pr.Package);
        return JsonSerializer.Serialize(new { status = "ok", ok = v.Ok, issues = v.Issues }, JsonOptions);
    }

    /// <summary>POST /shows/load：校验 + 装载（Loaded）。校验不过 400、状态不对 409。</summary>
    private string? HandleShowLoad(HttpListenerContext ctx)
    {
        if (_showRunner == null)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.NoRunnerJson, 503);
            return null;
        }
        var body = ReadPostBody(ctx);
        if (body == null) return null;
        using var data = ParseBodyJson(ctx, body, "/shows/load");
        if (data == null) return null;
        var pr = ShowProtocolParser.Parse(ShowApiPolicy.PackageElement(data));
        if (pr.Error != null || pr.Package == null)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.InvalidShowJson(pr.Error), 400);
            return null;
        }
        var v = pr.Package.X1 == null ? ShowValidator.Validate(pr.Package) : ShowValidator.ValidateForPreparation(pr.Package);
        if (!v.Ok)
        {
            _log.Warning("Show load rejected: {reason}", v.FirstError ?? "");
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.LoadRejectedJson(v), 400);
            return null;
        }
        var root = data.RootElement;
        var clientLoadId = root.TryGetProperty("clientLoadId", out var loadId) && loadId.ValueKind == JsonValueKind.String ? loadId.GetString() : null;
        if (clientLoadId != null && (!OwnedShowLoadPolicy.ValidId(clientLoadId)
            || !root.TryGetProperty("pluginInstanceId", out var instance) || instance.GetString() != PluginInstanceId
            || !root.TryGetProperty("protocolVersion", out var protocol) || !protocol.TryGetInt32(out var version) || version != 1))
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.StateConflictJson("装载身份、协议或插件实例已变化"), 409);
            return null;
        }
        var (ok, msg) = _showRunner.Load(pr.Package, clientLoadId, clientLoadId != null);
        if (!ok)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.StateConflictJson(msg), 409);
            return null;
        }
        return JsonSerializer.Serialize(new
        {
            status = "loaded",
            packageId = _showRunner.GetScheduledStartClock().PackageId,
            clientLoadId = _showRunner.GetScheduledStartClock().ClientLoadId,
            state = _showRunner.State.ToString().ToLowerInvariant(),
            eventCount = pr.Package.Events.Count,
            durationMs = pr.Package.DurationMs
        }, JsonOptions);
    }

    /// <summary>POST /shows/arm：就绪（Armed）。状态不对 409。</summary>
    private string? HandleShowArm(HttpListenerContext ctx)
    {
        if (_showRunner == null)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.NoRunnerJson, 503);
            return null;
        }
        var (ok, msg) = _showRunner.Arm();
        if (!ok)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.StateConflictJson(msg), 409);
            return null;
        }
        return JsonSerializer.Serialize(new { status = "armed", state = _showRunner.State.ToString().ToLowerInvariant() }, JsonOptions);
    }

    /// <summary>POST /shows/start：显式开始（只收 Armed），进入倒计时。状态不对 409。</summary>
    private string? HandleShowStart(HttpListenerContext ctx)
    {
        if (_showRunner == null)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.NoRunnerJson, 503);
            return null;
        }
        var body = ReadPostBody(ctx);
        if (body == null) return null;
        if (!ShowApiPolicy.TryGetCountdownMs(body, out var countdownMs, out var rejection))
        {
            if (rejection?.DebugDetail != null)
                _log.Debug("{ep}: invalid JSON body: {msg}", "/shows/start", rejection.Value.DebugDetail);
            LocalApiSecurity.RespondJson(ctx, rejection!.Value.Json, rejection.Value.Status);
            return null;
        }
        var (ok, msg, effCd) = _showRunner.Start(countdownMs);
        if (!ok)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.StateConflictJson(msg ?? "状态不允许"), 409);
            return null;
        }
        return JsonSerializer.Serialize(new
        { status = "countdown", state = _showRunner.State.ToString().ToLowerInvariant(), countdownMs = effCd }, JsonOptions);
    }

    /// <summary>POST /shows/stop：旧无身份停止。带装载归属的场次必须由装载页面定向停止，或由玩家在
    /// 游戏内 /choreo stop 全局紧急停止——迟到的旧请求不得停止新归属场次（R1）。</summary>
    private string? HandleShowStop(HttpListenerContext ctx)
    {
        if (_showRunner == null)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.NoRunnerJson, 503);
            return null;
        }
        var stop = _showRunner.StopLegacy("网页请求停止");
        if (!stop.Ok)
        {
            LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.StateConflictJson(stop.Message), 409);
            return null;
        }
        return JsonSerializer.Serialize(new
        { status = "ok", state = _showRunner.State.ToString().ToLowerInvariant(), reason = _showRunner.StopReason }, JsonOptions);
    }

    private string CapabilitiesJson()
    {
        var value=System.Text.Json.Nodes.JsonNode.Parse(PlaybackStatusV2.WithCapabilities(LocalApiSecurity.CapabilitiesJson(),"statusV2"))!;
        value["pluginInstanceId"]=PluginInstanceId;
        if(_showRunner!=null && InputStatus!=null)
            foreach(var name in new[]{"x1-input-v1","ownedShowLoadV1","scheduledStartV1","stagePathNativeConfirmV1","stageShowV2","stageFacingV1","stageLocomotionAutoV1","stageRecoveryV1"})
                value["capabilities"]!.AsArray().Add(name);
        return value.ToJsonString();
    }

    private string ShowClockJson()
    {
        if (_showRunner == null) return ShowApiPolicy.NoRunnerJson;
        var c = _showRunner.GetScheduledStartClock();
        return JsonSerializer.Serialize(new { protocolVersion=1, pluginInstanceId=PluginInstanceId,
            serverMonoMs=c.ServerMonoMs, packageId=c.PackageId, clientLoadId=c.ClientLoadId,
            armId=c.ArmId, startId=c.StartId, deadlineMonoMs=c.DeadlineMonoMs,
            state=c.State.ToString().ToLowerInvariant() }, JsonOptions);
    }

    private string? HandleOwnedShow(HttpListenerContext ctx, string path)
    {
        if (_showRunner == null) { LocalApiSecurity.RespondJson(ctx, ShowApiPolicy.NoRunnerJson,503); return null; }
        var body=ReadPostBody(ctx); if(body==null)return null;
        using var doc=ParseBodyJson(ctx,body,path); if(doc==null)return null;
        try
        {
            var r=doc.RootElement;
            string Text(string key) => r.TryGetProperty(key,out var value) && value.ValueKind==JsonValueKind.String ? value.GetString()! : "";
            if(!r.TryGetProperty("protocolVersion",out var pv)||!pv.TryGetInt32(out var v)||v!=1)
                throw new ArgumentException("演出协议必须为1");
            if(path=="/shows/stop-owned")
            {
                var id=Text("clientLoadId");
                var stop=_showRunner.StopOwnedLoad(id,Text("packageId") is {Length:>0} p?p:null,
                    Text("armId") is {Length:>0} a?a:null,"网页定向停止");
                if(!stop.Ok){LocalApiSecurity.RespondJson(ctx,ShowApiPolicy.StateConflictJson(stop.Message),409);return null;}
                return JsonSerializer.Serialize(new{state="stopped",safe=true,matchedCurrent=stop.MatchedCurrent,clientLoadId=id});
            }
            if(path=="/shows/arm-owned")
            {
                var result=_showRunner.ArmBound(Text("packageId"),Text("clientLoadId"));
                if(!result.Ok){LocalApiSecurity.RespondJson(ctx,ShowApiPolicy.StateConflictJson(result.Message),409);return null;}
            }
            else
            {
                if(!r.TryGetProperty("deadlineMonoMs",out var d)||!d.TryGetInt64(out var deadline))throw new ArgumentException("缺少有效开演时刻");
                var result=_showRunner.ScheduleStart(Text("packageId"),Text("armId"),Text("startId"),deadline);
                if(!result.Ok){LocalApiSecurity.RespondJson(ctx,ShowApiPolicy.StateConflictJson(result.Message),409);return null;}
            }
            return ShowClockJson();
        }
        catch(ArgumentException error){LocalApiSecurity.RespondJson(ctx,ShowApiPolicy.InvalidShowJson(error.Message),400);return null;}
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
                if (!string.IsNullOrEmpty(filterId) && id.ToString() != filterId) continue;
                var name = emote.Name.ToString();
                if (string.IsNullOrEmpty(name)) continue;
                var textCmd = "";
                try { if (emote.TextCommand.IsValid) { textCmd = emote.TextCommand.Value.Command.ToString(); } } catch { }
                var category = "";
                try { if (emote.EmoteCategory.IsValid) { category = emote.EmoteCategory.Value.Name.ToString(); } } catch { }
                actions.Add(new { id, name, command = !string.IsNullOrEmpty(textCmd) ? textCmd : "/emote", category = !string.IsNullOrEmpty(category) ? category : "通常", duration = 0f, iconId = (uint)emote.Icon, type = "emote" });
            }
        }
        var classJobSheet = _dataManager.GetExcelSheet<ClassJob>();
        var actionSheet = _dataManager.GetExcelSheet<Action>();
        if (actionSheet != null)
        {
            foreach (var action in actionSheet)
            {
                var id = (int)action.RowId;
                if (!string.IsNullOrEmpty(filterId) && id.ToString() != filterId) continue;
                var name = action.Name.ToString();
                if (string.IsNullOrEmpty(name)) continue;
                var category = "技能";
                try { if (action.ActionCategory.IsValid) { category = action.ActionCategory.Value.Name.ToString(); } } catch { }
                string animPath = "";
                try { if (action.ActionTimelineHit.IsValid) { animPath = action.ActionTimelineHit.Value.Key.ToString(); } } catch { }
                string jobName = "";
                int jobId = 0;
                try { if (action.ClassJob.IsValid) { jobName = action.ClassJob.Value.Name.ToString(); jobId = (int)action.ClassJob.RowId; } } catch { }
                string jobAbbr = "";
                try { if (action.ClassJob.IsValid) { jobAbbr = action.ClassJob.Value.Abbreviation.ToString(); } } catch { }
                if (string.IsNullOrEmpty(jobName)) continue;
                actions.Add(new { id, name, command = "/ac \"" + name + "\"", category, duration = action.Cast100ms / 100f, iconId = (uint)action.Icon, animPath, type = "action", jobName, jobId, jobAbbr });
            }
        }
        return JsonSerializer.Serialize(new { totalActions = actions.Count, gameVersion = GetGameVersion(), actions }, JsonOptions);
    }

    private string GetEmotesJson()
    {
        var emotes = new List<object>();
        var sheet = _dataManager.GetExcelSheet<Emote>();
        if (sheet != null)
        {
            foreach (var e in sheet)
            {
                var name = e.Name.ToString();
                if (string.IsNullOrEmpty(name)) continue;
                var cmd = "";
                try { if (e.TextCommand.IsValid) { cmd = e.TextCommand.Value.Command.ToString(); } } catch { }
                var category = "通常";
                try { if (e.EmoteCategory.IsValid) { var catName = e.EmoteCategory.Value.Name.ToString(); if (!string.IsNullOrEmpty(catName)) category = catName; } } catch { }
                var timelineKeys = new List<string>();
                var isLoop = false;
                try { for (uint i = 0; i < 8; i++) { var tlRef = e.ActionTimeline[(int)i]; if (tlRef.IsValid) { var key = tlRef.Value.Key.ToString(); if (!string.IsNullOrEmpty(key)) timelineKeys.Add(key); if (tlRef.Value.IsLoop) isLoop = true; } } } catch { }
                emotes.Add(new { id = (int)e.RowId, name, command = cmd, category, timelineKeys, isLoop });
            }
        }
        return JsonSerializer.Serialize(new { emotes }, JsonOptions);
    }

    private string GetEmoteDurationsJson()
    {
        var result = new List<object>();
        var emoteSheet = _dataManager.GetExcelSheet<Emote>();
        if (emoteSheet != null)
        {
            foreach (var emote in emoteSheet)
            {
                var name = emote.Name.ToString();
                if (string.IsNullOrEmpty(name)) continue;
                var timelines = new List<object>();
                try
                {
                    for (int i = 0; i < 8; i++)
                    {
                        var tlRef = emote.ActionTimeline[i];
                        if (!tlRef.IsValid) continue;
                        var tl = tlRef.Value;
                        var key = tl.Key.ToString();
                        if (string.IsNullOrEmpty(key)) continue;
                        timelines.Add(new { key, isLoop = tl.IsLoop, type = (int)tl.Type });
                    }
                }
                catch { }
                result.Add(new { id = (int)emote.RowId, name, timelines });
            }
        }
        return JsonSerializer.Serialize(new { emotes = result }, JsonOptions);
    }

    private string GetMeasuredDurationsJson()
    {
        // 实测动画时长（预览/定格/播放时累积）：{"/bow":3.2,...}
        var rounded = new Dictionary<string, float>();
        foreach (var kv in AnimationPoseFreezer.MeasuredDurations)
            rounded[kv.Key] = (float)Math.Round(kv.Value, 2);
        return JsonSerializer.Serialize(new { durations = rounded }, JsonOptions);
    }

    private string GetRacesJson()
    {
        var races = new List<object>();
        var sheet = _dataManager.GetExcelSheet<Race>();
        if (sheet != null) { foreach (var r in sheet) { races.Add(new { id = (int)r.RowId, masculine = r.Masculine.ToString(), feminine = r.Feminine.ToString() }); } }
        return JsonSerializer.Serialize(new { races }, JsonOptions);
    }

    private string GetDancersJson()
    {
        var dancers = new List<object>();
        try { if (_previewer != null) { dancers.Add(_previewer.GetLocalPlayerInfo()); } } catch (Exception ex) { _log.Error(ex, "Failed to get dancer info"); }
        return JsonSerializer.Serialize(new { dancers }, JsonOptions);
    }

    private string GetClassJobsJson()
    {
        var jobs = new List<object>();
        var sheet = _dataManager.GetExcelSheet<ClassJob>();
        if (sheet != null)
        {
            foreach (var cj in sheet)
            {
                var name = cj.Name.ToString();
                if (string.IsNullOrEmpty(name)) continue;
                var abbr = cj.Abbreviation.ToString();
                var parent = "";
                try { if (cj.ClassJobParent.IsValid) { parent = cj.ClassJobParent.Value.Name.ToString(); } } catch { }
                jobs.Add(new { id = (int)cj.RowId, name, abbreviation = abbr, parent, role = (int)cj.Role, jobIndex = (int)cj.JobIndex });
            }
        }
        return JsonSerializer.Serialize(new { classJobs = jobs }, JsonOptions);
    }
    // HYGIENE(AC-8)：旧实现返回的是客户端语言（Language.ToString()），塞进 gameVersion 字段
    // 名不副实。改读 Lumina ffxiv 仓库版本（游戏 ver 文件解析而来）；读不到时维持 "unknown"。
    private string GetGameVersion()
    {
        try
        {
            var repos = _dataManager.GameData?.Repositories;
            if (repos != null && repos.TryGetValue("ffxiv", out var repo) && !string.IsNullOrEmpty(repo?.Version))
                return repo.Version;
            return "unknown";
        }
        catch { return "unknown"; }
    }

    private static string GetPluginVersion()
    {
        try { return System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "unknown"; }
        catch { return "unknown"; }
    }

    private string GetTimelineInfo(string? idStr)
    {
        try
        {
            if (!ushort.TryParse(idStr, out var id))
                return "{\"error\":\"id required\"}";
            var sheet = _dataManager.GetExcelSheet<ActionTimeline>();
            var row = sheet.GetRow(id);
            var key = "";
            try { key = row.Key.ToString(); } catch { }
            return JsonSerializer.Serialize(new { id, key = key ?? "", isLoop = row.IsLoop }, JsonOptions);
        }
        catch (Exception ex) { return "{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}"; }
    }

    private string GetVersionJson()
    {
        return JsonSerializer.Serialize(new { version = GetPluginVersion(), gameVersion = GetGameVersion() }, JsonOptions);
    }

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        if (_listener != null)
        {
            try { if (_listener.IsListening) _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
        }
        // TASK-20260908（AC-4）：停接后先原子关闭调度器准入——排空观察窗口内迟到的
        // TryAccept 一律立即拒绝（走既有 503），已接受工作迟到完成也有延迟终结化兜底，
        // 不再撞已释放信号量。FIX-E（AUD2-010）契约延续：有限超时排空在途 handler 后
        // 才释放 _postGate/_cts；在途 handler 的框架调度有 5s 上限，出站歌词已接取消令牌。
        _dispatcher.Dispose();
        if (!_dispatcher.WaitDrained(TimeSpan.FromSeconds(6)))
            _log.Warning("HTTP drain timeout: {n} request(s) still in flight", _dispatcher.InFlight);
        try { _cts?.Dispose(); } catch { }
        _postGate.Dispose();
    }
}
