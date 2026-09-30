using System;
using System.Collections.Generic;
using System.Text.Json;

namespace ChoreoHelper;

/// <summary>
/// ARCH2（TASK-20260901）：48794 播放通道的路由分级与请求校验策略。纯函数、无 Dalamud 依赖，
/// datalayertest 直测（同 ReadAuthPolicy/HttpDispatchPolicy 惯例）。端点存在性、方法白名单
/// （405/404 判定）、POST 请求体与时间轴负载校验、错误响应字节形状都收口在这里；HttpServer
/// 只保留传输职责（OPTIONS 预检/配对鉴权/CORS/序列化/委托），保证重构后线上行为逐字节不变。
/// </summary>
public static class PlaybackApiPolicy
{
    // v0.6.7：POST 请求体上限（/playback/start 会带整条时间轴，264 条动作也就几十 KB，4MB 绰绰有余）
    public const int MaxPostBodyBytes = 4 * 1024 * 1024;

    // /playback/start 的时间轴条数上限：正常编舞几百条，超了基本是异常/恶意包
    public const int MaxTimelineClips = 2000;

    /// <summary>GET 只读端点白名单（含诊断与演出状态）。路径存在但方法不对回 405。
    /// 与旧 HttpServer 集合同口径：OrdinalIgnoreCase。</summary>
    private static readonly HashSet<string> GetEndpoints = new(StringComparer.OrdinalIgnoreCase)
    {
        "/", "/health", "/actions", "/actions/emotes", "/actions/emote-durations",
        "/actions/measured-durations", "/actions/races", "/dancers", "/classjobs",
        "/version", "/capabilities", "/playback/status", "/settings/engine",
        "/gpose/state", "/lyrics/search", "/lyrics",
        "/debug/animstate", "/debug/diag", "/debug/tlinfo", "/debug/poke",
        "/debug/emotefamily",
        ShowApiPolicy.StatusPath,
        "/shows/clock", "/x1/status",
        // v0.7.1 FIX-A（AUD2-002）：/debug/boneprobe 已从生产端点删除——它免配对、GET、
        // 还能经 unsafe 指针直写本地角色骨骼四元数。调试需要时按审计文档在开发构建里单独加闸门。
    };

    /// <summary>POST 写端点白名单（v0.6.7 起：POST 一律写操作，先过配对码）。</summary>
    private static readonly HashSet<string> PostEndpoints = new(StringComparer.OrdinalIgnoreCase)
    {
        "/preview", "/playback/start", "/playback/timeline", "/playback/seek", "/playback/freeze", "/playback/stop",
        "/gpose/toggle", "/settings/engine",
        ShowApiPolicy.ValidatePath, ShowApiPolicy.LoadPath, ShowApiPolicy.ArmPath,
        ShowApiPolicy.StartPath, ShowApiPolicy.StopPath,
        "/shows/arm-owned", "/shows/schedule", "/shows/stop-owned",
    };

    /// <summary>GET/HEAD 可读端点（配对分级另看 ReadAuthPolicy.IsPairedPlayRead）。</summary>
    public static bool IsReadEndpoint(string? path) => path != null && GetEndpoints.Contains(path);

    /// <summary>POST 可写端点。</summary>
    public static bool IsWriteEndpoint(string? path) => path != null && PostEndpoints.Contains(path);

    /// <summary>POST 落在只读端点上 → 405 的 Allow 头值；两用端点与未知路径返回 null
    /// （两用端点照常进闸分发，未知路径闸后回 404）。</summary>
    public static string? PostWrongMethodAllow(string? path)
        => !IsWriteEndpoint(path) && IsReadEndpoint(path) ? "GET, HEAD" : null;

    /// <summary>GET/HEAD/POST 之外的怪方法（PUT/DELETE…）不进任何业务逻辑：
    /// 路径认得返回 405 的 Allow 值，认不得返回 null（裸 404）。</summary>
    public static string? OtherMethodAllow(string? path)
    {
        if (IsReadEndpoint(path)) return "GET, HEAD";
        if (IsWriteEndpoint(path)) return "POST";
        return null;
    }

    // ---- 统一错误响应字节形状（400/404/409/413/500 逐字节契约，datalayertest 锁定）----

    /// <summary>统一 4xx/5xx 拒绝：状态码 + 逐字节响应体 + 可选日志细节（不含明文命令内容）。</summary>
    public readonly record struct RequestRejection(int Status, string Json, string? DebugDetail);

    public const string BodyTooLargeJson = "{\"error\":\"request body too large\",\"message\":\"请求体超过上限（4MB）\"}";
    public const string BodyUnreadableJson = "{\"error\":\"request body unreadable\"}";
    public const string InternalErrorJson = "{\"error\":\"internal error\"}";
    public const string GameThreadBusyJson = "{\"error\":\"game thread busy\",\"message\":\"游戏线程忙，请稍后重试\"}";

    // 依赖缺失 503（插件初始化未完成的统一口径）
    public const string NoPlaybackJson = "{\"error\":\"no playback\",\"message\":\"播放管理器不可用（插件初始化未完成）\"}";
    public const string NoFreezerJson = "{\"error\":\"no freezer\",\"message\":\"定格器不可用（插件初始化未完成）\"}";
    public const string NoPreviewerJson = "{\"error\":\"previewer not available\",\"message\":\"预览器不可用（插件初始化未完成）\"}";

