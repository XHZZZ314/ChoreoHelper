using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;

namespace ChoreoHelper;

/// <summary>
/// v0.6.7 本地 API 安全公共件：48794/48795 两个本地端口共用的
/// CORS 允许列表、OPTIONS 预检零副作用拦截、写接口配对码校验和请求体上限。
/// 规矩：OPTIONS 永远不进业务逻辑；写操作（POST / debug/poke）必须带配对头；
/// 来源不在允许列表的预检直接 403，浏览器就不会把真正的写请求发出来。
/// </summary>
internal static class LocalApiSecurity
{
    /// <summary>写接口的配对头名。网页设置里粘贴配对码后所有写请求都带它。</summary>
    public const string TokenHeader = "X-Choreo-Token";

    /// <summary>协议版本：网页与插件握手时对比，不匹配就提示升级。改动接口语义必须 +1。</summary>
    public const int ProtocolVersion = 1;

    // 允许的网页来源：
    // "null" = file:// 本地双击入口（file:// 页面浏览器发 Origin: null）；
    // 48795 = 插件自己 http 服务的页面；48796 = 临时开发服；48797 = 验收 mock；
    // 正式 GitHub Pages origin 已定稿（v0.7.1 公开试用，见 PublicSiteOrigin）
    private static readonly string[] AllowedOrigins =
    {
        "null",
        "http://localhost:48795",
        "http://127.0.0.1:48795",
        "http://localhost:48796",
        "http://localhost:48797",
    };

    /// <summary>正式公开站点 origin（https://…）。已定稿：v0.7.1 公开试用站
    /// （GitHub 用户页仓库 XHZZZ314.github.io，主人 2026-09-02 提供）。
    /// 仍是静态字段：datalayertest 可临时赋值验证放行逻辑（验完必须恢复本常量）。</summary>
    public static string PublicSiteOrigin = "https://xhzzz314.github.io";

    /// <summary>无 Origin 头（curl / 同源请求）不算跨源，放行。</summary>
    public static bool IsOriginAllowed(string? origin)
    {
        if (string.IsNullOrEmpty(origin)) return true;
        if (origin == PublicSiteOrigin && PublicSiteOrigin.Length > 0) return true;
        return Array.IndexOf(AllowedOrigins, origin) >= 0;
    }

    /// <summary>按请求来源加 CORS 响应头：来源允许才加（回显具体 origin），不允许就不加——
    /// 浏览器读不到响应即拦截；写操作另有配对码兜底。</summary>
    public static void AddCors(HttpListenerContext ctx)
    {
        var origin = ctx.Request.Headers["Origin"];
        if (string.IsNullOrEmpty(origin)) return; // 同源/curl 不需要 CORS 头
        if (!IsOriginAllowed(origin)) return;
        ctx.Response.Headers.Add("Access-Control-Allow-Origin", origin);
        ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ctx.Response.Headers.Add("Access-Control-Allow-Headers", $"Content-Type, {TokenHeader}");
        // Chrome 137+ 强制 Private Network Access 预检：公网页面调 localhost 缺此头会被静默拦截
        ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true");
    }

    /// <summary>OPTIONS 预检：一律零副作用（曾经 48795 的 OPTIONS 会落进业务逻辑，
    /// 预检打 /export/walkreset 会真的触发角色移动）。来源不允许 → 403，预检失败，
    /// 浏览器连真正的请求都不会发。</summary>
    public static void HandlePreflight(HttpListenerContext ctx)
    {
        var origin = ctx.Request.Headers["Origin"];
        if (!IsOriginAllowed(origin))
        {
            ctx.Response.StatusCode = 403;
            ctx.Response.Close();
            return;
        }
        ctx.Response.StatusCode = 204;
        AddCors(ctx);
        ctx.Response.Headers.Add("Access-Control-Max-Age", "600");
        ctx.Response.Close();
    }

    /// <summary>写接口配对码校验。空码一律拒绝（fail-closed，2026-08-31 审计 P1：旧实现对空码
    /// 放行是防御性死分支——PairingStore.LoadOrCreate 所有路径都返回非空码；既然生产上到不了，
    /// 空码就意味着构造缺陷，缺陷侧必须安全）。加载失败的锁死风险由 PairingStore 的
    /// ephemeral 兜底码承担，不在这里放行。</summary>
    // era-reconciliation ports (donor: r2-preserved LocalApiSecurity.cs).
    public const string SessionAuthPath = "/auth/session";
    public static bool CheckWriteToken(HttpListenerRequest req, string pairingCode)
        => TokenMatches(req.Headers[TokenHeader], pairingCode)
        || SessionTokenStore.Validate(req.Headers[TokenHeader], pairingCode);

