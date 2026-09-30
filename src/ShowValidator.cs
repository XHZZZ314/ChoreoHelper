// 这个文件是干嘛的：EXEC-CORE 插件侧演出包二次校验（纯策略，无 Dalamud 依赖，进 datalayertest）。
// 网页编译/体检不能被信任（设计文档 §13「After loading a show package, the plugin must run
// its own runtime checks; never trust only the web compile result」）。装载/校验前插件自己复查：
// 协议版本、能力要求、整包 X1 输入、单角色映射与命令安全；只读准备和实际执行准入分开。
// ValidateForPreparation 允许完整 X1 包进入原子登记准备，实际执行仍须框架线程前置条件。
// 校验失败给中文 issue，HTTP 层把第一条 error 回给网页；没有游戏写入的拒绝不需要停止。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class ShowIssue
{
    public string Level { get; set; } = "error"; // error | warning
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
}

public sealed class ShowValidation
{
    public bool Ok { get; set; }
    public List<ShowIssue> Issues { get; } = new();
    /// <summary>第一条 error 的中文原因（没有 error 时为 null）——HTTP 400 直接带它。</summary>
    public string? FirstError { get; set; }
}

public static class ShowValidator
{
    /// <summary>插件当前真正具备的执行器。能力要求出现表外名字时按设计文档 §8 走能力握手拒绝。</summary>
    public static readonly HashSet<string> SupportedExecutors = new(StringComparer.Ordinal)
    { "motion", "cue", "lyrics" };

    /// <summary>插件认识但不支持的能力要求：出现在包里 = 需要本机没有的执行器，拒绝并指路。</summary>
    private static readonly HashSet<string> KnownUnsupportedCapabilities = new(StringComparer.Ordinal)
    { "movement-control", "ability-execution" };

    /// <summary>所有会驱动角色的事件必须同属本地演员，包括混合包里的旧动作。</summary>
    private static bool DrivesCharacter(string kind) => kind == "motion" || X1ShowProtocol.IsX1Kind(kind);

    public static ShowValidation Validate(ShowPackage pkg)
        => ValidateCore(pkg, false, true);

    /// <summary>完整输入的只读准备准入；不证明真实按键、技能七条件或游戏执行资格。</summary>
    public static ShowValidation ValidateForPreparation(ShowPackage pkg, bool ownsMovementFacing = true)
        => ValidateCore(pkg, true, ownsMovementFacing);

    private static ShowValidation ValidateCore(ShowPackage pkg, bool allowX1Preparation, bool ownsMovementFacing)
    {
        var v = new ShowValidation();
        void Err(string code, string msg)
        {
            v.Issues.Add(new ShowIssue { Level = "error", Code = code, Message = msg });
            v.FirstError ??= msg;
        }
        void Warn(string code, string msg) => v.Issues.Add(new ShowIssue { Level = "warning", Code = code, Message = msg });

        if (pkg == null)
        {
            Err("E_NULL", "演出包为空");
            v.Ok = false;
            return v;
        }

        if (pkg.ProtocolVersion > ShowProtocol.SupportedVersion)
            Err("E_PROTOCOL_NEW", "演出包协议版本（" + pkg.ProtocolVersion + "）比插件支持的（" +
                ShowProtocol.SupportedVersion + "）新：请升级游戏内插件后再执行");
        if (pkg.ProtocolVersion < 1)
            Err("E_PROTOCOL_INVALID", "演出包协议版本必须是正整数");

        var x1Envelope = X1ShowProtocol.ValidateWireEnvelope(pkg);
        if (!x1Envelope.Ok) Err("E_X1_INPUT", x1Envelope.Error);
        var preparesX1 = allowX1Preparation && pkg.X1 != null && x1Envelope.Ok;
        if (preparesX1)
        {
            var x1Package = X1ShowProtocol.ValidatePackage(pkg, ownsMovementFacing);
            if (!x1Package.Ok) Err("E_X1_PREPARATION", x1Package.Error);
        }
        if (pkg.X1 != null && !allowX1Preparation)
            Err("E_X1_EXECUTION_PRECONDITION", "X1 输入须先完整准备并在游戏框架线程原子登记；执行仍需真实前置条件");

        // 能力握手：包声明的能力要求必须被插件支持
        var seenCapabilities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var cap in pkg.Capabilities)
        {
            if (preparesX1 && (!seenCapabilities.Add(cap.Name) || cap.MinProtocol < 1))
                Err("E_CAPABILITY_INVALID", "X1 能力要求重复或版本无效：" + cap.Name);
            if (KnownUnsupportedCapabilities.Contains(cap.Name) && !preparesX1)
                Err("E_CAPABILITY_UNSUPPORTED", "演出要求能力「" + cap.Name + "」，当前插件还没有该执行器" +
                    (cap.Name == "movement-control" ? "（舞台移动执行器未实装）" : "（技能执行器未实装）") +
                    "：请从演出里去掉相关轨道，或等待后续版本");
            else if (preparesX1 && (KnownUnsupportedCapabilities.Contains(cap.Name) || cap.Name == X1ShowProtocol.Capability))
            {
                if (cap.MinProtocol > ShowProtocol.SupportedVersion)
                    Err("E_CAPABILITY_PROTOCOL", "X1 能力「" + cap.Name + "」要求不支持的协议版本");
            }
            else if (!SupportedExecutors.Contains(cap.Name) &&
                     cap.Name != "web-3d-preview" && cap.Name != "game-preview")
            {
                if (preparesX1) Err("E_CAPABILITY_UNKNOWN", "X1 演出要求未知能力「" + cap.Name + "」，不能忽略");
                else Warn("W_CAPABILITY_UNKNOWN", "未识别的能力要求「" + cap.Name + "」，已忽略");
            }
            else if (cap.MinProtocol > ShowProtocol.SupportedVersion)
                Err("E_CAPABILITY_PROTOCOL", "能力「" + cap.Name + "」要求协议 ≥ " + cap.MinProtocol +
                    "，插件只支持 " + ShowProtocol.SupportedVersion);
        }

