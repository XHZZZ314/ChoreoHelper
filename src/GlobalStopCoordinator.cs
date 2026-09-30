// 这个文件是干嘛的：用共享输出锁和请求世代取消旧写入，区分停止、清理中和清理失败。
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace ChoreoHelper;

public sealed record GlobalStopInspection(bool Busy, bool CleanupPending, IReadOnlyList<string> Errors);
public sealed record GlobalStopResult(bool Ok, string State, string Message, IReadOnlyList<string> Errors, long Generation);
public readonly record struct GlobalStopRequest(long Generation, bool Dispatch);

public sealed class GlobalStopCancelledException : InvalidOperationException
{
    public GlobalStopCancelledException() : base("此请求已被立即停止取消，或清理尚未确认；请待停止完成后明确重试") { }
}

/// <summary>所有动作与世代复核使用输出所有权的同一把锁；绝不清空或伪造释放租约。</summary>
public sealed class GlobalStopCoordinator
{
    public const string StopPath = "/control/stop", StatusPath = "/control/status";
    private readonly object _sync;
    private readonly Func<IReadOnlyList<string>> _stop;
    private readonly Func<GlobalStopInspection> _inspect;
    private long _generation;
    private bool _requested, _dispatchPending, _closed;
    private IReadOnlyList<string> _stopErrors = Array.Empty<string>();
    internal object SyncRoot => _sync;

    public GlobalStopCoordinator(object sync, Func<IReadOnlyList<string>> stop, Func<GlobalStopInspection> inspect)
    { _sync = sync; _stop = stop; _inspect = inspect; }

    public long CaptureGeneration() => Interlocked.Read(ref _generation);

    public bool IsCurrent(long generation)
    {
        lock (_sync) return !_closed && generation == _generation && (!_requested || SnapshotCore().State == "stopped");
    }

    public T RunCurrent<T>(long generation, Func<T> action)
    {
        lock (_sync)
        {
            if (!IsCurrent(generation)) throw new GlobalStopCancelledException();
            return action();
        }
    }

    // 卸载入口只取消托管请求；不调用清理、不归还租约，也不声称原生输出已停止。
    public void CloseRequests()
    {
        lock (_sync)
        {
            if (_closed) return;
            _closed = true; _generation++; _requested = true; _dispatchPending = false;
            _stopErrors = new[] { "插件正在卸载；请求入口已关闭，原生清理由卸载流程另行确认" };
        }
    }

    public GlobalStopRequest RequestStop()
    {
        lock (_sync)
        {
            // 同一在途请求不能借重复点击自动重试清理；失败后新的点击才领取新世代。
            if (_closed || _dispatchPending) return new(_generation, false);
            _generation++; _requested = _dispatchPending = true;
            _stopErrors = Array.Empty<string>();
            return new(_generation, true);
        }
    }

    public GlobalStopResult ExecuteStop(long generation)
    {
        lock (_sync)
        {
            if (generation != _generation || !_dispatchPending) return SnapshotCore();
            try { _stopErrors = _stop().ToArray(); }
            catch (Exception error) { _stopErrors = new[] { "停止流程异常：" + error.Message }; }
            finally { _dispatchPending = false; }
            return SnapshotCore();
        }
    }

    public GlobalStopResult FailDispatch(long generation, string reason)
    {
        lock (_sync)
        {
            if (generation == _generation && _dispatchPending)
            { _dispatchPending = false; _stopErrors = new[] { reason }; }
            return SnapshotCore();
        }
    }

    public GlobalStopResult Snapshot() { lock (_sync) return SnapshotCore(); }

    private GlobalStopResult SnapshotCore()
    {
        GlobalStopInspection inspection;
        try { inspection = _inspect(); }
        catch (Exception error) { inspection = new(true, true, new[] { "停止状态不可读：" + error.Message }); }
        var errors = _stopErrors.Concat(inspection.Errors).Distinct().ToArray();
        var state = errors.Length != 0 ? "failed" : _dispatchPending || inspection.Busy || inspection.CleanupPending ? "stopping" : "stopped";
        if (state == "stopped") _requested = false;
        var message = state == "failed" ? "停止清理未确认；已保留失败锁。请查看原因后再次点击立即停止以明确重试。"
            : state == "stopping" ? "停止请求已接收，仍在清理或等待游戏线程；尚未确认停止完成。"
            : "已停止本机输出、预览和录制，并清除待执行命令。已发生的技能效果或游戏动作不会被撤销。";
        return new(state != "failed", state, message, errors, _generation);
    }
}
