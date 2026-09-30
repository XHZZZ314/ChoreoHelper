// 这个文件是干嘛的：EXEC-CORE 测试桩（可编排假执行器，不碰游戏）。
// 捐赠源：r2-preserved program.cs 的 FakeShowDispatcher（逐字提取）。
using System;
using System.Collections.Generic;
using ChoreoHelper;

// EXEC-CORE 测试桩：记录分发序列/停止次数的可编排假执行器（不碰游戏）
sealed class FakeShowDispatcher : IShowDispatcher
{
    public List<ShowEvent> Dispatched = new();
    public int StopCalls;
    public int ShowStartCalls;
    public Func<ShowEvent, ShowDispatchResult>? OnDispatch;

    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        Dispatched.Add(e);
        return OnDispatch != null ? OnDispatch(e) : ShowDispatchResult.Success();
    }

    public void OnStop() => StopCalls++;

    // SHOWEXEC-DIAGNOSIS 新契约（修复后由 ShowRunner.Start 调用；修复前无调用方）。
    // 纯计数，无行为——既有断言不受影响。
    public void OnShowStart() => ShowStartCalls++;
}