        // 事件类型支持面：不支持的一律拒绝（unsupported requirement → 在执行前安全拦下）
        var unsupportedCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var ev in pkg.Events)
        {
            if (!SupportedExecutors.Contains(ev.Kind) && !(preparesX1 && X1ShowProtocol.IsX1Kind(ev.Kind)))
            {
                unsupportedCounts.TryGetValue(ev.Kind, out var n);
                unsupportedCounts[ev.Kind] = n + 1;
            }
        }
        foreach (var kv in unsupportedCounts)
            Err("E_KIND_UNSUPPORTED", "演出包含 " + kv.Value + " 条「" + kv.Key + "」事件，当前插件没有该执行器" +
                (kv.Key == "movement" || kv.Key == "facing" ? "（舞台移动/朝向执行器未实装）" : "") +
                "：请去掉相关轨道后再执行");

        // 单执行角色映射（ACTOR 契约）：驱动角色的事件必须同属一位演员；网页端只演预览舞者的
        // 口径在编译器侧收口，这里兜底拒绝混演员包
        string? executorPerformer = null;
        foreach (var ev in pkg.Events)
        {
            if (!DrivesCharacter(ev.Kind)) continue;
            if (string.IsNullOrEmpty(ev.PerformerId))
            {
                Err("E_EVENT_NO_PERFORMER", "动作事件「" + ev.Id + "」没有所属演员：请重新编译演出包");
                continue;
            }
            if (executorPerformer == null) executorPerformer = ev.PerformerId;
            else if (ev.PerformerId != executorPerformer)
            {
                Err("E_MULTI_PERFORMER", "演出包混入了多位演员的动作事件。当前版本游戏内一次只能由一位本地角色执行：" +
                    "请在网页侧选择游戏预览舞者后重新编译（或等待后续多演员执行器）");
                break;
            }
        }

        // 命令安全策略：会进游戏聊天系统的命令全部过闸（AUD2-005 同口径，装载期就拒绝）
        foreach (var ev in pkg.Events)
        {
            if (ev.Kind != "motion" && ev.Kind != "lyrics" && ev.Kind != "cue") continue;
            if (ev.Kind == "motion" && string.IsNullOrWhiteSpace(ev.Command))
            {
                Err("E_EMPTY_COMMAND", "动作事件「" + ev.Id + "」没有可执行的命令");
                continue;
            }
            if (!string.IsNullOrEmpty(ev.Command) && !ChatCommandPolicy.TryValidate(ev.Command, out var reason))
                Err("E_BAD_COMMAND", "事件「" + ev.Id + "」的命令不合格：" + reason);
        }

        // 时长覆盖：事件必须落在声明的演出时长里（编译器取 max(文档时长, 最晚结束)，正常不会越界）
        foreach (var ev in pkg.Events)
        {
            if (ev.StartMs < 0 || ev.DurationMs < 0 || ev.StartMs > pkg.DurationMs || ev.DurationMs > pkg.DurationMs - ev.StartMs)
            {
                Err("E_EVENT_OVEREND", "事件「" + ev.Id + "」结束时刻（" + (ev.StartMs + ev.DurationMs) +
                    "ms）超出演出时长（" + pkg.DurationMs + "ms）：请重新编译演出包");
                break;
            }
        }

        v.Ok = v.FirstError == null;
        return v;
    }
}