    // 负载校验 400 与播放状态 409
    public const string PreviewCommandRequiredJson = "{\"error\":\"invalid body\",\"message\":\"/preview 需要 command 字段\"}";
    public const string ClipsMustBeArrayJson = "{\"error\":\"invalid clips\",\"message\":\"clips 必须是数组\"}";
    public const string ClipFieldsIncompleteJson = "{\"error\":\"invalid clips\",\"message\":\"动作条字段不完整：每条需要 id/start/duration\"}";
    public const string EmptyTimelineJson = "{\"error\":\"empty timeline\",\"message\":\"时间轴为空：没有可播放的动作条\"}";
    public const string StartPlayingConflictJson = "{\"error\":\"playing\",\"message\":\"正在播放：先停止（/playback/stop）再开始新时间轴\"}";
    public const string TimelinePlayingConflictJson = "{\"error\":\"playing\",\"message\":\"正在播放：时间轴替换被拒绝，先停止再推送\"}";
    public const string CannotStartJson = "{\"error\":\"cannot start\",\"message\":\"无法开始播放（时间轴为空或播放器忙）\"}";
    public const string StaleTimelineJson = "{\"error\":\"stale timeline\",\"message\":\"网页时间轴与插件不同步（修订号过期），网页会自动重新同步后重试\"}";

    /// <summary>命令不过安全策略的 400（what = 前缀文案，如「预览」「定格」）。</summary>
    public static string InvalidCommandJson(string what, string reason) =>
        "{\"error\":\"invalid command\",\"message\":\"" + what + "命令不合格：" + reason + "\"}";

    /// <summary>解析请求体 JSON（AUD-012：失败 400 稳定形状，message 带端点名）。
    /// 返回 false 时 doc 为 null，rejection 携带 400 响应与 Debug 日志细节。</summary>
    public static bool TryParseBodyJson(string body, string endpoint, out JsonDocument? doc, out RequestRejection? rejection)
    {
        try
        {
            doc = JsonDocument.Parse(body);
            rejection = null;
            return true;
        }
        catch (Exception ex)
        {
            doc = null;
            rejection = new RequestRejection(400, JsonSerializer.Serialize(new
            {
                error = "invalid body",
                message = endpoint + " 的请求体必须是合法 JSON"
            }), ex.Message);
            return false;
        }
    }

    /// <summary>解析后的时间轴条目。策略件保持无 Dalamud 依赖，而 PlaybackClip 宿主在
    /// PlaybackManager.cs（Dalamud 工程）——传输层拿到本 DTO 后做逐字段映射。</summary>
    public sealed record ClipSpec(int Id, int ActorId, float Start, float Duration, string Command, string Type, string Name);

    /// <summary>解析并校验时间轴条目（AUD2-005/AUD2-003）：每条命令过 ChatCommandPolicy，
    /// 条数超上限、命令不合格、混入多位舞者都回 400。字段缺省/类型错误按旧实现原样抛出
    /// （KeyNotFoundException 等，由 /playback/start、/playback/timeline 的统一 catch 回 400）。
    /// FIX-B 实机回归口径（2026-08-30）：空命令的歌词条放行（importLyrics 生成的全局歌词
    /// 本来就不可执行），非空命令仍一律过策略闸。</summary>
    public static List<ClipSpec>? ParseClips(JsonElement clipsEl, out RequestRejection? rejection)
    {
        rejection = null;
        var clips = new List<ClipSpec>();
        foreach (var c in clipsEl.EnumerateArray())
        {
            if (clips.Count >= MaxTimelineClips)
            {
                rejection = new RequestRejection(400,
                    "{\"error\":\"too many clips\",\"message\":\"时间轴动作条超过上限（" + MaxTimelineClips + " 条）\"}", null);
                return null;
            }
            // 字段读取顺序与旧实现一致（id 先于其余字段，actorId 最后）——字段缺失/类型错误
            // 抛出的异常类型决定上层回 400 还是 500，必须逐一对齐
            var spec = new ClipSpec(
                Id: c.GetProperty("id").GetInt32(),
                Start: c.GetProperty("start").GetSingle(),
                Duration: c.GetProperty("duration").GetSingle(),
                Command: c.TryGetProperty("command", out var cmd) ? cmd.GetString() ?? "" : "",
                Type: c.TryGetProperty("type", out var tp) ? tp.GetString() ?? "" : "",
                Name: c.TryGetProperty("name", out var nm) ? nm.GetString() ?? "" : "",
                ActorId: c.TryGetProperty("actorId", out var ac) && ac.TryGetInt32(out var acv) ? acv : 0);
            var skipEmptyLyric = spec.Type == "lyric" && string.IsNullOrEmpty(spec.Command);
            if (!skipEmptyLyric && !ChatCommandPolicy.TryValidate(spec.Command, out var reason))
            {
                rejection = new RequestRejection(400,
                    "{\"error\":\"invalid command\",\"message\":\"第 " + (clips.Count + 1) + " 条（" + spec.Name + "）命令不合格：" + reason + "\"}",
                    $"clip {spec.Id} command rejected: {reason}");
                return null;
            }
            clips.Add(spec);
        }
        // ACTOR（2026-08-31）：当前游戏内只有一位本地角色，混入多位舞者的 payload 会把所有人的
        // 事件执行在同一个角色上。start/timeline 两端点共用本解析口，这里统一拒绝（400 带指路文案）。
        var actorIds = new List<int>(clips.Count);
        foreach (var c in clips) actorIds.Add(c.ActorId);
        var actorError = PreviewActorPolicy.Validate(actorIds);
        if (actorError != null)
        {
            rejection = new RequestRejection(400,
                "{\"error\":\"multi-actor timeline\",\"message\":\"" + actorError + "\"}",
                $"multi-actor timeline rejected ({clips.Count} clips)");
            return null;
        }
        return clips;
    }
}
