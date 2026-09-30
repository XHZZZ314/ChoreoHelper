// 技能原生生命周期：精确关联动作响应序号，区分提交、读条、服务端响应和结束；不输出或重试。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public sealed record AbilityExecutionIdentity(string EventId, uint ActionId, ulong ActorId,
    uint ActorEntityId, ulong TargetId, uint JobId, uint TerritoryId);

public sealed record AbilityExecutionFrame(long AtMs, ulong ActorId, uint ActorEntityId, uint JobId,
    uint TerritoryId, ulong SelectedTargetId, bool Readable, bool IsCasting, uint CastActionId,
    ulong CastTargetId, float AnimationLockSeconds, bool ActionQueued);

public sealed record AbilityExecutionEffect(long AtMs, uint ActorEntityId, byte ActionType,
    uint ActionId, ushort SourceSequence, uint GlobalSequence, IReadOnlyList<ulong> TargetIds);

public sealed record AbilityExecutionResult
{
    public AbilityExecutionIdentity? Identity { get; init; }
    public string State { get; init; } = "idle";
    public string Message { get; init; } = "尚未执行";
    public long StartedAtMs { get; init; }
    public long? SubmittedAtMs { get; init; }
    public long? FinishedAtMs { get; init; }
    public ushort? SourceSequence { get; init; }
    public uint? EffectSequence { get; init; }
    public bool NativeReturned { get; init; }
    public bool NativeInvoked { get; init; }
    public bool? NativeReturnValue { get; init; }
    public string? Exception { get; init; }
    public string EffectState => "unknown";
    public bool CastObserved { get; init; }
    public bool ResponseObserved { get; init; }
    public bool AnimationLockReleased { get; init; }
    public string EvidenceLimit => "原生返回不是服务端接受；精确关联的动作响应不证明所有目标效果或网页特效已还原";
}

public sealed class AbilityExecutionLifecycle
{
    public const long MaximumObservationGapMs = 250;
    private AbilityExecutionIdentity? _identity;
    private long _lastAt, _deadline;
    private ulong _selectedTarget;
    private bool _lockObserved;
    public AbilityExecutionResult Result { get; private set; } = new();
    public bool Active => Result.State is "pending" or "submitted" or "casting" or "responded";

    public void Begin(AbilityExecutionIdentity identity, AbilityExecutionFrame frame, int timeoutMs)
    {
        if (Active) throw new InvalidOperationException("已有技能正在执行，不能覆盖");
        if (string.IsNullOrWhiteSpace(identity.EventId) || identity.ActionId == 0 || identity.ActorId == 0
            || identity.ActorEntityId == 0 || identity.TargetId == 0 || identity.JobId == 0 || identity.TerritoryId == 0
            || timeoutMs is < 1000 or > 120000 || frame.AtMs < 0 || frame.AtMs > long.MaxValue - timeoutMs)
            throw new ArgumentException("技能生命周期需要明确身份与有界超时");
        if (!Valid(frame) || !SameActor(identity, frame) || frame.IsCasting || frame.ActionQueued || frame.AnimationLockSeconds != 0)
            throw new ArgumentException("起始原生快照无效、忙碌或与声明身份不一致");
        _identity = identity with { };
        _lastAt = frame.AtMs; _deadline = checked(frame.AtMs + timeoutMs);
        _selectedTarget = frame.SelectedTargetId; _lockObserved = false;
        Result = new() { Identity = _identity, State = "pending", StartedAtMs = frame.AtMs, Message = "已冻结本次身份，尚未提交" };
    }

    public void Submitted(bool nativeReturned, ushort actualSequence, long atMs)
    {
        if (Result.State != "pending") throw new InvalidOperationException("同一技能只能提交一次");
        if (!TimeValid(atMs)) { Finish("uncertain", "提交时间失效，不能认定结果", atMs); return; }
        Result = Result with { NativeReturned = nativeReturned, SubmittedAtMs = atMs, SourceSequence = actualSequence };
        _lastAt = atMs;
        if (!nativeReturned) { Finish("rejected", "原生提交返回拒绝；不自动重试", atMs); return; }
        Result = Result with { State = "submitted", Message = "已提交，等待本次动作响应；尚未证明生效" };
    }