    /// <summary>会话签发：需配对码一致；返回 32 位内存令牌并绑定当前配对码。</summary>
    public static string MintSessionToken(string pairingCode)
        => SessionTokenStore.Mint(pairingCode);

    /// <summary>会话令牌响应体（字段名 token，令牌只走响应体，不进 URL/日志/toast）。</summary>
    public static string SessionTokenJson(string token)
        => JsonSerializer.Serialize(new { token });

    public static bool CheckToken(HttpListenerRequest req, string pairingCode)
        => TokenMatches(req.Headers[TokenHeader], pairingCode);

    /// <summary>配对判定纯函数（datalayertest 直测）：码非空且与请求头完全一致才放行。</summary>
    public static bool TokenMatches(string? headerValue, string pairingCode)
        => !string.IsNullOrEmpty(pairingCode) && headerValue == pairingCode;

    /// <summary>405：路径存在但方法不对。带 Allow 头告诉调用方该用什么方法。</summary>
    public static void MethodNotAllowed(HttpListenerContext ctx, string allow)
    {
        ctx.Response.StatusCode = 405;
        ctx.Response.Headers.Add("Allow", allow);
        RespondJson(ctx, "{\"error\":\"method not allowed\",\"allow\":\"" + allow + "\"}", 405);
    }

    /// <summary>统一 JSON 响应（带 CORS 与状态码）。
    /// FIX-J 实机自测发现：HttpListener 拒绝对 HEAD 响应写实体 body（写入即抛异常，
    /// 被兜底 catch 统一变 500）——两个端口所有带响应体的 HEAD 一直如此，405 文案里
    /// 宣传的 "GET, HEAD" 名不副实。HEAD 语义是"只要头不要体"：保留 Content-Length 头、
    /// 跳过写 body，状态码/CORS 与 GET 完全一致。</summary>
    public static void RespondJson(HttpListenerContext ctx, string json, int status = 200)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        AddCors(ctx);
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.ContentLength64 = bytes.Length;
        if (!string.Equals(ctx.Request.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase))
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
        ctx.Response.Close();
    }

    /// <summary>配对失败统一回 403 + 大白话提示（网页原样弹给主人看）。</summary>
    public static void PairingRequired(HttpListenerContext ctx)
    {
        RespondJson(ctx,
            "{\"error\":\"pairing required\",\"message\":\"需要配对：游戏里输入 /choreo pair 查看配对码，粘贴到网页的「高级 → 网页配对」里（一个浏览器只需一次）\"}",
            403);
    }

    /// <summary>读请求体并限制大小；超限返回 null（调用方回 413）。
    /// v0.7.1 加固（AUD-011）：①循环读到 EOF——网络流上单次 Read 可能提前返回少量字符，
    /// 会把请求体截断；②按 UTF-8 字节计数而不是字符数——多字节中文按字符数会低估实际字节；
    /// ③声明了 Content-Length 和 chunked（无长度）两条路径统一走同一循环，chunked 也限得住。</summary>
    public static string? ReadBodyLimited(HttpListenerRequest req, int maxBytes)
    {
        if (req.ContentLength64 > maxBytes) return null;
        using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
        var buf = new char[8192];
        long totalBytes = 0;
        var sb = new StringBuilder();
        int n;
        while ((n = reader.Read(buf, 0, buf.Length)) > 0)
        {
            totalBytes += Encoding.UTF8.GetByteCount(buf, 0, n);
            if (totalBytes > maxBytes) return null;
            sb.Append(buf, 0, n);
        }
        return sb.ToString();
    }

    /// <summary>能力握手：两端口同路径 /capabilities，网页靠它识别插件版本、协议与配对能力。
    /// 老（≤0.6.6）插件没有这个端点，网页探到 404 就走兼容模式（写请求不带配对头）。
    /// EXEC-CORE：新增 shows 段（演出包协议版本/支持的事件执行器/事件上限），网页编译器
    /// 据此决定能否装载演出；属公开元数据，保持匿名可读（SEC-1 口径）。</summary>
    public static string CapabilitiesJson()
    {
        var ver = typeof(LocalApiSecurity).Assembly.GetName().Version?.ToString(3) ?? "?";
        return JsonSerializer.Serialize(new
        {
            app = "ChoreoHelper",
            version = ver,
            protocolVersion = ProtocolVersion,
            pairing = true,
            capabilities = new[]
            {
                "playback", "seek", "freeze", "recording", "clip-commit", "walkreset",
                "gpose", "library-sync", "capabilities", "shows"
            },
            shows = new
            {
                protocol = ShowProtocol.SupportedVersion,
                executors = new[] { "motion", "cue", "lyrics" },
                maxEvents = ShowProtocol.MaxEvents,
            }
        });
    }
}
