// 这个文件是干嘛的：正式 X1 场次的输入所有权和舞台坐标边界；旧场回调不能操作新场共享槽。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class X1RegisteredShowDispatcher : IShowDispatcher, IX1ActiveUpdater
{
    private readonly X1CompositeShowDispatcher _inner;
    private readonly Func<bool> _current;
    private readonly Action _checkReady, _checkExecution, _arm, _end;
    private bool _started, _inputOwned;

    public X1RegisteredShowDispatcher(X1CompositeShowDispatcher inner, Func<bool> current,
        Action checkReady, Action checkExecution, Action arm, Action end)
    { _inner = inner; _current = current; _checkReady = checkReady; _checkExecution = checkExecution; _arm = arm; _end = end; }

    public void OnShowStart()
    {
        if (!_current()) throw new InvalidOperationException("旧场次已失效，不能取得输入所有权");
        if (_started || _inputOwned) throw new InvalidOperationException("输入仍由当前运行持有，请先确认停止");
        _checkReady();
        if (!_current()) throw new InvalidOperationException("开演检查期间场次已变化");
        try { _arm(); }
        catch { _end(); throw; }
        if (!_current())
        {
            _end(); // 此回调必须按场次释放输入登记，不能结束后来场次的登记。
            throw new InvalidOperationException("输入准备期间本次场次已取消，不进入游戏开演");
        }
        _inputOwned = true;
        _started = true;
        _inner.OnShowStart();
    }

    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        if (!_current() || !_started) return ShowDispatchResult.Fail("本次输入执行权已失效");
        _checkExecution();
        if (!_current() || !_started) return ShowDispatchResult.Fail("输入检查期间本次场次已失效");
        return _inner.Dispatch(e);
    }

    public (bool Ok, string Error, List<X1SkipRecord>? Skips, string FailedEventId) UpdateActive(long showTimeMs)
    {
        if (!_current() || !_started) return (true, "", null, "");
        _checkExecution();
        if (!_current() || !_started) return (true, "", null, "");
        return _inner.UpdateActive(showTimeMs);
    }

    public void OnStop()
    {
        // 未开演的准备没有共享输入；旧回调也不能清扫新场。
        if (!_current() || !_started && !_inputOwned) return;
        _started = false;
        Exception? failure = null;
        try { _inner.OnStop(); }
        catch (Exception error) { failure = error; }
        try { _end(); }
        catch (Exception error) { failure ??= error; }
        // 失败时保留所有权，下一次显式停止仍会重试两个清理入口。
        if (failure != null) throw new InvalidOperationException("X1 输入清理未确认：" + failure.Message, failure);
        _inputOwned = false;
    }
}

public sealed class X1StageExecutionSinks : IX1MovementSink, IX1FacingSink, IX1InputSafetyGuard, IX1MovementFacingOwner
{
    private readonly X1StageTransform _stage;
    private readonly IX1MovementSink _movement;
    private readonly IX1FacingSink _facing;
    private readonly Action _check;
    public X1StageExecutionSinks(X1StageTransform stage, IX1MovementSink movement, IX1FacingSink facing, Action check)
    { _stage = stage; _movement = movement; _facing = facing; _check = check; }
    public bool OwnsMovementFacing => _movement is IX1MovementFacingOwner { OwnsMovementFacing: true };
    public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs)
    {
        _check();
        var vector = _stage.ToWorldVector(dx, dz);
        var point = _stage.ToWorld(targetX, targetZ);
        _movement.EmitCorrection(eventId, vector.X, vector.Z, point.X, point.Z, showTimeMs);
    }
    public void EmitFacing(string eventId, double angleDeg, long showTimeMs)
    { _check(); _facing.EmitFacing(eventId, _stage.ToWorldAngle(angleDeg), showTimeMs); }
    // 释放不能被已经失效的安全条件阻止；场次所有权由外层 OnStop 负责。
    public void ReleaseMovement(string eventId) => _movement.ReleaseMovement(eventId);
    public void ReleaseFacing(string eventId) => _facing.ReleaseFacing(eventId);
    public void CheckInputSafety()
    {
        _check();
        (_movement as IX1InputSafetyGuard)?.CheckInputSafety();
        if (!ReferenceEquals(_movement, _facing)) (_facing as IX1InputSafetyGuard)?.CheckInputSafety();
    }
}
