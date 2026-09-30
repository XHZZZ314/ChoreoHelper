// 游戏线程写入排队：超时只取消尚未执行的操作，已经开始的操作必须完成后才确认。
using System;
using System.Threading;
using System.Threading.Tasks;

namespace ChoreoHelper;

internal sealed class PendingFrameworkWrite<T>
{
    private int _state;
    private readonly Func<T> _action;
    private readonly TaskCompletionSource<T> _completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal PendingFrameworkWrite(Func<T> action) => _action = action;
    internal Task<T> Task => _completion.Task;
    internal void Run()
    {
        if (Interlocked.CompareExchange(ref _state, 1, 0) != 0) return;
        try { _completion.TrySetResult(_action()); }
        catch (Exception ex) { _completion.TrySetException(ex); }
        finally { Interlocked.Exchange(ref _state, 3); }
    }
    internal bool Cancel()
    {
        if (Interlocked.CompareExchange(ref _state, 2, 0) != 0) return false;
        _completion.TrySetCanceled();
        return true;
    }
}
