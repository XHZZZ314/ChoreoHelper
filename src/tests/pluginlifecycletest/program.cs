// TASK-20260908-PLUGIN-LIFECYCLE-HARDENING：插件生命周期确定性夹具（纯托管，无 Dalamud）。
// 直链生产源（不复制逻辑）：PluginCleanup.cs（含 PluginCleanupStep）、RequestDispatcher.cs、
// InFlightTracker.cs、HttpDispatchPolicy.cs。
// 证据边界：本套件只证明受管状态机行为（构造前缀/异常隔离/准入关停/排空超时/迟到完成），
// 不构成真实游戏卸载、热重载、端口重绑或角色控制释放的实测结论（属主人实机尾项）。
using ChoreoHelper;

var pass = 0; var fail = 0;

void Check(string name, bool cond, string? detail = null)
{
    if (cond) { pass++; Console.WriteLine($"  OK  {name}"); }
    else { fail++; Console.WriteLine($"  FAIL {name} {detail}"); }
}

// 生产获取序（Plugin ctor 的登记序——登记发生在各资源/订阅获取成功之后）；
// 清理执行序 = PluginCleanupStep 序值升序（依赖序），两者刻意不同。
var acquisition = new (PluginCleanupStep Step, string Name)[]
{
    (PluginCleanupStep.DisposeExecutor, "executor"),
    (PluginCleanupStep.DisposePreviewer, "previewer"),
    (PluginCleanupStep.DisposeFreezer, "freezer"),
    (PluginCleanupStep.DisposePlayback, "playback"),
    (PluginCleanupStep.StopShow, "show"),
    (PluginCleanupStep.UnsubscribeFramework, "framework"),
    (PluginCleanupStep.StopHttpServer, "httpServer"),
    (PluginCleanupStep.StopRecorder, "recorder"),
    (PluginCleanupStep.StopV3Server, "v3Server"),
    (PluginCleanupStep.RemoveCommand, "command"),
};
PluginCleanupStep[] FullDependencyOrder() => acquisition.Select(a => a.Step).OrderBy(s => (int)s).ToArray();

// ---- AC-1：构造前缀矩阵（每获取检查点一个夹具：后段构造抛异常 → 构造失败路径启动清理）----
Console.WriteLine("== AC-1 构造前缀矩阵（ctor 失败清理不被压制、依赖序、恰一次、无操作重入）==");
for (var k = 1; k <= acquisition.Length; k++)
{
    var c = new PluginCleanup();
    var order = new List<PluginCleanupStep>();
    var counts = new Dictionary<PluginCleanupStep, int>();
    var m = new object();
    for (var i = 0; i < k; i++)
    {
        var step = acquisition[i].Step;
        c.Register(step, () => { lock (m) { order.Add(step); counts[step] = counts.GetValueOrDefault(step) + 1; } });
    }
    var threw = false;
    try { c.RunConstructionCleanup(); } catch { threw = true; }
    var expected = acquisition.Take(k).Select(a => a.Step).OrderBy(s => (int)s).ToArray();
    var unregistered = acquisition.Skip(k).Select(a => a.Step).ToArray();
    Check($"life:acq[{k}] 构造失败路径清理不抛异常", !threw);
    Check($"life:acq[{k}] 已获取步骤全部各执行恰一次", order.Count == k && expected.All(e => counts.GetValueOrDefault(e) == 1));
    Check($"life:acq[{k}] 执行序=依赖序（序值升序）", order.SequenceEqual(expected));
    Check($"life:acq[{k}] 未获取步骤零调用", unregistered.All(s => counts.GetValueOrDefault(s) == 0));
    c.Run(); // Dalamud 卸载路径随后再调一次
    Check($"life:acq[{k}] 重复清理为无操作", order.Count == k);
}

