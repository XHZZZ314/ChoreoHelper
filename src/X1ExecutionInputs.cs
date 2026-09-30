// 这个文件是干嘛的：X1 离线执行器纯输入层——单演员显式输入形状、有限数值与支持子集校验（无游戏依赖）。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

/// <summary>移动步态：仅支持步行/跑步（设计文档 §9 locomotion）。</summary>
public enum X1Locomotion
{
    Walk = 0,
    Run = 1,
}

/// <summary>朝向模式：本增量支持固定角/沿路径切向/舞台中心（显式中心坐标）；过渡/他演员一律拒绝（设计文档 §10）。</summary>
public enum X1FacingMode
{
    FixedAngle = 0,
    AlongPath = 1,
    Transition = 2,
    StageCenter = 3,
    OtherActor = 4,
}

/// <summary>失败策略：本增量仅支持停止整场；skip/wait 一律拒绝。</summary>
public enum X1FailurePolicy
{
    StopShow = 0,
    Skip = 1,
    Wait = 2,
}

/// <summary>舞台本地 x/z 平面路点（米），tMs 为事件本地相对毫秒（严格递增）。</summary>
public sealed class X1Waypoint
{
    public long TMs { get; set; }
    public double X { get; set; }
    public double Z { get; set; }
}

/// <summary>技能离线输入：显式动作 + 职业/等级要求 + 停止策略 + 单演员归属。</summary>
public sealed class X1AbilityInput
{
    public string EventId { get; set; } = "";
    public string PerformerId { get; set; } = "";
    public string ActionId { get; set; } = "";
    public string RequiredJob { get; set; } = "";
    public string RequiredJobId { get; set; } = "";
    public int RequiredLevel { get; set; }
    public X1FailurePolicy FailurePolicy { get; set; } = X1FailurePolicy.StopShow;
}

/// <summary>移动离线输入：已采样有限路点 + 显式容差/修正界 + 停止策略。无真实容差默认值。</summary>
public sealed class X1MovementInput
{
    public string EventId { get; set; } = "";
    public string PerformerId { get; set; } = "";
    public List<X1Waypoint> Points { get; } = new();
    public X1Locomotion Locomotion { get; set; } = X1Locomotion.Walk;
    public double ArrivalToleranceM { get; set; }
    public double MaxCorrectionM { get; set; }
    public X1FailurePolicy FailurePolicy { get; set; } = X1FailurePolicy.StopShow;
    /// <summary>未采样曲线控制点标记：为 true 即未采样输入，校验一律拒绝。</summary>
    public bool IsCurveControlPoints { get; set; }
}

/// <summary>朝向离线输入：角度为度，舞台本地轴；固定角/沿路径/舞台中心（显式中心）有效。</summary>
public sealed class X1FacingInput
{
    public string EventId { get; set; } = "";
    public string PerformerId { get; set; } = "";
    public X1FacingMode FacingMode { get; set; } = X1FacingMode.FixedAngle;
    public double FixedAngleDeg { get; set; }
    /// <summary>舞台中心模式显式中心（舞台本地米，同移动/观测坐标系）；仅 StageCenter 必填，须双轴同时有限，无隐式 (0,0)。</summary>
    public double? StageCenterX { get; set; }
    public double? StageCenterZ { get; set; }
    public double? TransitionFromDeg { get; set; }
    public double? TransitionToDeg { get; set; }
    public string? OtherActorTargetId { get; set; }
    public X1FailurePolicy FailurePolicy { get; set; } = X1FailurePolicy.StopShow;
}

/// <summary>技能测试供给观测：七条件各为 true=满足、false=不满足、null=未知（未知一律 fail-closed）。</summary>
public sealed class X1AbilityConditions
{
    public bool? JobMatches { get; set; }
    public bool? LevelMeets { get; set; }
    public bool? TargetValid { get; set; }
    public bool? NotCasting { get; set; }
    public bool? CooldownReady { get; set; }
    public bool? MovementAllowed { get; set; }
    public bool? Controllable { get; set; }
}

