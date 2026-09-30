// 这个文件是干嘛的：EXEC-CORE 运行时保护纯策略（无 Dalamud 依赖，进 datalayertest）。
// 设计文档 §7 的停演条件收敛成一个可测纯函数：ShowRunner 每帧喂一份 GuardSnapshot（游戏
// 适配器从 Dalamud 服务采集），Evaluate 返回第一个命中的停止原因；返回 None 才允许继续演。
// 停止条件全集：角色消失、地图/加载变化、过场、进战斗/副本、不可控、手动接管、时钟跳变、
// 适配器失败、移动误差超限。判定优先级 = 列表顺序（越靠前越致命）。注意：快照里哪些输入
// 是当前适配器真能采到的（角色/地图/过场/战斗/加载）与哪些还只是协议位（手动接管/移动误差，
// 待输入钩子与移动执行器实装后接线），由 GameShowDispatcher 诚实标注，本文件只管判定逻辑。
using System;

namespace ChoreoHelper;

public enum GuardCode
{
    None = 0,
    CharacterLost,      // 本地角色消失
    TerritoryChanged,   // 地图/区划变化或加载屏
    Cutscene,           // 进入过场
    InCombat,           // 进入战斗/副本
    Uncontrollable,     // 角色不可控（被系统状态接管）
    ManualTakeover,     // 玩家手动移动/主动接管
    ClockJump,          // 时钟跳变（单调时钟倒流或单帧跨度过大）
    AdapterFailure,     // 适配器/执行器失败
    MovementError,      // 移动误差持续超限/卡死
}

public sealed class GuardSnapshot
{
    public bool CharacterPresent { get; set; } = true;
    public bool TerritoryChanged { get; set; }
    public bool InCutscene { get; set; }
    public bool InCombat { get; set; }
    public bool Uncontrollable { get; set; }
    public bool ManualTakeover { get; set; }
    public bool AdapterFailure { get; set; }
    public bool MovementErrorOverLimit { get; set; }
    /// <summary>本帧与上一帧的单调时钟差（毫秒）。&lt;0（倒流）或 &gt; Threshold 视为跳变。</summary>
    public long FrameDeltaMs { get; set; }
    public long ClockJumpThresholdMs { get; set; } = 5000;
    /// <summary>触发原因的补充说明（进 ExecutionLog / 状态接口，给人看）。</summary>
    public string Detail { get; set; } = "";
}

public static class RuntimeGuard
{
    public static readonly string[] ReasonTexts =
    {
        "无",
        "本地角色消失",
        "地图变化或加载屏",
        "进入过场动画",
        "进入战斗",
        "角色不可控",
        "玩家手动接管",
        "时钟跳变",
        "执行器失败",
        "移动误差超限",
    };

    /// <summary>返回第一个命中的停止原因；None = 允许继续。</summary>
    public static GuardCode Evaluate(GuardSnapshot s)
    {
        if (s == null) return GuardCode.AdapterFailure;
        if (!s.CharacterPresent) return GuardCode.CharacterLost;
        if (s.TerritoryChanged) return GuardCode.TerritoryChanged;
        if (s.InCutscene) return GuardCode.Cutscene;
        if (s.InCombat) return GuardCode.InCombat;
        if (s.Uncontrollable) return GuardCode.Uncontrollable;
        if (s.ManualTakeover) return GuardCode.ManualTakeover;
        if (s.FrameDeltaMs < 0 || s.FrameDeltaMs > Math.Max(0, s.ClockJumpThresholdMs)) return GuardCode.ClockJump;
        if (s.AdapterFailure) return GuardCode.AdapterFailure;
        if (s.MovementErrorOverLimit) return GuardCode.MovementError;
        return GuardCode.None;
    }

    public static string Describe(GuardCode code)
    {
        var i = (int)code;
        return i >= 0 && i < ReasonTexts.Length ? ReasonTexts[i] : code.ToString();
    }
}
