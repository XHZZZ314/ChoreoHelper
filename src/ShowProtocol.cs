// 这个文件是干嘛的：EXEC-CORE 演出包协议层（纯逻辑，无 Dalamud 依赖，进 datalayertest）。
// 网页 ShowCompiler（web\choreo-show-compiler.js）把规范演出文档（choreo-document.js）
// 一次性编译成演出包上传；插件侧用本文件做形状解析与上限控制，语义校验在 ShowValidator。
// 依据 docs\DESIGN-game-executor.md §3（ShowProtocol: DTO、版本、JSON 校验）、§8（能力握手
// 与会话不可妥协）、§10（先做与游戏无关的纯单测，再接 Dalamud）。
// 严格性口径与 AUD-012 一致：解析失败回中文原因，绝不把畸形包放进执行器。
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace ChoreoHelper;

public static class ShowProtocol
{
    /// <summary>插件支持的演出包协议版本。网页 capabilities 握手里的 shows.protocol 与它对齐。</summary>
    public const int SupportedVersion = 1;

    /// <summary>单包事件数上限：正常编舞几百条动作+歌词；超了基本是异常/恶意包（同 MaxTimelineClips 思路）。</summary>
    public const int MaxEvents = 5000;

    /// <summary>单包演员数上限：8/8/1 裁定（主人 2026-09-05：编辑/排练 8、网页预览 8、X1 前游戏执行 1）之上，
    /// 64 只是防异常包的结构护栏，从未验证为执行规模；当前执行器也只支持一位本地角色。</summary>
    public const int MaxPerformers = 64;

    /// <summary>协议允许的事件类型（与设计文档 §5 轨道类型一致）。</summary>
    public static readonly HashSet<string> Kinds = new(StringComparer.Ordinal)
    { "motion", "ability", "movement", "facing", "cue", "lyrics" };
}

public sealed class ShowPerformer
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class ShowCapability
{
    public string Name { get; set; } = "";
    public int MinProtocol { get; set; } = 1;
}

public sealed class ShowEvent
{
    public string Id { get; set; } = "";
    public string PerformerId { get; set; } = "";
    public string Kind { get; set; } = "";
    public long StartMs { get; set; }
    public long DurationMs { get; set; }
    public string Command { get; set; } = "";
    public string Name { get; set; } = "";
    public string PlayMode { get; set; } = "";
    public X1EventInput? X1 { get; set; }
}

