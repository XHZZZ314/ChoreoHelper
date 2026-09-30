using System;
using System.Collections.Generic;
using System.Text.Json;

namespace ChoreoHelper.Exporter;

/// <summary>
/// ARCH2（TASK-20260901）：48795 录制/导出通道的路由分级与请求校验策略。纯函数、
/// 无 Dalamud 依赖，datalayertest 直测。/export/* 方法白名单（404/405 判定）、静态页映射、
/// 请求体字段容错解析（坏/缺体按缺省继续，由端点回 command required 等既有口径）、
/// 413/404 响应字节形状都收口在这里；ExportServer 只做 OPTIONS 预检、配对鉴权、
/// 单录制会话闸（RecGate 互斥，语义与获取顺序原样保留）与委托。单会话约束不变：
/// 同一时刻只允许一条录制，批量与审核互斥。
/// </summary>
public static class ExportApiPolicy
{
    // v0.6.7：/export/clip 的请求体只是一个小 JSON（command+save），64KB 足够
    public const int MaxPostBodyBytes = 64 * 1024;

    public const string UnknownEndpointJson = "{\"error\":\"unknown endpoint\"}";
    public const string BodyTooLargeJson = "{\"error\":\"request body too large\",\"message\":\"请求体超过上限（64KB）\"}";

    /// <summary>/export/* 方法白名单：GET 只读（列表/骨架/单条数据/诊断），POST 写操作
    /// （录制/复位/批量/审核）。大小写敏感（与旧 switch 同口径）；未知路径返回 null（上层 404）。</summary>
    private static readonly Dictionary<string, string> AllowedMethods = new(StringComparer.Ordinal)
    {
        ["/export/progress"] = "GET",
        ["/export/recstate"] = "GET",
        ["/export/list"] = "GET",
        ["/export/batchstatus"] = "GET",
        ["/export/getclip"] = "GET",
        ["/export/skeleton"] = "GET",
        ["/export/verifystatus"] = "GET",
        ["/export/clip"] = "POST",
        ["/export/clip/commit"] = "POST",
        ["/export/clip/cancel"] = "POST",
        ["/export/batch"] = "POST",
        ["/export/batchcancel"] = "POST",
        ["/export/walkreset"] = "POST",
        ["/export/verify"] = "POST",
    };

    public static string? AllowedMethodFor(string? path)
        => path != null && AllowedMethods.TryGetValue(path, out var m) ? m : null;

    /// <summary>非 /export/ 路径按静态资源处理（只许 GET，上层判定）：/ 与 /viewer 是固定
    /// 页面，其余按 WebRoot 下相对文件名服务（不存在的文件由文件服务回 404）。</summary>
    public static string StaticFileNameFor(string path)
        => path == "/" ? "choreo-helper-app.html"
         : path == "/viewer" ? "pose-viewer.html"
         : path.TrimStart('/');

    // ---- 请求体字段容错解析（旧口径：坏/缺体吞掉异常按缺省继续，端点自己回缺字段错误）----
    // 注意字段读取顺序与旧 handler 一致：解析中途抛出的异常让已读字段作废、整体回缺省。

    /// <summary>/export/clip 的 {command, save}。</summary>
    public static (string Command, bool Save) ParseClipBody(string? body)
    {
        var command = ""; var save = false;
        try
        {
            if (!string.IsNullOrEmpty(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("command", out var cmd)) command = cmd.GetString() ?? "";
                if (doc.RootElement.TryGetProperty("save", out var sv)) save = sv.GetBoolean();
            }
        }
        catch { }
        return (command, save);
    }

    /// <summary>/export/clip/commit 的 {recordingId, name}。</summary>
    public static (string RecordingId, string Name) ParseCommitBody(string? body)
    {
        var recId = ""; var name = "";
        try
        {
            if (!string.IsNullOrEmpty(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("recordingId", out var rid)) recId = rid.GetString() ?? "";
                if (doc.RootElement.TryGetProperty("name", out var nm)) name = nm.GetString() ?? "";
            }
        }
        catch { }
        return (recId, name);
    }

    /// <summary>/export/clip/cancel 的 {recordingId}。</summary>
    public static string ParseCancelBody(string? body)
    {
        var recId = "";
        try
        {
            if (!string.IsNullOrEmpty(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("recordingId", out var rid)) recId = rid.GetString() ?? "";
            }
        }
        catch { }
        return recId;
    }

    /// <summary>/export/batch 的 {commands:[…]}；坏体/缺体/非数组 → 空清单（端点回 commands required）。</summary>
    public static List<string> ParseBatchCommands(string? body)
    {
        var commands = new List<string>();
        try
        {
            if (!string.IsNullOrEmpty(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("commands", out var arr))
                    foreach (var c in arr.EnumerateArray()) commands.Add(c.GetString() ?? "");
            }
        }
        catch { }
        return commands;
    }

    /// <summary>/export/verify 的 {command}。</summary>
    public static string ParseVerifyBody(string? body)
    {
        var command = "";
        try
        {
            if (!string.IsNullOrEmpty(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("command", out var cmd)) command = cmd.GetString() ?? "";
            }
        }
        catch { }
        return command;
    }
}
