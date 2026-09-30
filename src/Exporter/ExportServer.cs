using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;

namespace ChoreoHelper.Exporter;

/// <summary>
/// v3 导出服务器（独立端口 48795，不干扰 v0.5 的 48794）。
/// 最小实现：/export/clip 触发录制 → 返回 AnimClipData JSON。
/// /export/progress 返回状态。
/// </summary>
public sealed class ExportServer : IDisposable
{
    private readonly IPluginLog _log;
    private readonly IFramework _framework;
    private readonly RecorderService _recorder;
    private readonly string _pairingCode;
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _serverTask;
    // FIX-E：在途请求登记——Dispose 停接新请求后等在途 handler 到安全点（有限超时）
    private readonly InFlightTracker _inFlight = new();
    public const int Port = 48795;

    // v0.6.7：单条录制互斥——第二条并发请求立刻回 busy，不再陪着干等 30 秒。
    // FIX-E（AUD2-010）：改实例级——静态锁会把旧实例的录制状态带进热重载后的新实例
    private readonly SemaphoreSlim RecGate = new(1, 1);

    // ARCH2：/export/* 方法白名单与静态页映射移入 ExportApiPolicy（纯函数，datalayertest 直测）；
    // 旧 GetEndpoints/PostEndpoints 集合自 v0.6.7 起无任何引用（白名单实际走 HandleAsync 的
    // allowed 表，现为 ExportApiPolicy.AllowedMethods），随提取一并删除。

    public ExportServer(IPluginLog log, IFramework framework, RecorderService recorder, string pairingCode = "")
    {
        _log = log;
        _framework = framework;
        _recorder = recorder;
        _pairingCode = pairingCode;
    }

    public void Start()
    {
        // PLUG-3（FIX-J）：绑定改为后台重试循环（与 48794 BindLoop 同策略）。旧实现一次
        // bind 失败就永久放弃——热重载时旧实例还没释放端口，新实例从此无 API。
        // 立即放弃对双开/热重载场景不可接受；后台重试绝不阻塞插件加载线程。
        _cts = new CancellationTokenSource();
        _serverTask = Task.Run(() => BindLoop(_cts.Token));
        CleanStalePending(); // v0.7.1 FIX-C：启动时清掉上次会话没 commit 的过期暂存
    }

