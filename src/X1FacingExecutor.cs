// 这个文件是干嘛的：X1 朝向纯执行器——独立固定角/舞台中心方位、静止保持上次输出、不支持模式拒绝。
using System;

namespace ChoreoHelper;

public sealed class X1FacingExecutor
{
    public X1FacingInput Input { get; }
    public long StartShowMs { get; }
    public long EndShowMs { get; }
    /// <summary>舞台中心快照（舞台本地米）：构造时复制已采纳中心，调用方后续改输入不可重定向。</summary>
    public double StageCenterX { get; }
    public double StageCenterZ { get; }
    public double TransitionFromDeg { get; }
    public double TransitionToDeg { get; }
    public string OtherActorTargetId { get; }
    public bool Released { get; private set; }
    public double LastEmittedDeg { get; private set; }
    public bool HasEmitted { get; private set; }

    private X1FacingExecutor(X1FacingInput input, long startShowMs, long endShowMs)
    {
        Input = input;
        StartShowMs = startShowMs;
        EndShowMs = endShowMs;
        StageCenterX = input.StageCenterX ?? 0;
        StageCenterZ = input.StageCenterZ ?? 0;
        TransitionFromDeg = input.TransitionFromDeg ?? 0;
        TransitionToDeg = input.TransitionToDeg ?? 0;
        OtherActorTargetId = input.OtherActorTargetId ?? "";
    }

    public static (bool Ok, string Error, X1FacingExecutor? Exec) TryCreate(X1FacingInput input, long startShowMs, long endShowMs)
    {
        var (ok, err) = X1InputValidation.ValidateFacing(input);
        if (!ok) return (false, err, null);
        if (endShowMs < startShowMs)
            return (false, "朝向事件「" + input.EventId + "」结束时刻早于开始时刻", null);
        return (true, "", new X1FacingExecutor(input, startShowMs, endShowMs));
    }

    public bool IsActive(long showTimeMs) => showTimeMs >= StartShowMs && showTimeMs < EndShowMs && !Released;