/// <summary>技能记录槽：仅收显式动作与显式目标；返回 false=槽拒绝，抛异常=槽异常（皆故障停）。</summary>
public interface IX1AbilitySink
{
    bool Submit(string actionId, string target);
}

/// <summary>移动记录槽：只收意图（修正向量/目标点），绝不写游戏坐标。</summary>
public interface IX1MovementSink
{
    void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs);
    void ReleaseMovement(string eventId);
}

/// <summary>朝向记录槽：只收意图（角度），绝不写游戏朝向。</summary>
public interface IX1FacingSink
{
    void EmitFacing(string eventId, double angleDeg, long showTimeMs);
    void ReleaseFacing(string eventId);
}

/// <summary>X1 纯输入校验：所有拒绝皆中文非空原因，拒绝先于任何执行器构造且零槽调用。</summary>
public static class X1InputValidation
{
    public static bool IsFiniteDouble(double v) => !double.IsNaN(v) && !double.IsInfinity(v);

    public static (bool Ok, string Error) ValidateAbility(X1AbilityInput input)
    {
        if (input == null) return (false, "技能输入为空：缺少技能事件输入");
        if (string.IsNullOrWhiteSpace(input.EventId)) return (false, "技能事件缺少非空事件标识");
        if (string.IsNullOrWhiteSpace(input.PerformerId)) return (false, "技能事件「" + input.EventId + "」缺少所属演员");
        if (string.IsNullOrWhiteSpace(input.ActionId)) return (false, "技能事件「" + input.EventId + "」缺少动作标识");
        if (input.FailurePolicy != X1FailurePolicy.StopShow)
            return (false, "技能事件「" + input.EventId + "」失败策略仅支持停止整场：请去掉跳过/等待策略");
        if (input.RequiredLevel < 0)
            return (false, "技能事件「" + input.EventId + "」等级要求须为非负整数");
        return (true, "");
    }

    public static (bool Ok, string Error) ValidateMovement(X1MovementInput input)
    {
        if (input == null) return (false, "移动输入为空：缺少移动事件输入");
        if (string.IsNullOrWhiteSpace(input.EventId)) return (false, "移动事件缺少非空事件标识");
        if (string.IsNullOrWhiteSpace(input.PerformerId)) return (false, "移动事件「" + input.EventId + "」缺少所属演员");
        if (input.IsCurveControlPoints)
            return (false, "移动事件「" + input.EventId + "」为未采样曲线控制点：请先采样为有限路点再执行");
        if (input.FailurePolicy != X1FailurePolicy.StopShow)
            return (false, "移动事件「" + input.EventId + "」失败策略仅支持停止整场：请去掉跳过/等待策略");
        if (!Enum.IsDefined(typeof(X1Locomotion), input.Locomotion))
            return (false, "移动事件「" + input.EventId + "」步态仅支持步行/跑步");
        if (!IsFiniteDouble(input.ArrivalToleranceM) || !IsFiniteDouble(input.MaxCorrectionM))
            return (false, "移动事件「" + input.EventId + "」容差与修正界须为有限数值");
        if (!(input.ArrivalToleranceM > 0))
            return (false, "移动事件「" + input.EventId + "」到达容差须为正数");
        if (!(input.MaxCorrectionM > 0))
            return (false, "移动事件「" + input.EventId + "」单次修正界须为正数");
        if (input.Points == null || input.Points.Count == 0)
            return (false, "移动事件「" + input.EventId + "」路点为空：至少需要一个路点");
        long prev = long.MinValue;
        bool first = true;
        foreach (var p in input.Points)
        {
            if (p == null) return (false, "移动事件「" + input.EventId + "」存在空路点");
            if (!IsFiniteDouble(p.X) || !IsFiniteDouble(p.Z))
                return (false, "移动事件「" + input.EventId + "」路点坐标须为有限数值");
            if (!first && p.TMs <= prev)
                return (false, "移动事件「" + input.EventId + "」路点时刻须严格递增（重复或倒退时刻含零长段）");
            prev = p.TMs;
            first = false;
        }
        return (true, "");
    }