    private async Task BindLoop(CancellationToken ct)
    {
        // 与 HttpServer.BindLoop 同策略：90 次内每 2s（3 分钟，覆盖对端重载窗口），
        // 之后每 30s 低频兜底；Dispose 取消令牌随时终止。成功后接监听循环。
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
                _log.Information("ExportServer listening on localhost:{port} (attempt {a})", Port, attempt);
                return;
            }
            catch (Exception ex)
            {
                try { candidate?.Close(); } catch { }
                if (attempt == 1 || attempt % 15 == 0)
                    _log.Error(ex, "ExportServer port {port} busy (attempt {a}, likely another game client)", Port, attempt);
                var delay = attempt <= 90 ? 2000 : 30000;
                try { await Task.Delay(delay, ct); } catch (TaskCanceledException) { return; }
            }
        }
    }

    private async Task ListenLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener?.IsListening == true)
        {
            try
            {
                var ctx = await _listener.GetContextAsync();
                // FIX-E：接受即登记（同步，防"已接受未登记"漏算），handler 结束才注销——
                // Dispose 排空时在途请求一个都不漏
                var h = _inFlight.Begin();
                // PLUG-6（FIX-J）：已接受的请求调度绝不带取消令牌——Task.Run(work, ct) 在
                // ct 已取消时会整体跳过工作体，Begin 之后 finally 不执行 → 在途计数泄漏，
                // Dispose 排空陪葬。同 RequestDispatcher 的源头契约：令牌只进工作体内部 I/O。
                _ = Task.Run(async () =>
                {
                    try { await HandleAsync(ctx); }
                    catch (Exception ex) { _log.Error(ex, "ExportServer handler crashed"); }
                    finally { h.Dispose(); }
                });
            }
            catch (ObjectDisposedException) { break; }
            catch (HttpListenerException) { break; }
            catch (Exception ex) { _log.Error(ex, "ExportServer listen error"); break; }
        }
    }

    private async Task HandleAsync(HttpListenerContext ctx)
    {
        try
        {
            var path = ctx.Request.Url?.AbsolutePath ?? "/";
            var query = System.Web.HttpUtility.ParseQueryString(ctx.Request.Url?.Query ?? "");
            var method = ctx.Request.HttpMethod ?? "GET";

            // v0.6.7：OPTIONS 预检一律零副作用。曾经这里没有拦截，OPTIONS 会落进业务逻辑——
            // 预检打 /export/walkreset 会真的触发角色移动（发布安全门槛 P0，已堵死）
            if (method == "OPTIONS")
            {
                LocalApiSecurity.HandlePreflight(ctx);
                return;
            }

            // v0.6.7：能力握手（与 48794 同路径 /capabilities），网页靠它识别插件/协议/配对
            if (path == "/capabilities")
            {
                if (method != "GET") { LocalApiSecurity.MethodNotAllowed(ctx, "GET"); return; }
                LocalApiSecurity.RespondJson(ctx, LocalApiSecurity.CapabilitiesJson());
                return;
            }

            // 静态资源：/ 和 /viewer 是固定页面；其余非 /export/ 路径按 WebRoot 下相对文件服务
            // （pose-viewer 的 libs/*.js、model.glb/gltf 等都从这里出，不存在的文件 404）
            if (!path.StartsWith("/export/"))
            {
                // v0.6.7：静态文件只许 GET，别的方法不进文件服务
                if (method != "GET") { LocalApiSecurity.MethodNotAllowed(ctx, "GET"); return; }
                ServeStatic(ctx, ExportApiPolicy.StaticFileNameFor(path));
                return;
            }

            // v0.6.7：方法白名单（ARCH2 起在 ExportApiPolicy）——GET 只读（列表/骨架/单条数据/诊断），
            // POST 写操作（录制/复位/批量）；未知路径 404
            string? allowed = ExportApiPolicy.AllowedMethodFor(path);
            if (allowed == null)
            {
                LocalApiSecurity.RespondJson(ctx, ExportApiPolicy.UnknownEndpointJson, 404);
                return;
            }
            if (method != allowed)
            {
                LocalApiSecurity.MethodNotAllowed(ctx, allowed);
                return;
            }
            // SEC-1：/export/* 整段都是个人数据（动作/骨架/录制状态），GET 与 POST 同标准
            // 都要配对码——授权只认配对头不认 Origin（"null" 是任意不透明来源都能发的）
            if (!LocalApiSecurity.CheckToken(ctx.Request, _pairingCode))
            {
                _log.Warning("Pairing check failed for {method} {path} (token {state})",
                    method, path, ctx.Request.Headers[LocalApiSecurity.TokenHeader] != null ? "mismatch" : "missing");
                LocalApiSecurity.PairingRequired(ctx);
                return;
            }
            if (allowed == "POST")
            {
                if (ctx.Request.ContentLength64 > ExportApiPolicy.MaxPostBodyBytes)
                {
                    LocalApiSecurity.RespondJson(ctx, "{\"error\":\"request body too large\"}", 413);
                    return;
                }
            }

            // v0.7.1 FIX-A：返回 null = 处理器已自行回 4xx，外层不再重复写响应
            string? json = path switch
            {
                "/export/progress" => HandleProgress(),
                "/export/clip" => HandleClipSync(ctx),
                "/export/clip/commit" => HandleClipCommit(ctx),
                "/export/clip/cancel" => HandleClipCancel(ctx),
                "/export/recstate" => HandleRecState(),
                "/export/list" => HandleList(),
                "/export/batch" => HandleBatch(ctx),
                "/export/batchstatus" => GetBatchStatus(),
                "/export/batchcancel" => HandleBatchCancel(),
                "/export/walkreset" => HandleWalkReset(),
                "/export/verify" => HandleVerify(ctx),
                "/export/verifystatus" => HandleVerifyStatus(),
                "/export/getclip" => HandleGetClip(ctx, query["name"] ?? ""),
                // FIX-E 线程契约：骨架读取碰本地角色 DrawObject/Skeleton 指针，只允许框架线程
                // （PLUG-2：等待有 5 秒上限，超时处理器自行回 503）
                "/export/skeleton" => await HandleSkeletonAsync(ctx),
                // 白名单放行后此臂不可达；保留同口径兜底
                _ => ExportApiPolicy.UnknownEndpointJson
            };
            if (json == null) return;
            LocalApiSecurity.RespondJson(ctx, json);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "ExportServer handle error");
            try { ctx.Response.Close(); } catch { }
        }
    }

    private string HandleProgress()
    {
        return JsonSerializer.Serialize(new { exporting = false, status = "ready", port = Port });
    }

    /// <summary>Recorder 实时状态（日志不可用时的诊断通道）。</summary>
    private string HandleRecState()
    {
        return _recorder.GetDiagJson();
    }

    /// <summary>同步录制（阻塞 HTTP 直到录制完成或超时）。MVP：直接在 HTTP 线程等。
    /// v0.6.7：同一时刻只允许一条录制——并发的第二条立刻回 busy，不再陪着干等 30 秒。
    /// v0.7.1 FIX-A（AUD2-001）：save=true 的命令先过路径策略，转不出安全文件名直接 400，
    /// 不录不存（旧代码会把它当路径片段静默写出/写挂）。返回 null = 响应已自行写完。
    /// HYGIENE(AC-6)：所有能直接 return 的忙碌检查都必须在 RecGate.Wait 之前——
    /// 与 HandleVerify 同构，杜绝"拿到信号量后又提前 return"导致信号量被遗弃的路径。</summary>
    private string? HandleClipSync(HttpListenerContext ctx)
    {
        if (_batchRunning)
            return "{\"error\":\"busy\",\"message\":\"批量录制进行中，等它完成或先取消\"}";
        if (!RecGate.Wait(0))
            return "{\"error\":\"busy\",\"message\":\"一条录制已在进行，等它完成再试\"}";
        try
        {
            var body = ReadPostBodyOr413(ctx);
            if (body == null) return null;

            // ARCH2：请求体字段容错解析在 ExportApiPolicy（坏/缺体按缺省继续的旧口径不变）
            var (command, save) = ExportApiPolicy.ParseClipBody(body);

            if (string.IsNullOrEmpty(command))
                return "{\"error\":\"command required\"}";

            // v0.7.1 FIX-B（AUD2-005）：录制命令会真正触发游戏动作，过统一安全策略
            if (!ChatCommandPolicy.TryValidate(command, out var policyReason))
            {
                _log.Warning("ExportServer: refused command by policy: {reason}", policyReason);
                LocalApiSecurity.RespondJson(ctx,
                    "{\"error\":\"invalid command\",\"message\":\"录制命令不合格：" + policyReason + "\"}", 400);
                return null;
            }

            // v0.7.1 FIX-A：存盘名唯一来源 = 路径策略；不安全命令明确 400，不再录制
            string saveName = "";
            if (save)
            {
                if (!ClipPathPolicy.TryMakeFileName(command, out saveName))
                {
                    _log.Warning("ExportServer: refused unsafe clip command {cmd}", command);
                    LocalApiSecurity.RespondJson(ctx,
                        "{\"error\":\"invalid command\",\"message\":\"动作命令无法转成安全文件名，已拒绝\"}", 400);
                    return null;
                }
            }

            var resultJson = "";
            string? stagedRecordingId = null;
            string? stageError = null;
            double avgHz = 0;
            bool lowRate = false;
            var done = new ManualResetEventSlim(false);
            _recorder.Record(command, result =>
            {
                if (result.Ok && result.Clip != null)
                {
                    resultJson = AnimWriter.ToJson(result.Clip);
                    avgHz = result.AvgSampleHz;
                    lowRate = result.LowSampleRate;
                    if (save)
                    {
                        // v0.7.1 FIX-C（AUD2-006）：不再直接覆盖 clips\<name>.json——先写 pending
                        // 暂存（随机 ID 命名，不拿 command 拼路径）。网页质检通过并写入资料库后
                        // POST /export/clip/commit 才原子替换最终文件；质检失败/取消走 cancel，
                        // 断网/崩溃的孤儿暂存由 24 小时过期清理兜底。坏片从此吃不掉健康文件。
                        try
                        {
                            var recId = Guid.NewGuid().ToString("N");
                            Directory.CreateDirectory(PendingDir);
                            CleanStalePending();
                            File.WriteAllText(Path.Combine(PendingDir, recId + ".json"), resultJson);
                            stagedRecordingId = recId;
                            _log.Information("ExportServer: staged pending {id} for {name} ({kb:F0}KB)，等网页质检提交",
                                recId, saveName, resultJson.Length / 1024);
                        }
                        catch (Exception ex)
                        {
                            stageError = ex.Message;
                            _log.Error(ex, "ExportServer pending stage failed");
                        }
                    }
                }
                else
                    resultJson = JsonSerializer.Serialize(new { error = result.Error });
                done.Set();
            });

            if (!done.Wait(30000))
                return "{\"error\":\"recording timeout (30s)\"}";

            // v0.7.1 FIX-C：clip 响应追加 recordingId（网页凭它 commit）与采样率诊断
            // （AUD2-007）；错误响应原样返回
            if (resultJson.Length > 0 && resultJson[0] == '{' && !resultJson.Contains("\"error\""))
            {
                try
                {
                    var node = System.Text.Json.Nodes.JsonNode.Parse(resultJson)!.AsObject();
                    if (stagedRecordingId != null) node["recordingId"] = stagedRecordingId;
                    if (stageError != null) node["stageError"] = stageError;
                    if (avgHz > 0) node["sampleHz"] = Math.Round(avgHz, 1);
                    if (lowRate) node["lowSampleRate"] = true;
                    return node.ToJsonString();
                }
                catch (Exception ex) { _log.Error(ex, "ExportServer response decorate failed"); }
            }
            return resultJson;
        }
        catch (Exception ex)
        {
            return "{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}";
        }
        finally
        {
            RecGate.Release();
        }
    }

    /// <summary>读 POST 体；声明长度与 chunked 超限一律回 413（与 48794 ReadPostBody 同口径，
    /// 2026-08-31 审计 P2：chunked 超限曾被各 handler 以 200+error json 放行）。返回 null = 响应已写完。
    /// 上限与 413 字节形状在 ExportApiPolicy。</summary>
    private string? ReadPostBodyOr413(HttpListenerContext ctx)
    {
        var body = LocalApiSecurity.ReadBodyLimited(ctx.Request, ExportApiPolicy.MaxPostBodyBytes);
        if (body != null) return body;
        LocalApiSecurity.RespondJson(ctx, ExportApiPolicy.BodyTooLargeJson, 413);
        return null;
    }

    /// <summary>已导出动作列表（网页引擎加载用）。</summary>
    private string HandleList()
    {
        try
        {
            var dir = ClipsDir;
            var files = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.json") : Array.Empty<string>();
            var names = new List<string>();
            foreach (var f in files) names.Add(Path.GetFileNameWithoutExtension(f));
            return JsonSerializer.Serialize(new { clips = names, count = names.Count });
        }
        catch { return "{\"clips\":[],\"count\":0}"; }
    }

    private static string ClipsDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "XIVLauncherCN", "ChoreoExports", "clips");

    // v0.7.1 FIX-C（AUD2-006）：录制两阶段提交的暂存/隔离目录（都在插件专属 ChoreoExports 内）
    private static string PendingDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "XIVLauncherCN", "ChoreoExports", "pending");
    private static string QuarantineDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "XIVLauncherCN", "ChoreoExports", "quarantine");
    private static readonly TimeSpan PendingMaxAge = TimeSpan.FromHours(24);
    // 隔离目录是"待主人查看"的坏片证据，保留窗口给宽：14 天后启动/关闭时清掉
    private static readonly TimeSpan QuarantineMaxAge = TimeSpan.FromDays(14);

    /// <summary>清理过期暂存产物（启动/关闭各跑一次）：
    /// ① pending 目录超 24h 的暂存（网页没 commit 的孤儿：崩溃/断网/超时残留）；
    /// ② clips 目录超 24h 的 .committing 半成品（commit/批量原子写崩溃残留——正常寿命
    /// 只有毫秒级，留下就是孤儿；审计 P1：此前无任何清理，且批量"已存在即跳过"会永久
    /// 跳过同名的半写文件）。pending 目录与 .committing 后缀都是本插件专属产物，只按时间清。
    /// ③ quarantine 目录超 14 天的隔离坏片（审计 P2：此前只进不出）。</summary>
    private void CleanStalePending()
    {
        CleanExpired(PendingDir, "*.json", PendingMaxAge);
        CleanExpired(ClipsDir, "*.json.committing", PendingMaxAge);
        CleanExpired(QuarantineDir, "*.json", QuarantineMaxAge);
    }

    private static void CleanExpired(string dir, string pattern, TimeSpan maxAge)
    {
        try
        {
            if (!Directory.Exists(dir)) return;
            var cutoff = DateTime.UtcNow - maxAge;
            foreach (var f in Directory.GetFiles(dir, pattern))
            {
                try { if (File.GetLastWriteTimeUtc(f) < cutoff) File.Delete(f); } catch { }
            }
        }
        catch { }
    }

    /// <summary>/export/clip/commit（v0.7.1 FIX-C AUD2-006）：网页质检通过并写入资料库后，
    /// 凭 recordingId 把 pending 暂存提交成正式文件。recordingId 只认本插件 Guid "N" 格式
    /// （32 个十六进制字符）防路径注入；动作名仍过路径策略；替换用同目录临时文件 +
    /// File.Replace（同卷原子），不会留下半写 JSON，也不吃掉旧文件。</summary>
    private string? HandleClipCommit(HttpListenerContext ctx)
    {
        var body = ReadPostBodyOr413(ctx);
        if (body == null) return null;
        var (recId, name) = ExportApiPolicy.ParseCommitBody(body);

        if (recId.Length != 32 || !IsHexString(recId))
        {
            LocalApiSecurity.RespondJson(ctx, "{\"error\":\"invalid recordingId\"}", 400);
            return null;
        }
        var pendingPath = Path.Combine(PendingDir, recId + ".json");
        if (!File.Exists(pendingPath))
        {
            LocalApiSecurity.RespondJson(ctx,
                "{\"error\":\"unknown recordingId\",\"message\":\"暂存不存在或已过期，请重录这条动作\"}", 404);
            return null;
        }
        // v0.7.1 FIX-A 口径沿用：最终路径唯一出口 = 路径策略（清洗 + 双重约束）
        if (!ClipPathPolicy.TryGetPathForCommand(ClipsDir, name, ".json", out var final, out _))
        {
            LocalApiSecurity.RespondJson(ctx,
                "{\"error\":\"invalid name\",\"message\":\"动作名转不成安全文件名\"}", 400);
            return null;
        }
        try
        {
            Directory.CreateDirectory(ClipsDir);
            var tmp = final + ".committing";
            File.Move(pendingPath, tmp, true);                      // 同卷改名进 clips 目录
            if (File.Exists(final)) File.Replace(tmp, final, null); // 原子替换，旧文件不会被半写覆盖
            else File.Move(tmp, final);
            _log.Information("ExportServer: committed {name}.json ({id})", name, recId);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "ExportServer commit failed");
            LocalApiSecurity.RespondJson(ctx,
                "{\"error\":\"commit failed\",\"message\":\"落盘失败：" + ex.Message.Replace("\"", "'") + "\"}", 500);
            return null;
        }
        return JsonSerializer.Serialize(new { ok = true, name });
    }

    /// <summary>/export/clip/cancel（v0.7.1 FIX-C AUD2-006）：质检失败/用户取消时让插件丢掉
    /// 暂存，不覆盖最后一份健康文件。幂等：暂存不存在也回 ok。</summary>
    private string? HandleClipCancel(HttpListenerContext ctx)
    {
        var body = ReadPostBodyOr413(ctx);
        if (body == null) return null;
        var recId = ExportApiPolicy.ParseCancelBody(body);
        if (recId.Length != 32 || !IsHexString(recId))
        {
            LocalApiSecurity.RespondJson(ctx, "{\"error\":\"invalid recordingId\"}", 400);
            return null;
        }
        try { File.Delete(Path.Combine(PendingDir, recId + ".json")); } catch { }
        return "{\"ok\":true}";
    }

    private static bool IsHexString(string s)
    {
        foreach (var c in s)
            if (!Uri.IsHexDigit(c)) return false;
        return true;
    }

    /// <summary>单个 clip 文件内容（网页引擎按需拉取）。
    /// v0.7.1 FIX-A（AUD2-001）：动作名经路径策略清洗 + 最终路径双重约束在 ClipsDir 内——
    /// 旧实现 name 只补一刀 Replace("..","_")，Windows 上带盘符的 name 会让 Path.Combine 丢掉
    /// ClipsDir，免配对 GET 就能读走 pairing.json 等任意 JSON。不安全动作名明确 400。</summary>
    private string? HandleGetClip(HttpListenerContext ctx, string name)
    {
        try
        {
            if (!ClipPathPolicy.TryGetPathForCommand(ClipsDir, name, ".json", out var path, out _))
            {
                LocalApiSecurity.RespondJson(ctx,
                    "{\"error\":\"invalid name\",\"message\":\"动作名不合法，已拒绝\"}", 400);
                return null;
            }
            if (!File.Exists(path)) return "{\"error\":\"not found\"}";
            return File.ReadAllText(path);
        }
        catch (Exception ex) { return "{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}"; }
    }

    // ---------- 批量录制（逐个动作：录制→存盘→下一个；可取消）----------
    private readonly List<string> _batchQueue = new();
    private volatile bool _batchRunning;
    // 批量进度由 BatchLoop 任务写、HTTP 状态线程读——volatile 保证状态页读到的是最新值
    private volatile int _batchDone;
    private volatile int _batchTotal;
    private string? _batchLastError;   // AUD-017：最后一条错误（状态页可见，不再永久 busy 无解释）

    private string? HandleBatch(HttpListenerContext ctx)
    {
        if (_batchRunning) return GetBatchStatus();
        // v0.7.1 AUD-017：拿到 RecGate 后不再提前释放——批量启动的整个准备期都握着，
        // 单条录制在此期间只会得到 busy；RecGate 改由 BatchLoop 的 finally 释放
        //（启动失败/空队列则本方法自己释放）。修掉"先检查后释放再置状态"的竞态窗口。
        if (!RecGate.Wait(0)) return "{\"error\":\"busy\",\"message\":\"单条录制进行中，等它完成再启动批量\"}";
        try
        {
            var body = ReadPostBodyOr413(ctx);
            if (body == null) return null;
            // ARCH2：坏/缺体 → 空清单（端点照旧回 commands required）
            var commands = ExportApiPolicy.ParseBatchCommands(body);
            if (commands.Count == 0) return "{\"error\":\"commands required\"}";

            _batchQueue.Clear();
            // 跳过已有文件（按剥掉变体后缀的基础名查）；v0.7.1 FIX-A：转不出安全文件名的
            // 命令直接不进队列（旧代码会把它们录下来再写挂/写歪，现在明确跳过并记日志）
            foreach (var c in commands)
            {
                if (!ClipPathPolicy.TryMakeFileName(c, out var nm))
                {
                    _log.Warning("Export batch: skip unsafe command {cmd}", c);
                    continue;
                }
                if (!ClipPathPolicy.TryResolvePath(ClipsDir, nm, ".json", out var p)
                    || !File.Exists(p)) _batchQueue.Add(c);
            }
            _batchTotal = _batchQueue.Count;
            _batchDone = 0;
            _batchLastError = null;
            if (_batchTotal == 0) return GetBatchStatus(); // finally 释放 RecGate
            _batchRunning = true;
            _ = Task.Run(BatchLoop); // RecGate 移交 BatchLoop，由其 finally 释放
            return GetBatchStatus();
        }
        finally
        {
            if (!_batchRunning) RecGate.Release();
        }
    }

    private async Task BatchLoop()
    {
        // v0.7.1 AUD-017：try/finally 全覆盖——超时/异常/取消/正常结束都清忙状态和队列，
        // 记录最后错误并释放 RecGate；完成回调改 TrySetResult 防重复回调抛异常；
        // TaskCompletionSource 异步续延，避免在框架线程上inline跑收尾逻辑。
        try
        {
            while (_batchRunning && _batchQueue.Count > 0)
            {
                var cmd = _batchQueue[0];
                var wasPersistent = false;
                var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                try
                {
                    _recorder.Record(cmd, result =>
                    {
                        if (result.Ok && result.Clip != null)
                        {
                            // v0.7.1 FIX-C（AUD2-006）：批量没有网页质检兜底，落盘前用同口径
                            // ClipQuality 自检（与网页 recAmp 同源，scripts\qc-crosstest.js
                            // 交叉测试锁口径）。静止坏片不进 clips 目录，落隔离目录待查并报 lastError
                            if (ClipQuality.IsStill(result.Clip))
                            {
                                var amp = ClipQuality.MaxRotationOffset(result.Clip);
                                try
                                {
                                    Directory.CreateDirectory(QuarantineDir);
                                    var qName = ClipPathPolicy.TryMakeFileName(cmd, out var nm) ? nm : "batch";
                                    var qPath = Path.Combine(QuarantineDir, $"{qName}-{DateTime.Now:yyyyMMdd-HHmmss}.json");
                                    File.WriteAllText(qPath, AnimWriter.ToJson(result.Clip));
                                }
                                catch { }
                                _batchLastError = $"{cmd}: 静止数据（幅度 {amp:F2}）未写入动作库，已隔离到 quarantine 待查";
                                _log.Warning("Export batch: still clip for {cmd} quarantined (amp={amp:F2})", cmd, amp);
                            }
                            else
                            {
                                try
                                {
                                    Directory.CreateDirectory(ClipsDir);
                                    // v0.7.1 FIX-A：存盘路径唯一出口 = 路径策略（入队时已过滤，这里兜底）
                                    if (ClipPathPolicy.TryGetPathForCommand(ClipsDir, cmd, ".json", out var path, out _))
                                        AnimWriter.WriteFile(result.Clip, path);
                                    else
                                        _log.Warning("Export batch: unsafe clip name refused for {cmd}", cmd);
                                }
                                catch { }
                            }
                        }
                        // timeout = 到时长上限还在动 → 持续/循环类动作（跳舞等），录完角色还在跳，
                        // 发个短动作打断 + 多等 3 秒，避免污染下一条录制。
                        // 注意：/nod motion 国服不存在（实测报"命令不存在"）；beckon motion 实测有效。
                        // 姿态类（坐/躺/跪/装死）打断不了，要玩家动一下站起来——这类动作别进自动批量。
                        wasPersistent = result.Reason == "timeout";
                        done.TrySetResult(true);
                    });
                }
                catch (Exception ex)
                {
                    _batchLastError = $"{cmd}: 启动失败 {ex.Message}";
                    _log.Error(ex, "Export batch: Record({cmd}) threw", cmd);
                    _batchQueue.RemoveAt(0);
                    continue;
                }
                try
                {
                    await done.Task.WaitAsync(TimeSpan.FromSeconds(30));
                }
                catch (TimeoutException)
                {
                    // 30s 没等到回调（正常录制 20s 上限必回调）= 回调丢失/框架卡死，终止批量而不是陪葬
                    _batchLastError = $"{cmd}: 录制回调 30 秒未返回，批量终止";
                    _log.Error("Export batch: callback for {cmd} never returned, aborting", cmd);
                    break;
                }
                _batchQueue.RemoveAt(0);
                _batchDone++;
                if (wasPersistent)
                {
                    _recorder.Trigger("/beckon motion");
                    await Task.Delay(3000);
                }
                await Task.Delay(2500); // 间隔：等动作动画锁解除，太短下一个动作会被吞掉（录成静止）
            }
        }
        catch (Exception ex)
        {
            _batchLastError = $"批量录制异常终止: {ex.Message}";
            _log.Error(ex, "Export batch loop crashed");
        }
        finally
        {
            _batchRunning = false;
            _batchQueue.Clear();
            RecGate.Release();
            _log.Information("Export batch finished: {d}/{t} lastError={e}", _batchDone, _batchTotal, _batchLastError ?? "(无)");
        }
    }

    /// <summary>取消批量录制：当前这条录完存盘后停（已录的不丢，下次续录自动跳过）。
    /// GAMECLOCK：同一入口顺带结束进行中的动作审核（AC-6：batchcancel 或插件侧安全超时
    /// 都要能一次且只有一次地终结审核会话）。</summary>
    private string HandleBatchCancel()
    {
        _batchRunning = false;
        _verifyCancelRequested = true;
        _log.Information("Export batch/verify cancelled by user");
        return "{\"ok\":true}";
    }

    /// <summary>姿态复位：角色跳一下+走约 1.2 秒，清掉坐/躺/跪等姿态（异步，调用方等 2~3 秒）。</summary>
    private string HandleWalkReset()
    {
        _recorder.WalkReset(1200);
        return "{\"ok\":true}";
    }

    // ---------- 动作审核（GAMECLOCK /export/verify：重放一条已录命令 + 现采对比，只报告不落盘） ----------
    // 安全边界（AC-8）：玩家在配对网页上点一次才跑一次；每会话至多重放一条命令；沿用录制
    // 通道的卫生序列/前台保护；取消/失败/断开/30s 安全超时都收敛到同一个收尾（exactly-once）；
    // 不写 clips/pending/quarantine 任何文件（AC-7：审核不碰已存数据）。姿势流镜像通道仍按
    // AUD2-002 结论保持删除——审核的现采数据只进比较器，绝不出插件。

    private volatile bool _verifyRunning;          // 审核会话进行中（HTTP 线程写读，volatile 够）
    private volatile bool _verifyCancelRequested;  // batchcancel/取消通道置位，采样等待循环消费
    private string _verifyCommand = "";            // 当前审核的命令（verifystatus 展示用）
    private double _verifyStartedAt;               // RecordTiming 单调秒
    private string? _verifyLastError;              // 上一次会话级失败（verifystatus 展示）

    /// <summary>POST /export/verify {command}：同步等现采完成（同 HandleClipSync 的 30s 上限），
    /// 与库里同名 clip 比较后返回结构化报告。互斥语义（AC-6）：审核进行中/批量进行中/单条
    /// 录制占用一律 409；命令过 ChatCommandPolicy（400）；库里没有同名 clip 404。</summary>
    private string? HandleVerify(HttpListenerContext ctx)
    {
        if (_verifyRunning)
        {
            LocalApiSecurity.RespondJson(ctx, "{\"error\":\"busy\",\"message\":\"一个审核已在进行，等它完成或先取消\"}", 409);
            return null;
        }
        if (_batchRunning)
        {
            LocalApiSecurity.RespondJson(ctx, "{\"error\":\"busy\",\"message\":\"批量录制进行中，等它完成或先取消\"}", 409);
            return null;
        }
        if (!RecGate.Wait(0))
        {
            LocalApiSecurity.RespondJson(ctx, "{\"error\":\"busy\",\"message\":\"单条录制进行中，等它完成再试\"}", 409);
            return null;
        }
        try
        {
            var body = ReadPostBodyOr413(ctx);
            if (body == null) return null;
            var command = ExportApiPolicy.ParseVerifyBody(body);
            if (string.IsNullOrEmpty(command))
                return "{\"error\":\"command required\"}";
            // 重放会真的触发游戏动作：与录制同一条命令安全策略
            if (!ChatCommandPolicy.TryValidate(command, out var policyReason))
            {
                LocalApiSecurity.RespondJson(ctx,
                    "{\"error\":\"invalid command\",\"message\":\"审核命令不合格：" + policyReason + "\"}", 400);
                return null;
            }
            // 只审已录过的动作：库里没有同名 clip 就没有比较基准
            if (!ClipPathPolicy.TryGetPathForCommand(ClipsDir, command, ".json", out var clipPath, out _)
                || !File.Exists(clipPath))
            {
                LocalApiSecurity.RespondJson(ctx,
                    "{\"error\":\"no clip\",\"message\":\"动作库里没有这条动作的录制数据，先录制再审核\"}", 404);
                return null;
            }
            AnimClipData stored;
            try
            {
                stored = System.Text.Json.JsonSerializer.Deserialize<AnimClipData>(File.ReadAllText(clipPath),
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? throw new InvalidCastException("clip is null");
            }
            catch (Exception ex)
            {
                LocalApiSecurity.RespondJson(ctx,
                    "{\"error\":\"invalid clip\",\"message\":\"库里这条动作的数据读不出来：" + ex.Message.Replace("\"", "'") + "\"}", 400);
                return null;
            }

            // 会话开始：置旗标 → 触发一次重放采样 → 等回调（期间响应取消旗标）
            _verifyCancelRequested = false;
            _verifyCommand = command;
            _verifyStartedAt = RecordTiming.NowSeconds();
            _verifyRunning = true;
            try
            {
                var done = new TaskCompletionSource<RecorderService.RecordResult>(TaskCreationOptions.RunContinuationsAsynchronously);
                _recorder.Record(command, r => done.TrySetResult(r));
                RecorderService.RecordResult? result = null;
                while (true)
                {
                    if (done.Task.IsCompletedSuccessfully) { result = done.Task.Result; break; }
                    if (_verifyCancelRequested && !done.Task.IsCompleted)
                    {
                        // CancelPending 让在途采样立即带 error 回调解除阻塞；会话收尾仍只有一处
                        _recorder.CancelPending();
                    }
                    if (RecordTiming.NowSeconds() - _verifyStartedAt > 30)
                    {
                        _verifyLastError = $"{command}: 审核 30 秒未完成，安全超时终止";
                        _log.Error("Export verify: session for {cmd} timed out", command);
                        _recorder.CancelPending();
                        if (done.Task.Wait(2000)) result = done.Task.Result;
                        break;
                    }
                    done.Task.Wait(250);
                }

                if (_verifyCancelRequested && (result == null || !result.Ok))
                {
                    return "{\"ok\":false,\"error\":\"cancelled\",\"message\":\"审核已取消\"}";
                }
                if (result == null || !result.Ok || result.Clip == null)
                {
                    _verifyLastError = $"{command}: 现采失败（{(result?.Error ?? "无结果")}）";
                    return "{\"ok\":false,\"error\":\"" + (result?.Error ?? "no result").Replace("\"", "'") + "\"}";
                }
                // frames 取任意骨通道关键帧数（BuildClip 保证各骨同长）；timeout=持续/循环类，
                // 网页侧据此做打断/复位节奏
                var frames = 0;
                foreach (var b in result.Clip.bones.Values)
                    if (b?.q is { Count: > 0 }) { frames = b.q.Count; break; }
                var cmp = ClipCompare.Compare(stored, result.Clip);
                if (cmp.Verdict != "match") _verifyLastError = null; // 偏差是正常报告不是会话错误
                return ClipCompare.VerifyReportJson(command, cmp, frames, result.AvgSampleHz,
                    result.Reason == "timeout", result.Reason);
            }
            finally
            {
                _verifyRunning = false;   // 唯一收尾：完成/取消/超时/异常都从这里离开（exactly-once）
                _verifyCommand = "";
            }
        }
        catch (Exception ex)
        {
            _verifyLastError = ex.Message;
            return "{\"ok\":false,\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}";
        }
        finally
        {
            RecGate.Release();
        }
    }

    /// <summary>GET /export/verifystatus：审核会话在途状态（诊断+网页防双击）。</summary>
    private string HandleVerifyStatus()
    {
        return JsonSerializer.Serialize(new
        {
            running = _verifyRunning,
            command = _verifyCommand,
            startedAgo = _verifyRunning ? Math.Round(RecordTiming.NowSeconds() - _verifyStartedAt, 1) : 0,
            lastError = _verifyLastError
        });
    }


    /// <summary>骨架信息：骨名/父索引/参考姿势（网页渲染线框用）。
    /// 不缓存（2026-08-29 FIX-4 补查）：曾把第一次的结果永久缓存，登录前调过一次
    /// {"error":"no player"} 后，登录角色也永远拿不到骨架（offline-verify online/transition
    /// 卡"真模型就绪"、双采样判动静拿到逐字节相同缓存，都是它）。骨架 JSON 很小，每次现算，
    /// 登录/换角色/换种族立即生效。
    /// FIX-E 线程契约：调度进框架线程执行，只把不可变 JSON 字符串带出。
    /// PLUG-2（FIX-J）：等待加 5 秒上限——旧实现无限等框架线程，游戏线程卡死时 handler
    /// 永久挂起、Dispose 排空陪葬。与 48794 GameThreadJson 同口径：超时 503 明确拒绝。
    /// 返回 null = 响应已自行写完。</summary>
    private async Task<string?> HandleSkeletonAsync(HttpListenerContext ctx)
    {
        try
        {
            var rec = new RecorderServiceSkeletonHelper();
            return await _framework.RunOnFrameworkThread(() => rec.BuildSkeletonJson())
                .WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (TimeoutException)
        {
            _log.Error("skeleton: game thread dispatch timed out (5s)");
            LocalApiSecurity.RespondJson(ctx,
                "{\"error\":\"game thread busy\",\"message\":\"游戏线程忙，请稍后重试\"}", 503);
            return null;
        }
        catch (Exception ex) { return "{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}"; }
    }
    private string GetBatchStatus()
    {
        return JsonSerializer.Serialize(new
        {
            running = _batchRunning,
            done = _batchDone,
            total = _batchTotal,
            remaining = _batchQueue.Count,
            // AUD-017：出错/超时终止后状态页给得出原因，而不是只剩 running=false 无解释
            lastError = _batchLastError
        });
    }


    /// <summary>静态页面服务（dist/ChoreoHelper 目录）。</summary>
    private static string DistDir => Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "..", "dist", "ChoreoHelper");
    private readonly string _webRoot;
    private static string FindWebRoot(string? assemblyDir = null)
    {
        // 插件 DLL 自身目录（devPlugins 部署位）优先 → 游戏目录/项目结构后备；
        // 插件进程寄宿在游戏里，BaseDirectory 是游戏目录，不能当部署位。
        // 游戏进程内 Assembly.Location 为空：显式 assemblyDir 优先（见构造器注释），
        // 未传且取不到时退 BaseDirectory，与 XatClipConverter.ResolveDefaultToolsDir 同口径。
        var asmDir = !string.IsNullOrEmpty(assemblyDir)
            ? assemblyDir!
            : (Path.GetDirectoryName(typeof(ExportServer).Assembly.Location) is { Length: > 0 } loc ? loc : AppContext.BaseDirectory);
        var candidates = new[]
        {
            Path.Combine(asmDir, "dist", "ChoreoHelper"),
            Path.Combine(AppContext.BaseDirectory, "dist", "ChoreoHelper"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "dist", "ChoreoHelper")
        };
        foreach (var c in candidates)
            if (Directory.Exists(c)) return c;
        return candidates[^1];
    }
    private static readonly Dictionary<string, string> MimeTypes = new()
    {
        [".html"] = "text/html; charset=utf-8",
        [".js"] = "application/javascript; charset=utf-8",
        [".mjs"] = "application/javascript; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".gltf"] = "model/gltf",
        [".glb"] = "model/gltf-binary",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".svg"] = "image/svg+xml",
        [".ico"] = "image/x-icon",
        [".wasm"] = "application/wasm",
    };
    private void ServeStatic(HttpListenerContext ctx, string fileName)
    {
        try
        {
            // 只服务 WebRoot 内的文件（防路径穿越），其余一律 404
            if (string.IsNullOrEmpty(fileName) || fileName.Contains(".."))
            { ctx.Response.StatusCode = 400; ctx.Response.Close(); return; }
            var path = Path.GetFullPath(Path.Combine(_webRoot, fileName));
            if (!path.StartsWith(Path.GetFullPath(_webRoot), StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            { ctx.Response.StatusCode = 404; ctx.Response.Close(); return; }
            // SEC-1：个人模型文件要配对码。判定用 GetFullPath 归一化后的文件名（防 /./ 与
            // 大小写绕过，Windows 文件系统大小写不敏感），stand-in 等公共内容不受影响
            if (ReadAuthPolicy.IsPairedModelFile(Path.GetFileName(path))
                && !LocalApiSecurity.CheckToken(ctx.Request, _pairingCode))
            { LocalApiSecurity.PairingRequired(ctx); return; }
            var bytes = File.ReadAllBytes(path);
            ctx.Response.ContentType = MimeTypes.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out var mime)
                ? mime : "application/octet-stream";
            LocalApiSecurity.AddCors(ctx); // v0.6.7：来源允许列表，不再是通配 *
            ctx.Response.Headers.Add("Cache-Control", "no-cache");
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
        }
        catch { try { ctx.Response.Close(); } catch { } }
    }
    public void Dispose()
    {
        // FIX-E（AUD2-010）排空顺序：停接新请求 → 停批量 → 让在途录制等待方立刻解阻塞 →
        // 等在途 handler 到安全点（有限超时，超时记录后继续——绝不无限等）。
        CleanStalePending(); // v0.7.1 FIX-C：关闭时也清一次过期暂存（只删超 24h 的，在途不动）
        try
        {
            _cts?.Cancel();
            _listener?.Close();
        }
        catch { }
        _batchRunning = false;                 // 批量循环跑完当前条即退出，finally 释放实例级 RecGate
        _recorder.CancelPending();             // 单条录制等待方立即拿到结果，不等 30s 超时
        if (!_inFlight.WaitDrained(TimeSpan.FromSeconds(5)))
            _log.Warning("ExportServer drain timeout: {n} handler(s) still in flight", _inFlight.Count);
        try { _cts?.Dispose(); } catch { }
    }
}