// ---- AC-2：正常构造清理的单失败/多失败矩阵（异常隔离、错误接收器、双 Dispose）----
Console.WriteLine("== AC-2 正常构造清理：单步异常隔离与恰好一次 ==");
foreach (var failingStep in Enum.GetValues<PluginCleanupStep>())
{
    var c = new PluginCleanup();
    var order = new List<PluginCleanupStep>();
    var m = new object();
    foreach (var (step, _) in acquisition)
    {
        var s = step;
        c.Register(s, () =>
        {
            lock (m) order.Add(s);
            if (s == failingStep) throw new InvalidOperationException("cleanup-step-boom");
        });
    }
    var threw = false;
    try { c.Run(); } catch { threw = true; }
    var errs = c.Errors;
    Check($"life:single[{failingStep}] Dispose 不抛异常（隔离）", !threw);
    Check($"life:single[{failingStep}] 全部步骤各执行恰一次", order.Count == acquisition.Length && order.Distinct().Count() == acquisition.Length);
    Check($"life:single[{failingStep}] 执行序=依赖序", order.SequenceEqual(FullDependencyOrder));
    Check($"life:single[{failingStep}] 错误接收器恰一条且指名该步", errs.Count == 1 && errs[0].Step == failingStep);
    c.Run();
    Check($"life:single[{failingStep}] 第二次 Dispose 无操作", order.Count == acquisition.Length);
}

Console.WriteLine("== AC-2 多步异常隔离（错误接收器逐失败步骤一条）==");
{
    var failing = new[] { PluginCleanupStep.StopV3Server, PluginCleanupStep.StopShow, PluginCleanupStep.DisposeFreezer };
    var c = new PluginCleanup();
    var order = new List<PluginCleanupStep>();
    var m = new object();
    foreach (var (step, _) in acquisition)
    {
        var s = step;
        c.Register(s, () =>
        {
            lock (m) order.Add(s);
            if (failing.Contains(s)) throw new InvalidOperationException("cleanup-step-boom");
        });
    }
    var threw = false;
    try { c.Run(); } catch { threw = true; }
    var errs = c.Errors;
    Check("life:multi Dispose 不抛异常（隔离）", !threw);
    Check("life:multi 全部步骤各执行恰一次（异常不截断）", order.Count == acquisition.Length && order.Distinct().Count() == acquisition.Length);
    Check("life:multi 执行序=依赖序", order.SequenceEqual(FullDependencyOrder));
    Check("life:multi 错误接收器逐抛异常步骤恰一条", errs.Count == failing.Length && errs.Select(e => e.Step).ToHashSet().SetEquals(failing));
    Check("life:multi 错误接收器条目序=尝试序", errs.Select(e => (int)e.Step).SequenceEqual(failing.Select(s => (int)s).OrderBy(v => v)));
    c.Run();
    Check("life:multi 第二次 Dispose 无操作", order.Count == acquisition.Length);
}

