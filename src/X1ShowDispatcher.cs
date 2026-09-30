// 这个文件是干嘛的：X1 离线记录分发器——复用 ShowRunner 时钟/调度/生命周期的纯记录实现（无游戏调用）。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public sealed class X1ShowDispatcher : IShowDispatcher, IX1ActiveUpdater
{
    public const string OfflineIntentReason = "离线意图（未确认游戏生效）";

    public string PerformerId { get; }
    private readonly Dictionary<string, X1AbilityInput> _abilities = new(StringComparer.Ordinal);
    private readonly Dictionary<string, X1AbilityConditions> _abilityConds = new(StringComparer.Ordinal);
    /// <summary>显式 live 观测供给（按事件）：分发到期时恰读一次；与 _abilityConds 互斥（同 id 后登记者生效）。</summary>
    private readonly Dictionary<string, Func<X1AbilityConditions?>> _abilityLiveConds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _abilityTargets = new(StringComparer.Ordinal);
    private readonly Dictionary<string, X1MovementInput> _movementInputs = new(StringComparer.Ordinal);
    private readonly Dictionary<string, X1FacingInput> _facingInputs = new(StringComparer.Ordinal);
    private readonly Dictionary<string, X1MovementExecutor> _activeMovements = new(StringComparer.Ordinal);
    private readonly Dictionary<string, X1FacingExecutor> _activeFacings = new(StringComparer.Ordinal);

    public IX1AbilitySink? AbilitySink { get; set; }
    public IX1MovementSink? MovementSink { get; set; }
    public IX1FacingSink? FacingSink { get; set; }
    public Func<(double X, double Z)>? ObservedProvider { get; set; }

    public readonly List<ShowEvent> Dispatched = new();
    public int StopCalls;
    public int ShowStartCalls;
    private bool _stopped;
    private double _lastFacingDeg;
    private bool _hasLastFacing;

    // era-reconciliation ports (donor: _merge X1ShowDispatcher.cs.lf).
    public Func<string, (double X, double Z)>? OtherActorPositionProvider { get; set; }
    public int RegisteredAbilityCount => _abilities.Count;
    public int RegisteredMovementCount => _movementInputs.Count;
    public int RegisteredFacingCount => _facingInputs.Count;

    public X1ShowDispatcher(string performerId)
    {
        PerformerId = performerId ?? "";
    }

    public (bool Ok, string Error) AddAbility(X1AbilityInput input, X1AbilityConditions cond, string target)
    {
        if (input == null) return (false, "技能输入为空：缺少技能事件输入");
        if (input.PerformerId != PerformerId)
            return (false, "事件「" + input.EventId + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        var (ok, err) = X1InputValidation.ValidateAbility(input);
        if (!ok) return (false, err);
        _abilities[input.EventId] = input;
        _abilityConds[input.EventId] = cond;
        _abilityLiveConds.Remove(input.EventId); // 同 id 模式唯一：后登记 legacy 让 live 供给让位
        _abilityTargets[input.EventId] = target ?? "";
        return (true, "");
    }

    /// <summary>显式 live 观测登记（TASK-20260912-X1-ABILITY-ADAPTER）：条件对象不在登记时快照，
    /// 分发到期时经供给恰读一次（供给缺失/异常/null 不可跳过，不回退登记条件）。
    /// 与 AddAbility 互斥：同 id 后登记者生效。</summary>
    public (bool Ok, string Error) AddAbilityLive(X1AbilityInput input, Func<X1AbilityConditions?>? supply, string target)
    {
        if (input == null) return (false, "技能输入为空：缺少技能事件输入");
        if (supply == null)
            return (false, "技能事件「" + input.EventId + "」实时条件供给缺失：live 模式必须提供观测供给");
        if (input.PerformerId != PerformerId)
            return (false, "事件「" + input.EventId + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        var (ok, err) = X1InputValidation.ValidateAbility(input);
        if (!ok) return (false, err);
        _abilities[input.EventId] = input;
        _abilityLiveConds[input.EventId] = supply;
        _abilityConds.Remove(input.EventId); // 同 id 模式唯一：后登记 live 让 legacy 条件让位
        _abilityTargets[input.EventId] = target ?? "";
        return (true, "");
    }

    public (bool Ok, string Error) AddMovement(X1MovementInput input)
    {
        if (input == null) return (false, "移动输入为空：缺少移动事件输入");
        if (input.PerformerId != PerformerId)
            return (false, "事件「" + input.EventId + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        var (ok, err) = X1InputValidation.ValidateMovement(input);
        if (!ok) return (false, err);
        _movementInputs[input.EventId] = input;
        return (true, "");
    }

    public (bool Ok, string Error) AddFacing(X1FacingInput input)
    {
        if (input == null) return (false, "朝向输入为空：缺少朝向事件输入");
        if (input.PerformerId != PerformerId)
            return (false, "事件「" + input.EventId + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        var (ok, err) = X1InputValidation.ValidateFacing(input);
        if (!ok) return (false, err);
        _facingInputs[input.EventId] = input;
        return (true, "");
    }

    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        Dispatched.Add(e);
        if (_stopped)
            return ShowDispatchResult.Fail("已停止：显式就绪后才可再次执行");
        switch (e.Kind)
        {
            case "motion":
            case "cue":
            case "lyrics":
                return ShowDispatchResult.Success();
            case "ability":
                return DispatchAbility(e);
            case "movement":
                return DispatchMovement(e);
            case "facing":
                return DispatchFacing(e);
            default:
                return ShowDispatchResult.Fail("事件类型「" + e.Kind + "」没有执行器");
        }
    }

    private ShowDispatchResult DispatchAbility(ShowEvent e)
    {
        if (!_abilities.TryGetValue(e.Id, out var input))
            return ShowDispatchResult.Fail("技能事件「" + e.Id + "」缺少离线输入");
        if (e.PerformerId != PerformerId || input.PerformerId != PerformerId)
            return ShowDispatchResult.Fail("事件「" + e.Id + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        if (AbilitySink == null)
            return ShowDispatchResult.Fail("技能事件「" + e.Id + "」缺少记录槽：无槽时拒绝执行");
        _abilityConds.TryGetValue(e.Id, out var cond);
        _abilityTargets.TryGetValue(e.Id, out var target);
        var (ok, err, _, _) = X1AbilityExecutor.TryExecute(input, cond!, target ?? "", AbilitySink);
        if (!ok) return ShowDispatchResult.Fail(err);
        return new ShowDispatchResult { Ok = true, Reason = OfflineIntentReason };
    }

    private ShowDispatchResult DispatchMovement(ShowEvent e)
    {
        if (!_movementInputs.TryGetValue(e.Id, out var input))
            return ShowDispatchResult.Fail("移动事件「" + e.Id + "」缺少离线输入");
        if (e.PerformerId != PerformerId || input.PerformerId != PerformerId)
            return ShowDispatchResult.Fail("事件「" + e.Id + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        if (MovementSink == null)
            return ShowDispatchResult.Fail("移动事件「" + e.Id + "」缺少记录槽：无槽时拒绝执行");
        var (ok, err, exec) = X1MovementExecutor.TryCreate(input, e.StartMs);
        if (!ok || exec == null) return ShowDispatchResult.Fail(err);
        _activeMovements[e.Id] = exec;
        return new ShowDispatchResult { Ok = true, Reason = OfflineIntentReason };
    }

    private ShowDispatchResult DispatchFacing(ShowEvent e)
    {
        if (!_facingInputs.TryGetValue(e.Id, out var input))
            return ShowDispatchResult.Fail("朝向事件「" + e.Id + "」缺少离线输入");
        if (e.PerformerId != PerformerId || input.PerformerId != PerformerId)
            return ShowDispatchResult.Fail("事件「" + e.Id + "」演员与单演员「" + PerformerId + "」不一致：当前仅支持一位本地表演者");
        if (FacingSink == null)
            return ShowDispatchResult.Fail("朝向事件「" + e.Id + "」缺少记录槽：无槽时拒绝执行");
        var (ok, err, exec) = X1FacingExecutor.TryCreate(input, e.StartMs, e.StartMs + e.DurationMs);
        if (!ok || exec == null) return ShowDispatchResult.Fail(err);
        _activeFacings[e.Id] = exec;
        return new ShowDispatchResult { Ok = true, Reason = OfflineIntentReason };
    }

    public (bool Ok, string Error, List<X1SkipRecord>? Skips, string FailedEventId) UpdateActive(long showTimeMs)
    {
        if (_stopped) return (true, "", null, "");
        if (MovementSink == null || FacingSink == null)
            return (false, "缺少记录槽：无槽时拒绝执行", null, "");
        // 朝向优先级：独立事件激活时独占获胜；否则移动切向；静止保持上次。
        // 已过期独立事件保留至 OnStop 统一释放（恰一次），但不再参与获胜判定，杜绝过期角残留。
        var orderedFacings = _activeFacings.Values
            .Where(f => f.IsActive(showTimeMs))
            .OrderBy(f => f.StartShowMs).ThenBy(f => f.Input.EventId).ToList();
        var facingWinner = orderedFacings.Count > 0 ? orderedFacings.OrderByDescending(f => f.StartShowMs).First() : null;
        // 观测读取：仅当存在待更新移动或获胜独立朝向是舞台中心时读一次，移动与朝向共用同一快照。
        // 过期/被压制的舞台中心自身不触发读取；固定角/沿路径朝向不需要观测。
        // 舞中心触发的读取失败须带回获胜事件标识；纯移动触发的沿用原文案（存量字节不变）。
        (double X, double Z) obs = (0, 0);
        var hasObs = false;
        var needObsForFacing = facingWinner != null && facingWinner.Input.FacingMode == X1FacingMode.StageCenter;
        if (_activeMovements.Count > 0 || needObsForFacing)
        {
            var errPrefix = needObsForFacing ? "朝向事件「" + facingWinner!.Input.EventId + "」" : "";
            // 舞台中心朝向触发的观测失败可归属到获胜朝向事件；纯移动触发只有唯一活动事件时才可归属。
            var errOwner = needObsForFacing ? facingWinner!.Input.EventId
                : _activeMovements.Count == 1 ? _activeMovements.Values.Single().Input.EventId : "";
            if (ObservedProvider == null)
                return (false, errPrefix + "缺少观测位置供给：无观测时拒绝执行", null, errOwner);
            try { obs = ObservedProvider(); }
            catch (Exception ex) { return (false, errPrefix + "观测位置供给异常：" + ex.Message, null, errOwner); }
            if (!X1InputValidation.IsFiniteDouble(obs.X) || !X1InputValidation.IsFiniteDouble(obs.Z))
                return (false, errPrefix + "观测位置须为有限数值", null, errOwner);
            hasObs = true;
            // 观测回调可能已重入停止（OnStop 已清扫并清空活动表）：本更新剩余移动/朝向输出全部抑制。
            if (_stopped) return (true, "", null, "");
        }
        var orderedMovements = _activeMovements.Values.OrderBy(m => m.StartShowMs).ThenBy(m => m.Input.EventId).ToList();
        foreach (var m in orderedMovements)
        {
            if (_stopped) return (true, "", null, "");
            var (ok, err, _) = m.Update(showTimeMs, obs.X, obs.Z, MovementSink);
            if (!ok) return (false, err, null, m.Input.EventId);
            if (m.Released) _activeMovements.Remove(m.Input.EventId);
        }
        if (orderedFacings.Count > 0)
        {
            if (_stopped) return (true, "", null, "");
            double? tangent = null;
            foreach (var m in orderedMovements)
            {
                if (m.TryGetTangentDeg(showTimeMs, out var td)) { tangent = td; break; }
            }
            var (ok, err) = facingWinner!.Update(showTimeMs, tangent, FacingSink, hasObs ? obs.X : null, hasObs ? obs.Z : null);
            if (!ok) return (false, err, null, facingWinner.Input.EventId);
            if (facingWinner.HasEmitted)
            {
                _lastFacingDeg = facingWinner.LastEmittedDeg;
                _hasLastFacing = true;
            }
            return (true, "", null, "");
        }
        // 无独立事件：移动切向（至多一条意图）。
        double? moveTangent = null;
        string moveId = "";
        foreach (var m in orderedMovements)
        {
            if (m.TryGetTangentDeg(showTimeMs, out var td)) { moveTangent = td; moveId = m.Input.EventId; break; }
        }
        if (moveTangent.HasValue)
        {
            if (_stopped) return (true, "", null, "");
            try
            {
                var a = X1MovementExecutor.NormalizeDeg(moveTangent.Value);
                FacingSink.EmitFacing(moveId, a, showTimeMs);
                _lastFacingDeg = a;
                _hasLastFacing = true;
            }
            catch (Exception ex)
            {
                return (false, "朝向记录槽异常：" + ex.Message, null, moveId);
            }
            return (true, "", null, "");
        }
        // 静止段：若有上次输出则保持（调用方已验证不 snap 到 0/NaN）；无上次则零输出。
        if (_hasLastFacing && orderedMovements.Count > 0)
        {
            if (_stopped) return (true, "", null, "");
            // 仅当存在激活移动但切向退化（静止）时保持；无激活移动时零输出。
            var anyActiveMovement = orderedMovements.Any(m => showTimeMs >= m.StartShowMs && showTimeMs < m.EndShowMs);
            if (anyActiveMovement)
            {
                try
                {
                    var holdId = orderedMovements[0].Input.EventId;
                    FacingSink.EmitFacing(holdId, _lastFacingDeg, showTimeMs);
                }
                catch (Exception ex)
                {
                    return (false, "朝向记录槽异常：" + ex.Message, null, orderedMovements[0].Input.EventId);
                }
            }
        }
        return (true, "", null, "");
    }

    public void OnShowStart()
    {
        ShowStartCalls++;
        // 重演开新代（TASK-20260912-X1-ABILITY-ADAPTER r3）：旧代在途待写全部失效，
        // 重演重新观测；槽实现运行代见证才生效（记录槽假件/离线路径无感）。
        (AbilitySink as IX1AbilityGenerationGuard)?.InvalidateGeneration();
        _stopped = false;
    }

    public void OnStop()
    {
        StopCalls++;
        // 停止/故障/卸载失效旧代（r3）：旧代在途待写在写入边界复核点零写；先于清扫，
        // 保证清扫回调内重入提交同样撞上新代。槽实现运行代见证才生效。
        (AbilitySink as IX1AbilityGenerationGuard)?.InvalidateGeneration();
        if (_stopped && _activeMovements.Count == 0 && _activeFacings.Count == 0) return;
        _stopped = true;
        Exception? first = null;
        foreach (var m in _activeMovements.Values.ToList())
        {
            try
            {
                if (MovementSink != null) m.Release(MovementSink);
                else m.Release(new NullMovementSink());
            }
            catch (Exception ex) { first ??= ex; }
        }
        _activeMovements.Clear();
        foreach (var f in _activeFacings.Values.ToList())
        {
            try
            {
                if (FacingSink != null) f.Release(FacingSink);
                else f.Release(new NullFacingSink());
            }
            catch (Exception ex) { first ??= ex; }
        }
        _activeFacings.Clear();
        if (first != null) throw new InvalidOperationException(first.Message);
    }

    private sealed class NullMovementSink : IX1MovementSink
    {
        public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs) { }
        public void ReleaseMovement(string eventId) { }
    }

    private sealed class NullFacingSink : IX1FacingSink
    {
        public void EmitFacing(string eventId, double angleDeg, long showTimeMs) { }
        public void ReleaseFacing(string eventId) { }
    }
}