public sealed class ShowPackage
{
    public int ProtocolVersion { get; set; }
    public string Compiler { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public string Name { get; set; } = "";
    public long DurationMs { get; set; }
    public long TimelineRevision { get; set; }
    public string ProjectHash { get; set; } = "";
    public List<ShowPerformer> Performers { get; } = new();
    public List<ShowEvent> Events { get; } = new();
    public List<ShowCapability> Capabilities { get; } = new();
    public X1PackageInput? X1 { get; set; }
}

/// <summary>解析结果：Error 非空 = 拒绝（中文原因，直接回给网页）。</summary>
public sealed class ShowParseResult
{
    public ShowPackage? Package { get; set; }
    public string? Error { get; set; }
}

public static class ShowProtocolParser
{
    /// <summary>从 JSON 元素解析演出包（接受裸包或 {package:{…}} 的内层元素）。
    /// 只做形状/上限/类型校验；能力、执行器、单角色映射等语义在 ShowValidator。</summary>
    public static ShowParseResult Parse(JsonElement el)
    {
        var result = new ShowParseResult();
        try
        {
            if (el.ValueKind != JsonValueKind.Object)
                return Fail(result, "演出包必须是 JSON 对象");

            X1ShowProtocol.RejectDuplicateProperties(el, "演出包");

            var pkg = new ShowPackage();
            // protocolVersion 必须是不小于 1 的整数；超出插件支持版本留给 ShowValidator 给精确文案
            if (!TryGetInt(el, "protocolVersion", out var pv) || pv < 1 || pv > int.MaxValue)
                return Fail(result, "演出包 protocolVersion 必须是不小于 1 的整数");
            pkg.ProtocolVersion = (int)pv;
            pkg.Compiler = TryGetStr(el, "compiler");
            pkg.ProjectId = TryGetStr(el, "projectId");
            pkg.Name = TryGetStr(el, "name");
            if (!TryGetInt(el, "durationMs", out var dur) || dur < 0)
                return Fail(result, "演出包 durationMs 必须是不小于 0 的整数毫秒");
            pkg.DurationMs = dur;
            TryGetInt(el, "timelineRevision", out var rev);
            pkg.TimelineRevision = Math.Max(0, rev);
            pkg.ProjectHash = TryGetStr(el, "projectHash");

            if (el.TryGetProperty("performers", out var performers))
            {
                if (performers.ValueKind != JsonValueKind.Array)
                    return Fail(result, "演出包 performers 必须是数组");
                foreach (var p in performers.EnumerateArray())
                {
                    if (pkg.Performers.Count >= ShowProtocol.MaxPerformers)
                        return Fail(result, "演出包演员数超过上限（" + ShowProtocol.MaxPerformers + "）");
                    if (p.ValueKind != JsonValueKind.Object)
                        return Fail(result, "performers 条目必须是对象");
                    X1ShowProtocol.RejectDuplicateProperties(p, "演员条目");
                    if (el.TryGetProperty("x1", out _))
                        X1ShowProtocol.CheckProperties(p, "X1 演员条目", "id", "name");
                    var id = p.TryGetProperty("id", out var pid) ? pid.GetString() : null;
                    if (string.IsNullOrEmpty(id))
                        return Fail(result, "演员条目缺少非空 id");
                    pkg.Performers.Add(new ShowPerformer
                    {
                        Id = id!,
                        Name = p.TryGetProperty("name", out var pn) ? pn.GetString() ?? "" : "",
                    });
                }
            }

            if (el.TryGetProperty("capabilities", out var caps))
            {
                if (caps.ValueKind != JsonValueKind.Array)
                    return Fail(result, "演出包 capabilities 必须是数组");
                foreach (var c in caps.EnumerateArray())
                {
                    if (c.ValueKind != JsonValueKind.Object)
                        return Fail(result, "capabilities 条目必须是对象");
                    X1ShowProtocol.RejectDuplicateProperties(c, "能力要求");
                    var name = c.TryGetProperty("name", out var cn) ? cn.GetString() : null;
                    if (string.IsNullOrEmpty(name))
                        return Fail(result, "能力要求缺少非空 name");
                    var minProto = 1;
                    if (el.TryGetProperty("x1", out _))
                    {
                        X1ShowProtocol.CheckProperties(c, "X1 能力要求", "name", "minProtocol");
                        if (!TryGetInt(c, "minProtocol", out var strictMin) || strictMin < 1 || strictMin > int.MaxValue)
                            return Fail(result, "X1 能力要求 minProtocol 必须是范围内的显式正整数");
                    }
                    if (c.TryGetProperty("minProtocol", out var mp) && mp.TryGetInt64(out var mpv))
                        minProto = (int)mpv;
                    pkg.Capabilities.Add(new ShowCapability { Name = name!, MinProtocol = minProto });
                }
            }

            if (!el.TryGetProperty("events", out var eventsEl) || eventsEl.ValueKind != JsonValueKind.Array)
                return Fail(result, "演出包缺少 events 数组");
            var seenIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var e in eventsEl.EnumerateArray())
            {
                if (pkg.Events.Count >= ShowProtocol.MaxEvents)
                    return Fail(result, "演出包事件数超过上限（" + ShowProtocol.MaxEvents + " 条）");
                if (e.ValueKind != JsonValueKind.Object)
                    return Fail(result, "events 条目必须是对象");
                X1ShowProtocol.RejectDuplicateProperties(e, "事件");
                var ev = new ShowEvent
                {
                    Id = e.TryGetProperty("id", out var eid) ? eid.GetString() ?? "" : "",
                    PerformerId = e.TryGetProperty("performerId", out var pe) ? pe.GetString() ?? "" : "",
                    Kind = e.TryGetProperty("kind", out var k) ? k.GetString() ?? "" : "",
                    Command = e.TryGetProperty("command", out var cmd) ? cmd.GetString() ?? "" : "",
                    Name = e.TryGetProperty("name", out var nm) ? nm.GetString() ?? "" : "",
                    PlayMode = e.TryGetProperty("playMode", out var pm) ? pm.GetString() ?? "" : "",
                };
                if (string.IsNullOrEmpty(ev.Id))
                    return Fail(result, "事件缺少非空 id");
                if (!seenIds.Add(ev.Id))
                    return Fail(result, "事件 id「" + ev.Id + "」重复");
                if (!ShowProtocol.Kinds.Contains(ev.Kind))
                    return Fail(result, "事件「" + ev.Id + "」的 kind「" + (ev.Kind.Length == 0 ? "(空)" : ev.Kind) + "」不在协议允许范围");
                if (!TryGetInt(e, "startMs", out var st) || st < 0)
                    return Fail(result, "事件「" + ev.Id + "」的 startMs 必须是不小于 0 的整数毫秒");
                ev.StartMs = st;
                if (!TryGetInt(e, "durationMs", out var du) || du < 0)
                    return Fail(result, "事件「" + ev.Id + "」的 durationMs 必须是不小于 0 的整数毫秒");
                ev.DurationMs = du;
                if (e.TryGetProperty("x1", out var x1Event))
                    ev.X1 = X1ShowProtocol.ParseEvent(x1Event, ev.Kind, ev.DurationMs);
                if (ev.X1 != null || el.TryGetProperty("x1", out _))
                    X1ShowProtocol.CheckProperties(e, "X1 事件", "id", "performerId", "kind", "startMs", "durationMs", "command", "name", "playMode", "x1");
                pkg.Events.Add(ev);
            }

            if (el.TryGetProperty("x1", out var x1Package))
            {
                X1ShowProtocol.CheckProperties(el, "X1 演出包", "protocolVersion", "compiler", "projectId", "name", "durationMs", "timelineRevision", "projectHash", "performers", "events", "capabilities", "x1");
                pkg.X1 = X1ShowProtocol.ParsePackage(x1Package);
            }
            var x1Shape = X1ShowProtocol.ValidateWireEnvelope(pkg);
            if (!x1Shape.Ok) return Fail(result, x1Shape.Error);

            result.Package = pkg;
            return result;
        }
        catch (Exception ex)
        {
            return Fail(result, "演出包解析失败：" + ex.Message);
        }
    }

    private static ShowParseResult Fail(ShowParseResult r, string message)
    {
        r.Error = message;
        return r;
    }

    /// <summary>取整数字段：缺失返回 false；带小数（1.5）的数字 TryGetInt64 会失败——
    /// 协议时间必须是整数毫秒，小数一律拒绝（网页编译器负责四舍五入）。</summary>
    private static bool TryGetInt(JsonElement obj, string name, out long value)
    {
        value = 0;
        return obj.TryGetProperty(name, out var el) && el.TryGetInt64(out value);
    }

    private static string TryGetStr(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() ?? "" : "";
}