    public bool ObserveEffect(AbilityExecutionEffect effect)
    {
        if (!Active || Result.State == "pending" || _identity == null || !Result.NativeReturned
            || Result.ResponseObserved || !Result.SubmittedAtMs.HasValue || effect.AtMs < Result.SubmittedAtMs
            || effect.AtMs > _deadline || effect.ActorEntityId != _identity.ActorEntityId || effect.ActionType != 1
            || effect.ActionId != _identity.ActionId || effect.SourceSequence != Result.SourceSequence
            || effect.TargetIds == null || effect.TargetIds.Count is < 1 or > 64
            || !effect.TargetIds.Contains(_identity.TargetId)) return false;
        Result = Result with { ResponseObserved = true, EffectSequence = effect.GlobalSequence,
            State = "responded", Message = "收到本次技能的动作响应，等待读条与动画锁结束" };
        return true;
    }

    public void Observe(AbilityExecutionFrame frame)
    {
        if (!Active || _identity == null) return;
        if (!Valid(frame) || !SameActor(_identity, frame) || frame.SelectedTargetId != _selectedTarget
            || frame.AtMs < _lastAt || frame.AtMs - _lastAt > MaximumObservationGapMs)
        { Finish("uncertain", "原生观察中断或角色、职业、区域、手选目标变化；已停止后续派发", frame.AtMs); return; }
        _lastAt = frame.AtMs;
        if (frame.AtMs > _deadline)
        { Finish("uncertain", "结束状态超过本次观察期限；不能认定成功，不自动重试", frame.AtMs); return; }
        if (frame.ActionQueued)
        { Finish("uncertain", "观察到原生队列，不能作为本次即时派发完成；不自动补发", frame.AtMs); return; }
        if (frame.IsCasting)
        {
            if (frame.CastActionId != _identity.ActionId || frame.CastTargetId != _identity.TargetId)
            { Finish("interrupted", "出现另一个动作或目标的读条；不接管玩家操作", frame.AtMs); return; }
            Result = Result with { CastObserved = true, State = Result.ResponseObserved ? "responded" : "casting",
                Message = "正在观察本次技能读条，不重置统一时间轴" };
        }
        _lockObserved |= frame.AnimationLockSeconds > 0;
        if (_lockObserved && frame.AnimationLockSeconds == 0)
            Result = Result with { AnimationLockReleased = true };
        // 瞬发技能可能在两帧间结束动画锁；精确响应 + 当前不读条且锁为零足以结束本次动作生命周期。
        if (Result.ResponseObserved && !frame.IsCasting && frame.AnimationLockSeconds == 0)
        { Finish("completed", "本次动作响应已关联，读条和动画锁均结束", frame.AtMs); return; }
        if (frame.AtMs >= _deadline)
            Finish("uncertain", "等待本次动作响应或结束状态超时；不能认定成功，不自动重试", frame.AtMs);
    }

    public void Cancel(string reason, long atMs)
    {
        if (Active) Finish("cancelled", reason + "；取消后续派发，不撤销已经发出的技能或原生效果", atMs);
    }

    private bool TimeValid(long at) => at >= _lastAt && at <= _deadline && at - _lastAt <= MaximumObservationGapMs;
    private static bool Valid(AbilityExecutionFrame f) => f.Readable && f.AtMs >= 0
        && float.IsFinite(f.AnimationLockSeconds) && f.AnimationLockSeconds >= 0;
    private static bool SameActor(AbilityExecutionIdentity i, AbilityExecutionFrame f) => f.ActorId == i.ActorId
        && f.ActorEntityId == i.ActorEntityId && f.JobId == i.JobId && f.TerritoryId == i.TerritoryId;
    private void Finish(string state, string message, long at)
        => Result = Result with { State = state, Message = message, FinishedAtMs = at };
}