    public static (bool Ok, string Error) ValidateFacing(X1FacingInput input)
    {
        if (input == null) return (false, "朝向输入为空：缺少朝向事件输入");
        if (string.IsNullOrWhiteSpace(input.EventId)) return (false, "朝向事件缺少非空事件标识");
        if (string.IsNullOrWhiteSpace(input.PerformerId)) return (false, "朝向事件「" + input.EventId + "」缺少所属演员");
        if (input.FailurePolicy != X1FailurePolicy.StopShow)
            return (false, "朝向事件「" + input.EventId + "」失败策略仅支持停止整场：请去掉跳过/等待策略");
        if (!IsFiniteDouble(input.FixedAngleDeg))
            return (false, "朝向事件「" + input.EventId + "」角度须为有限数值（度）");
        switch (input.FacingMode)
        {
            case X1FacingMode.FixedAngle:
            case X1FacingMode.AlongPath:
                return (true, "");
            case X1FacingMode.Transition:
                if (!input.TransitionFromDeg.HasValue || !input.TransitionToDeg.HasValue
                    || !IsFiniteDouble(input.TransitionFromDeg.Value) || !IsFiniteDouble(input.TransitionToDeg.Value)
                    || !IsFiniteDouble(input.TransitionToDeg.Value-input.TransitionFromDeg.Value))
                    return (false, "过渡须有明确有限的起止角与角差");
                return (true, "");
            case X1FacingMode.StageCenter:
                if (!input.StageCenterX.HasValue || !input.StageCenterZ.HasValue)
                    return (false, "朝向事件「" + input.EventId + "」舞台中心模式缺少显式中心坐标：请同时提供舞台本地中心 x/z（无隐式原点）");
                if (!IsFiniteDouble(input.StageCenterX.Value) || !IsFiniteDouble(input.StageCenterZ.Value))
                    return (false, "朝向事件「" + input.EventId + "」舞台中心坐标须为有限数值");
                return (true, "");
            case X1FacingMode.OtherActor:
                return (false, "朝向事件「" + input.EventId + "」他演员模式暂不支持：仅支持固定角/沿路径/舞台中心");
            default:
                return (false, "朝向事件「" + input.EventId + "」朝向模式未知：仅支持固定角/沿路径/舞台中心");
        }
    }

    /// <summary>单演员捆绑校验：所有驱动输入必须同属一位显式演员。</summary>
    public static (bool Ok, string Error) ValidateBundle(
        string performerId,
        IEnumerable<X1AbilityInput>? abilities,
        IEnumerable<X1MovementInput>? movements,
        IEnumerable<X1FacingInput>? facings)
    {
        if (string.IsNullOrWhiteSpace(performerId))
            return (false, "缺少显式单演员标识：请输入一位本地表演者");
        void CheckOne(string pid, string eid, ref bool bad, ref string err)
        {
            if (bad) return;
            if (pid != performerId)
            {
                bad = true;
                err = "事件「" + eid + "」演员与单演员「" + performerId + "」不一致：当前仅支持一位本地表演者";
            }
        }
        var bad = false;
        var err = "";
        if (abilities != null) foreach (var a in abilities)
        {
            if (a == null) { bad = true; err = "技能输入为空：缺少技能事件输入"; break; }
            CheckOne(a.PerformerId, a.EventId, ref bad, ref err);
            if (bad) break;
            var (ok, e) = ValidateAbility(a);
            if (!ok) { bad = true; err = e; break; }
        }
        if (!bad && movements != null) foreach (var m in movements)
        {
            if (m == null) { bad = true; err = "移动输入为空：缺少移动事件输入"; break; }
            CheckOne(m.PerformerId, m.EventId, ref bad, ref err);
            if (bad) break;
            var (ok, e) = ValidateMovement(m);
            if (!ok) { bad = true; err = e; break; }
        }
        if (!bad && facings != null) foreach (var f in facings)
        {
            if (f == null) { bad = true; err = "朝向输入为空：缺少朝向事件输入"; break; }
            CheckOne(f.PerformerId, f.EventId, ref bad, ref err);
            if (bad) break;
            var (ok, e) = ValidateFacing(f);
            if (!ok) { bad = true; err = e; break; }
        }
        return bad ? (false, err) : (true, "");
    }
}
