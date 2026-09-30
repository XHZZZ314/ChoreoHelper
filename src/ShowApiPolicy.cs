using System.Text.Json;

namespace ChoreoHelper;

/// <summary>
/// ARCH2（TASK-20260901）：48794 演出执行端点（/shows/*）的请求校验与响应整形策略。
/// 纯函数、无 Dalamud 依赖，datalayertest 直测。路径清单、包元素提取（{package:{…}} 或裸包
/// 两种形状）、倒计时解析、校验失败/状态冲突的响应字节形状收口在这里；HttpServer 只做
/// 配对鉴权、POST 闸与委托，状态机判定仍在 ShowRunner（409 语义不变）。EXEC-CORE 设计
/// 文档 §8：能力握手、显式开始（只收 Armed）、幂等停止、方法白名单都是硬规矩。
/// </summary>
public static class ShowApiPolicy
{
    // 与 HttpServer.JsonOptions 同口径（DefaultIgnoreCondition.WhenWritingNull）：
    // message/issues 为 null 时字段整个省略，响应字节与旧实现逐字节一致
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public const string ValidatePath = "/shows/validate";
    public const string LoadPath = "/shows/load";
    public const string ArmPath = "/shows/arm";
    public const string StartPath = "/shows/start";
    public const string StopPath = "/shows/stop";
    public const string StatusPath = "/shows/status";

    /// <summary>依赖缺失 503（插件初始化未完成的统一口径）。</summary>
    public const string NoRunnerJson = "{\"error\":\"no show runner\",\"message\":\"演出执行器不可用（插件初始化未完成）\"}";

    /// <summary>从请求体取演出包元素：接受 {package:{…}} 或裸包两种形状。</summary>
    public static JsonElement PackageElement(JsonDocument doc)
        => doc.RootElement.TryGetProperty("package", out var p) ? p : doc.RootElement;

    /// <summary>包解析失败 → 400（稳定字节形状；parseError 为解析器给出的中文原因）。</summary>
    public static string InvalidShowJson(string? parseError) => JsonSerializer.Serialize(new
    {
        error = "invalid show",
        message = parseError ?? "演出包无效"
    }, JsonOptions);

    /// <summary>校验不过 → 400 带问题清单。</summary>
    public static string LoadRejectedJson(ShowValidation v) => JsonSerializer.Serialize(new
    {
        error = "show rejected",
        message = v.FirstError,
        issues = v.Issues
    }, JsonOptions);

    /// <summary>状态机不允许 → 409（message 来自 ShowRunner 的中文原因）。</summary>
    public static string StateConflictJson(string? message) => JsonSerializer.Serialize(new { error = "state", message }, JsonOptions);

    /// <summary>/shows/start 倒计时解析：缺体/空体 → 默认值（DefaultCountdownMs）；
    /// 带 countdownMs 且可解析 → 采用；坏 JSON → 400（与其它端点同一稳定形状）。
    /// 返回 false 时 rejection 已就绪，调用方直接回写。</summary>
    public static bool TryGetCountdownMs(string? body, out int countdownMs, out PlaybackApiPolicy.RequestRejection? rejection)
    {
        countdownMs = ShowRunner.DefaultCountdownMs;
        rejection = null;
        if (string.IsNullOrWhiteSpace(body)) return true;
        if (!PlaybackApiPolicy.TryParseBodyJson(body, StartPath, out var data, out rejection)) return false;
        using (data)
        {
            if (data!.RootElement.TryGetProperty("countdownMs", out var cd) && cd.TryGetInt32(out var cdv))
                countdownMs = cdv;
        }
        return true;
    }
}
