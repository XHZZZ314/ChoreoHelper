using System;

namespace ChoreoHelper;

/// <summary>请求车道：Fast = 本地快速处理器（含停止/seek/状态与自带 5s 上限的游戏线程诊断）；
/// Outbound = 出站歌词（NetEase 外网请求，HttpClient 约 10s 超时）。</summary>
public enum RequestLane { Fast, Outbound }

/// <summary>
/// CORE-HTTP：请求车道分级策略。慢出站（歌词）单独一条车道，其余走快车道——
/// 停止/seek/状态永远不与慢歌词共享并发额度，慢歌词洪峰占满自己车道时只拒歌词本身。
/// 纯函数、无 Dalamud 依赖，datalayertest 直测（同 ReadAuthPolicy 惯例）。
/// </summary>
public static class HttpDispatchPolicy
{
    /// <summary>快车道并发上限。处理器都是毫秒级（POST 变更互斥闸内）或自带 5s 上限
    /// （游戏线程诊断），单用户本地服务下 32 远超实际并发；打满回 503 而不是排队，
    /// 保证停止路径有界。</summary>
    public const int FastMaxConcurrency = 32;

    /// <summary>出站歌词并发上限。超过即拒（上层回 503），不让外网慢请求堆积。</summary>
    public const int OutboundMaxConcurrency = 4;

    /// <summary>GET 的两个歌词端点是仅有的出站慢路径；其余一律快车道。
    /// method 用大写规范形（HttpListener.HttpMethod），Ordinal 比较。</summary>
    public static RequestLane LaneFor(string? method, string? path)
    {
        if (method == "GET" && (path == "/lyrics/search" || path == "/lyrics"))
            return RequestLane.Outbound;
        return RequestLane.Fast;
    }
}