    /// <summary>独立事件更新：固定角直接输出；沿路径需调用方供给切向；舞台中心需调用方供给观测位置。无供给时保持上次（不 snap 到 0/NaN）。</summary>
    public (bool Ok, string Error) Update(long showTimeMs, double? movementTangentDeg, IX1FacingSink sink, double? obsX = null, double? obsZ = null, double? targetX = null, double? targetZ = null)
    {
        if (Released) return (true, "");
        if (showTimeMs < StartShowMs || showTimeMs >= EndShowMs) return (true, "");
        if (sink == null) return (false, "朝向事件「" + Input.EventId + "」缺少记录槽：无槽时拒绝执行");
        try
        {
            if (Input.FacingMode == X1FacingMode.Transition)
            {
                var span = EndShowMs - StartShowMs;
                if (span <= 0) return (true, "");
                var delta = TransitionToDeg - TransitionFromDeg;
                if (!X1InputValidation.IsFiniteDouble(delta))
                    return (false, "朝向事件「" + Input.EventId + "」过渡起止角差须为有限数值");
                var t = (double)(showTimeMs - StartShowMs) / span;
                var raw = TransitionFromDeg + delta * t;
                if (!X1InputValidation.IsFiniteDouble(raw))
                    return (false, "朝向事件「" + Input.EventId + "」过渡插值须为有限数值");
                var ta = X1MovementExecutor.NormalizeDeg(raw);
                if (!X1InputValidation.IsFiniteDouble(ta))
                    return (false, "朝向事件「" + Input.EventId + "」过渡插值须为有限数值");
                sink.EmitFacing(Input.EventId, ta, showTimeMs);
                LastEmittedDeg = ta;
                HasEmitted = true;
                return (true, "");
            }
            if (Input.FacingMode == X1FacingMode.FixedAngle)
            {
                var a = X1MovementExecutor.NormalizeDeg(Input.FixedAngleDeg);
                sink.EmitFacing(Input.EventId, a, showTimeMs);
                LastEmittedDeg = a;
                HasEmitted = true;
                return (true, "");
            }
            if (Input.FacingMode == X1FacingMode.AlongPath)
            {
                if (movementTangentDeg.HasValue && X1InputValidation.IsFiniteDouble(movementTangentDeg.Value))
                {
                    var a = X1MovementExecutor.NormalizeDeg(movementTangentDeg.Value);
                    sink.EmitFacing(Input.EventId, a, showTimeMs);
                    LastEmittedDeg = a;
                    HasEmitted = true;
                    return (true, "");
                }
                if (HasEmitted)
                {
                    sink.EmitFacing(Input.EventId, LastEmittedDeg, showTimeMs);
                    return (true, "");
                }
                return (true, "");
            }
            if (Input.FacingMode == X1FacingMode.StageCenter)
            {
                if (!obsX.HasValue || !obsZ.HasValue)
                    return (false, "朝向事件「" + Input.EventId + "」缺少观测位置：舞台中心模式需要当前位置");
                var dx = StageCenterX - obsX.Value;
                var dz = StageCenterZ - obsZ.Value;
                if (!X1InputValidation.IsFiniteDouble(dx) || !X1InputValidation.IsFiniteDouble(dz))
                    return (false, "朝向事件「" + Input.EventId + "」舞台中心方位须为有限数值");
                // 与移动切向同一退化口径：双分量绝对值均低于 1e-12 视为重合，保持上次或零输出。
                if (Math.Abs(dx) < 1e-12 && Math.Abs(dz) < 1e-12)
                {
                    if (HasEmitted) sink.EmitFacing(Input.EventId, LastEmittedDeg, showTimeMs);
                    return (true, "");
                }
                var a = X1MovementExecutor.NormalizeDeg(Math.Atan2(dx, dz) * 180.0 / Math.PI);
                sink.EmitFacing(Input.EventId, a, showTimeMs);
                LastEmittedDeg = a;
                HasEmitted = true;
                return (true, "");
            }
            return (false, "朝向事件「" + Input.EventId + "」朝向模式暂不支持：仅支持固定角/沿路径/舞台中心");
        }
        catch (Exception ex)
        {
            if (Input.FacingMode == X1FacingMode.OtherActor)
            {
                if (!obsX.HasValue || !obsZ.HasValue)
                    return (false, "朝向事件「" + Input.EventId + "」缺少观测位置：他演员模式需要当前位置");
                if (!targetX.HasValue || !targetZ.HasValue)
                    return (false, "朝向事件「" + Input.EventId + "」缺少目标观测位置：他演员模式需要目标当前位置");
                var dx = targetX.Value - obsX.Value;
                var dz = targetZ.Value - obsZ.Value;
                if (!X1InputValidation.IsFiniteDouble(dx) || !X1InputValidation.IsFiniteDouble(dz))
                    return (false, "朝向事件「" + Input.EventId + "」他演员方位须为有限数值");
                // 与舞台中心同一退化口径：双分量绝对值均低于 1e-12 视为重合（含自目标），保持上次或零输出。
                if (Math.Abs(dx) < 1e-12 && Math.Abs(dz) < 1e-12)
                {
                    if (HasEmitted) sink.EmitFacing(Input.EventId, LastEmittedDeg, showTimeMs);
                    return (true, "");
                }
                var a = X1MovementExecutor.NormalizeDeg(Math.Atan2(dx, dz) * 180.0 / Math.PI);
                // 严格 [0,360)：共享归一在 0/360 环绕边界可能舍入为恰好 360（dx=-4e-16,dz=1），
                // 仅他演员分支把该值规范为 0；小于 360 的结果原样输出，共享助手与其他分支不动。
                if (a == 360.0) a = 0;
                if (!X1InputValidation.IsFiniteDouble(a))
                    return (false, "朝向事件「" + Input.EventId + "」他演员方位须为有限数值");
                sink.EmitFacing(Input.EventId, a, showTimeMs);
                LastEmittedDeg = a;
                HasEmitted = true;
                return (true, "");
            }
            return (false, "朝向事件「" + Input.EventId + "」记录槽异常：" + ex.Message);
        }
    }

    public void Release(IX1FacingSink sink)
    {
        if (Released) return;
        Released = true;
        sink?.ReleaseFacing(Input.EventId);
    }
}