// ---- AC-3：准入/关停竞速（barrier 矩阵：两条车道，调用方与关停方同点放行）----
// 断言对任意交错不变：零异常、接受+拒绝=调用数、接受不超容量、已接受恰登记一次在途、
// 关停后准入立即 false（不重试不抛）、重复关停安全、已接受工作可完成排空。
Console.WriteLine("== AC-3 准入关停原子性（barrier 竞速矩阵）==");
foreach (var lane in new[] { RequestLane.Fast, RequestLane.Outbound })
{
    var cap = lane == RequestLane.Fast ? 2 : 1;
    var callers = lane == RequestLane.Fast ? 5 : 3; // 超容量：必有拒绝
    var d = new RequestDispatcher(cap, cap);
    var release = new TaskCompletionSource();
    var acceptedCount = 0; var rejectedCount = 0; var errorCount = 0;
    var barrier = new Barrier(callers + 1);
    var threads = new Thread[callers];
    for (var i = 0; i < callers; i++)
    {
        threads[i] = new Thread(() =>
        {
            barrier.SignalAndWait();
            try
            {
                if (d.TryAccept(lane, async () => await release.Task))
                    Interlocked.Increment(ref acceptedCount);
                else
                    Interlocked.Increment(ref rejectedCount);
            }
            catch { Interlocked.Increment(ref errorCount); }
        });
        threads[i].Start();
    }
    barrier.SignalAndWait(); // 全部调用方与关停方同点放行，此后锁序任意
    d.Dispose();
    foreach (var t in threads) t.Join();
    Check($"life:race[{lane}] 竞速零异常（无 ObjectDisposedException）", errorCount == 0);
    Check($"life:race[{lane}] 接受+拒绝=调用数且接受不超容量",
        acceptedCount + rejectedCount == callers && acceptedCount <= cap,
        $"accepted={acceptedCount} rejected={rejectedCount}");
    Check($"life:race[{lane}] 已接受工作恰登记一次在途", SpinWaitUntil(() => d.InFlight == acceptedCount));
    Check($"life:race[{lane}] 关停后准入立即拒绝（不重试不抛）", !d.TryAccept(lane, () => Task.CompletedTask));
    d.Dispose();
    Check($"life:race[{lane}] 重复关停安全", true);
    release.TrySetResult();
    Check($"life:race[{lane}] 已接受工作迟到完成且排空归零", d.WaitDrained(TimeSpan.FromSeconds(5)));
}

// ---- AC-4：有界排空超时 + 迟到完成 + 延迟终结化（确定性：工作体阻塞在门上，非时钟竞速）----
// 可观测口径：迟到释放若撞已释放信号量（ObjectDisposedException）或双释放（SemaphoreFullException），
// 在途句柄都不会归还 → InFlight 永不归零——「归零 + 排空为真」即「无异常且恰一次回收」的外显。
Console.WriteLine("== AC-4 有界排空超时与迟到完成 ==");
{
    var d = new RequestDispatcher(1, 1);
    var gate = new TaskCompletionSource();
    var bodyDone = new TaskCompletionSource();
    Check("life:late 接受受阻工作体", d.TryAccept(RequestLane.Fast, async () => { await gate.Task; bodyDone.TrySetResult(); }));
    Check("life:late 占槽期间满员拒绝（恰一名额）", !d.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    Check("life:late 在途已登记", SpinWaitUntil(() => d.InFlight == 1));
    d.Dispose(); // 关闭准入；工作体仍阻塞 → 信号量等资源延迟终结化
    Check("life:late 排空有界超时返回 false（工作体必仍阻塞）", !d.WaitDrained(TimeSpan.FromMilliseconds(150)));
    Check("life:late 超时返回时计数仍在（资源未提前释放）", d.InFlight == 1);
    gate.TrySetResult(); // 迟到完成（晚于排空超时与关停）
    Check("life:late 工作体本体完成", SpinWaitUntil(() => bodyDone.Task.IsCompleted));
    Check("life:late 迟到完成不撞已释放资源 → 在途恰一次归零", SpinWaitUntil(() => d.InFlight == 0));
    Check("life:late 归零后排空为真", d.WaitDrained(TimeSpan.FromSeconds(5)));
    d.Dispose();
    Check("life:late 迟到完成终结化后重复关停安全", true);
    var d2 = new RequestDispatcher(1, 1); // 新实例无残留状态
    Check("life:fresh 新实例正常接受", d2.TryAccept(RequestLane.Fast, () => Task.CompletedTask));
    Check("life:fresh 新实例排空归零", d2.WaitDrained(TimeSpan.FromSeconds(5)));
    d2.Dispose();
}

Console.WriteLine($"\n结果：{pass} 通过 / {fail} 失败");
return fail > 0 ? 1 : 0;

// 轮询等待异步调度到位（工作体在 Task.Run 上启动的时序），超时返回末次判定
static bool SpinWaitUntil(Func<bool> cond, int timeoutMs = 5000)
{
    var sw = System.Diagnostics.Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < timeoutMs)
    {
        if (cond()) return true;
        Thread.Sleep(5);
    }
    return cond();
}
