// 这个文件是干嘛的：X1 守卫采集不可用离线回归（TASK-20260910-X1-OFFLINE-GUARD AC-1..AC-3）。
// 采集三种不可用形态（未接入/移除、抛异常、返回 null）在倒计时（正/0）与演中两相的 fail-closed
// 故障停断言：直接 Faulted、零分发、清扫恰一次、原因含「守卫采集」；恢复采集+时钟前进绝不
// 自动复演，显式 Arm+Start 是唯一恢复路径；RequestStop/SetGuardProvider/Tick 全排列单锁串行。
// status-json-freeze 命名用例与全量套件共用同一份冻结断言。纯离线：假时钟 + FakeShowDispatcher，
// 不碰游戏；命名模式（-- 用例名 [--red]）与全量模式共用同一批断言，--red 只抑制 OK 行。
using ChoreoHelper;

/// <summary>断言出口委托（与 program.cs 的 Check 同形）：detail 带默认值，用例内可两参调用。</summary>
internal delegate void CheckFn(string name, bool cond, string? detail = null);

internal static class ShowGuardAvailabilityCases
{
    private const string GuardTerm = "守卫采集";

    /// <summary>命名用例入口：只跑指定节。失败打印声明的哨兵行恰一次并退出 1；
    /// --red 与绿色模式跑同一批断言，仅抑制逐条 OK 输出。</summary>
    public static int RunNamed(string caseName, bool red)
    {
        var sentinel = caseName switch
        {
            "guard-availability-countdown" => "GUARD_COUNTDOWN_ASSERTION",
            "guard-availability-cancel" => "GUARD_CANCEL_ASSERTION",
            "guard-availability-replay" => "GUARD_REPLAY_ASSERTION",
            "status-json-freeze" => null, // 冻结契约未声明哨兵：失败仅 FAIL 行 + 退出 1
            _ => null,
        };
        if (sentinel == null && caseName != "status-json-freeze")
        {
            Console.WriteLine($"未知命名用例：{caseName}（可用 guard-availability-countdown / "
                + "guard-availability-cancel / guard-availability-replay / status-json-freeze）");
            return 2;
        }
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== 守卫采集不可用（{caseName}{(red ? " --red" : "")}） ==");
        switch (caseName)
        {
            case "guard-availability-countdown": RunCountdownCase(CheckNamed); break;
            case "guard-availability-cancel": RunCancelCase(CheckNamed); break;
            case "guard-availability-replay": RunReplayCase(CheckNamed); break;
            case "status-json-freeze": RunStatusJsonFreezeCase(CheckNamed); break;
        }
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            if (sentinel != null) Console.WriteLine(sentinel);
            return 1;
        }
        return 0;
    }

    // ---- AC-1 倒计时故障：三种不可用形态 ×（正倒计时 / 0 倒计时边界帧）----
    // 下一个活动 Tick 直接 Faulted：先于 Countdown→Playing 转换与任何到点分发；
    // 零 Dispatch 调用、清扫恰一次、原因含「守卫采集」。
    public static void RunCountdownCase(CheckFn check)
    {
        var forms = new[] { "未接入", "抛异常", "返回null" };
        foreach (var cd in new[] { 1000, 0 })
        for (var form = 0; form < forms.Length; form++)
        {
            var tag = $"[countdown={cd} {forms[form]}] ";
            var disp = new FakeShowDispatcher();
            long t = 1000;
            var runner = new ShowRunner(disp, () => t);
            runner.Load(BurstShow());
            check(tag + "显式装载进入 Loaded", runner.State == ShowState.Loaded);
            check(tag + "Arm 进入 Armed", runner.Arm().Ok && runner.State == ShowState.Armed);
            check(tag + "Start 进入 Countdown", runner.Start(cd).Ok && runner.State == ShowState.Countdown);
            if (form > 0) MakeUnavailable(runner, form); // form 0 = 从未接入（构造后从不挂采集）
            t += 16;
            runner.Tick(); // 下一个活动帧；cd=0 时恰是本会转入 Playing 的边界帧
            check(tag + "直接 Faulted（未经 Playing）", runner.State == ShowState.Faulted);
            check(tag + "零分发（计数 0 且零 Dispatch 调用）", runner.DispatchedCount == 0 && disp.Dispatched.Count == 0);
            check(tag + "清扫恰一次", runner.StopCleanupRuns == 1);
            check(tag + "原因非空且含 守卫采集", runner.StopReason.Length > 0 && runner.StopReason.Contains(GuardTerm));
            t += 16; runner.Tick();
            check(tag + "后续 Tick 维持 Faulted 且仍零分发", runner.State == ShowState.Faulted && disp.Dispatched.Count == 0);
            if (cd == 0)
                check(tag + "边界帧 showTime 未推进（未入 Playing）", runner.ShowTimeMs == 0);
        }
    }

    // ---- AC-2 演中取消：前缀已发 + 同刻突发到期帧故障 ----
    // 故障帧与后续每个 Tick 零进一步分发（前缀计数与 recentLog 冻结）；Faulted + 原因含
    // 「守卫采集」；OnStop 跨故障+重复停止恰一次；OnStop 抛异常变体仍 Faulted 且零分发。
    public static void RunCancelCase(CheckFn check)
    {
        var forms = new[] { "已移除", "抛异常", "返回null" };
        for (var form = 0; form < forms.Length; form++)
        {
            var tag = $"[cancel {forms[form]}] ";
            var disp = new FakeShowDispatcher();
            long t = 100000;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot()); // 健康采集护送进 Playing
            runner.Load(BurstShow());
            runner.Arm(); runner.Start(0);
            runner.Tick();            // 转换帧
            t += 600; runner.Tick();  // 前缀：g1@0、g2@500
            check(tag + "前置：Playing 且前缀 2 条", runner.State == ShowState.Playing
                && runner.DispatchedCount == 2 && disp.Dispatched.Count == 2);
            check(tag + "前缀日志在案（recentLog=g1,g2）", RecentIds(runner) == "g1,g2", RecentIds(runner));
            MakeUnavailable(runner, form);
            t += 500; runner.Tick();  // 故障帧：g5/g3/g4 同刻到期 → 必须零进一步分发
            check(tag + "Faulted 且原因含 守卫采集", runner.State == ShowState.Faulted && runner.StopReason.Contains(GuardTerm));
            check(tag + "前缀冻结（零进一步分发）", runner.DispatchedCount == 2 && disp.Dispatched.Count == 2);
            check(tag + "已发日志保留（recentLog 仍 g1,g2）", RecentIds(runner) == "g1,g2", RecentIds(runner));
            check(tag + "故障清扫恰一次", runner.StopCleanupRuns == 1 && disp.StopCalls == 1);
            for (var i = 0; i < 3; i++) { t += 100; runner.Tick(); }
            runner.RequestStop("重复停止一");
            runner.RequestStop("重复停止二");
            check(tag + "重复 Tick/Stop 仍 Faulted 且零分发", runner.State == ShowState.Faulted && disp.Dispatched.Count == 2);
            check(tag + "OnStop 跨故障+重复停止恰一次", disp.StopCalls == 1 && runner.StopCleanupRuns == 1);
        }
        // OnStop 抛异常变体：清扫异常不改变终态（仍 Faulted、零分发；显式 RequestStop 按设计重试复调 OnStop）
        {
            var disp = new ThrowingOnStopDispatcher();
            long t = 200000;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(BurstShow());
            runner.Arm(); runner.Start(0);
            runner.Tick(); t += 600; runner.Tick();
            check("[cancel OnStop抛异常] 前置：前缀 2 条已发", runner.DispatchedCount == 2 && disp.Dispatched.Count == 2);
            runner.SetGuardProvider(() => throw new InvalidOperationException("守卫采集器炸了"));
            t += 500; runner.Tick();
            check("[cancel OnStop抛异常] 仍 Faulted 且原因含 守卫采集", runner.State == ShowState.Faulted && runner.StopReason.Contains(GuardTerm));
            check("[cancel OnStop抛异常] 零进一步分发", disp.Dispatched.Count == 2);
            check("[cancel OnStop抛异常] OnStop 恰一次", disp.StopCalls == 1);
            runner.RequestStop("重复停止");
            t += 100; runner.Tick();
            check("[cancel OnStop抛异常] 重复停止仍零分发且维持 Faulted",
                runner.State == ShowState.Faulted && disp.Dispatched.Count == 2 && disp.StopCalls == 2 && runner.StopCleanupRuns == 2);
        }
    }

    // ---- AC-3 恢复与重演：恢复采集不自动复演；显式 Arm+Start 唯一恢复路径；全排列 ----
    public static void RunReplayCase(CheckFn check)
    {
        // 1) 采集不可用故障 → 恢复采集 + 时钟前进绝不自动复演
        var disp = new FakeShowDispatcher();
        long t = 300000;
        var runner = new ShowRunner(disp, () => t);
        runner.SetGuardProvider(() => new GuardSnapshot());
        runner.Load(BurstShow());
        runner.Arm(); runner.Start(0);
        runner.Tick(); t += 600; runner.Tick();
        var prefix = runner.DispatchedCount;
        check("[replay] 前置：Playing 且前缀 2 条", runner.State == ShowState.Playing && prefix == 2);
        MakeUnavailable(runner, 1);
        t += 500; runner.Tick();
        check("[replay] 故障进入 Faulted（原因含 守卫采集）", runner.State == ShowState.Faulted && runner.StopReason.Contains(GuardTerm));
        runner.SetGuardProvider(() => new GuardSnapshot()); // 采集恢复
        for (var i = 0; i < 5; i++) { t += 1000; runner.Tick(); }
        check("[replay] 恢复采集+时钟前进仍 Faulted（无自动复演）", runner.State == ShowState.Faulted);
        check("[replay] 恢复后零分发", disp.Dispatched.Count == prefix);

        // 2) 显式 Arm+Start（健康）→ 计数归零、按计划顺序重发完整队列至 Completed
        check("[replay] Faulted 可重新 Arm 且 DispatchedCount 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
        runner.Start(0);
        runner.Tick(); // 转换帧
        var order = new List<string>();
        for (var i = 0; i < 6 && runner.State == ShowState.Playing; i++)
        {
            t += 500;
            var before = disp.Dispatched.Count;
            runner.Tick();
            order.AddRange(disp.Dispatched.Skip(before).Select(e => e.Id));
        }
        check("[replay] 全队列按计划顺序重发（同刻优先级 motion>cue>lyrics）",
            string.Join(",", order) == "g1,g2,g5,g3,g4", string.Join(",", order));
        for (var i = 0; i < 40 && runner.State != ShowState.Completed; i++) { t += 1000; runner.Tick(); }
        check("[replay] 显式重演至 Completed", runner.State == ShowState.Completed);
        check("[replay] 重演后总分发 = 前缀 2 + 完整 5", disp.Dispatched.Count == prefix + 5);

        // 3) 再次 Arm+Start 但采集仍不可用 → 下一活动帧再次故障（AC-1 同形状，清扫对本次恰 +1）
        check("[replay] Completed 可再次 Arm", runner.Arm().Ok);
        MakeUnavailable(runner, 2);
        runner.Start(0);
        var cleanupBeforeRetry = runner.StopCleanupRuns;
        t += 16; runner.Tick();
        check("[replay] 仍不可用输入再次 Faulted", runner.State == ShowState.Faulted);
        check("[replay] 再故障零分发", runner.DispatchedCount == 0 && disp.Dispatched.Count == prefix + 5);
        check("[replay] 再故障原因含 守卫采集", runner.StopReason.Contains(GuardTerm));
        check("[replay] 再故障清扫恰 +1", runner.StopCleanupRuns == cleanupBeforeRetry + 1);

        // 4) 序列化排列：RequestStop / SetGuardProvider(恢复) / Tick 全部 3!=6 种顺序单锁串行施加
        //（单线程夹具，无真实线程与 sleep）。排列只允许一种停演事件（先停则不再故障，先故障
        // 则忽略停止）；离开执行态后零进一步分发；同一次停演清扫恰一次；之后显式 Arm+Start 复演。
        foreach (var perm in Permutations(new[] { "stop", "restore", "tick" }))
        {
            var tag = $"[replay 排列 {string.Join("<", perm)}] ";
            var pdisp = new FakeShowDispatcher();
            long pt = 500000;
            var pr = new ShowRunner(pdisp, () => pt);
            pr.SetGuardProvider(() => new GuardSnapshot());
            pr.Load(BurstShow());
            pr.Arm(); pr.Start(0);
            pr.Tick(); pt += 600; pr.Tick();
            check(tag + "前置：Playing 且前缀 2 条", pr.State == ShowState.Playing && pr.DispatchedCount == 2);
            MakeUnavailable(pr, 1);
            var leftActive = false;
            var frozenAt = -1;
            foreach (var op in perm)
            {
                if (op == "stop") pr.RequestStop("排列停止");
                else if (op == "restore") pr.SetGuardProvider(() => new GuardSnapshot());
                else { pt += 500; pr.Tick(); }
                if (pr.State is ShowState.Countdown or ShowState.Playing) continue;
                if (!leftActive) { leftActive = true; frozenAt = pdisp.Dispatched.Count; }
                check(tag + op + " 后离开执行态零进一步分发", pdisp.Dispatched.Count == frozenAt);
            }
            check(tag + "终态 Loaded/Faulted 且清扫恰一次",
                pr.State is ShowState.Loaded or ShowState.Faulted && pr.StopCleanupRuns == 1);
            if (pr.State == ShowState.Faulted)
                check(tag + "故障原因含 守卫采集", pr.StopReason.Contains(GuardTerm));
            var tailDispatch = pdisp.Dispatched.Count;
            var tailCleanup = pr.StopCleanupRuns;
            pt += 200; pr.Tick();
            pr.RequestStop("排列尾停");
            check(tag + "尾验证：再 Tick/Stop 零进一步分发", pdisp.Dispatched.Count == tailDispatch);
            check(tag + "尾验证：清扫不重复", pr.StopCleanupRuns == tailCleanup);
            check(tag + "显式 Arm（唯一恢复入口）且计数归零", pr.Arm().Ok && pr.DispatchedCount == 0);
            pr.SetGuardProvider(() => new GuardSnapshot());
            pr.Start(0); pr.Tick();
            for (var i = 0; i < 40 && pr.State != ShowState.Completed; i++) { pt += 1000; pr.Tick(); }
            check(tag + "显式重演至 Completed（全队列 5 条）",
                pr.State == ShowState.Completed && pdisp.Dispatched.Count == tailDispatch + 5);
        }
    }

    // ---- AC-4 特性化：有效快照下 ManualTakeover 注入（倒计时/演中两相）+ OnShowStart 语义 ----
    // ManualTakeover=true 是离线注入的取消控制，不是真实输入检测证据（票 nonGoals）。
    public static void RunManualTakeoverCase(CheckFn check)
    {
        {
            var disp = new FakeShowDispatcher();
            long t = 400000;
            var runner = new ShowRunner(disp, () => t);
            var guard = new GuardSnapshot();
            runner.SetGuardProvider(() => guard);
            runner.Load(BurstShow());
            runner.Arm();
            check("[takeover countdown] Arm 不调 OnShowStart", disp.ShowStartCalls == 0);
            runner.Start(1000);
            check("[takeover countdown] Start 恰调一次 OnShowStart", disp.ShowStartCalls == 1);
            guard.ManualTakeover = true;
            t += 16; runner.Tick();
            check("[takeover countdown] Faulted 且原因含 玩家手动接管",
                runner.State == ShowState.Faulted && runner.StopReason.Contains("玩家手动接管"));
            check("[takeover countdown] 清扫恰一次", runner.StopCleanupRuns == 1 && disp.StopCalls == 1);
        }
        {
            var disp = new FakeShowDispatcher();
            long t = 500000;
            var runner = new ShowRunner(disp, () => t);
            var guard = new GuardSnapshot();
            runner.SetGuardProvider(() => guard);
            runner.Load(BurstShow());
            runner.Arm(); runner.Start(0);
            runner.Tick(); t += 600; runner.Tick();
            check("[takeover playing] 前置：Playing 且前缀 2 条", runner.State == ShowState.Playing && runner.DispatchedCount == 2);
            guard.ManualTakeover = true;
            t += 500; runner.Tick();
            check("[takeover playing] Faulted 且原因含 玩家手动接管",
                runner.State == ShowState.Faulted && runner.StopReason.Contains("玩家手动接管"));
            check("[takeover playing] 前缀保留零进一步分发", runner.DispatchedCount == 2 && disp.Dispatched.Count == 2);
            check("[takeover playing] 清扫恰一次", runner.StopCleanupRuns == 1 && disp.StopCalls == 1);
        }
    }

    // ---- SHOWEXEC-DIAGNOSIS AC-3 冻结基线（自 program.cs 原文移入，断言逐字节不变）----
    public static void RunStatusJsonFreezeCase(CheckFn check)
    {
        ShowEvent DSe(string id, string kind, long start, string cmd = "/bow motion") =>
            new() { Id = id, Kind = kind, StartMs = start, DurationMs = 500, Command = cmd, PerformerId = "p1" };
        const string FrozenStatusJson = @"{""state"":""playing"",""stateText"":""\u6F14\u51FA\u6B63\u5728\u6267\u884C\uFF1A\u5982\u9700\u4E2D\u65AD\u8BF7\u7D27\u6025\u505C\u6B62"",""name"":""\u51BB\u7ED3\u57FA\u7EBF"",""projectId"":""frozen"",""protocolVersion"":1,""timelineRevision"":3,""durationMs"":30000,""showTimeMs"":500,""dispatched"":1,""total"":3,""remaining"":2,""stopReason"":"""",""recentLog"":[{""id"":""e1"",""kind"":""motion"",""plannedMs"":500,""dispatchedMs"":500,""ok"":true,""reason"":""""}],""logText"":""[500ms] e1(motion) /bow motion \u2192 \u5DF2\u53D1\u9001\n""}";
        long t = 7000;
        var disp = new FakeShowDispatcher();
        var runner = new ShowRunner(disp, () => t);
        runner.SetGuardProvider(() => new GuardSnapshot()); // X1 fail-closed 后夹具显式健康采集
        var pkg = new ShowPackage
        {
            ProtocolVersion = 1, Name = "冻结基线", ProjectId = "frozen",
            DurationMs = 30000, TimelineRevision = 3, ProjectHash = "frozenhash",
        };
        pkg.Events.Add(DSe("e1", "motion", 500, "/bow motion"));
        pkg.Events.Add(DSe("e2", "motion", 1500, "/wave motion"));
        pkg.Events.Add(new ShowEvent { Id = "e3", Kind = "lyrics", StartMs = 2000, DurationMs = 500, Command = "", PerformerId = "" });
        runner.Load(pkg); runner.Arm(); runner.Start(1000);
        t += 1000; runner.Tick();
        t += 500; runner.Tick();
        var actual = runner.StatusJson();
        check("showexec-diag：StatusJson 冻结基线（字段集与值逐字节锁定）",
            actual == FrozenStatusJson, actual);
    }

    // ---- 夹具与桩 ----

    /// <summary>前缀 2 条（g1@0、g2@500）+ 同刻突发 3 条（g5 motion、g3 cue、g4 lyrics @1000）。
    /// 突发帧用于证明故障先于任何后续分发（修前会一次发出 3 条，红基线可见）。</summary>
    private static ShowPackage BurstShow()
    {
        var p = new ShowPackage { ProtocolVersion = 1, Name = "守卫采集不可用", DurationMs = 30000 };
        p.Events.Add(new ShowEvent { Id = "g1", Kind = "motion", StartMs = 0, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g2", Kind = "motion", StartMs = 500, DurationMs = 500, Command = "/wave motion", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g5", Kind = "motion", StartMs = 1000, DurationMs = 500, Command = "/dance motion", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g3", Kind = "cue", StartMs = 1000, DurationMs = 100, Command = "", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g4", Kind = "lyrics", StartMs = 1000, DurationMs = 500, Command = "", PerformerId = "" });
        return p;
    }

    /// <summary>三种采集不可用形态：0=移除/缺失（SetGuardProvider(null)），1=采集抛异常，2=返回 null。</summary>
    private static void MakeUnavailable(ShowRunner runner, int form)
    {
        switch (form)
        {
            case 0: runner.SetGuardProvider(null); break;
            case 1: runner.SetGuardProvider(() => throw new InvalidOperationException("守卫采集器炸了")); break;
            case 2: runner.SetGuardProvider(NullSnapshot); break;
        }
    }

    private static GuardSnapshot NullSnapshot() => null!;

    /// <summary>/shows/status 的 recentLog 事件 id 序列（前缀/日志冻结断言用）。</summary>
    private static string RecentIds(ShowRunner runner)
    {
        using var doc = System.Text.Json.JsonDocument.Parse(runner.StatusJson());
        return string.Join(",", doc.RootElement.GetProperty("recentLog").EnumerateArray()
            .Select(e => e.GetProperty("id").GetString()));
    }

    private static IEnumerable<string[]> Permutations(string[] items)
    {
        if (items.Length <= 1) { yield return items; yield break; }
        for (var i = 0; i < items.Length; i++)
        foreach (var rest in Permutations(items.Where((_, j) => j != i).ToArray()))
            yield return new[] { items[i] }.Concat(rest).ToArray();
    }

    /// <summary>OnStop 抛异常的记录型执行器：清扫异常路径（Faulted 终态 + 恰一次）断言用。</summary>
    private sealed class ThrowingOnStopDispatcher : IShowDispatcher
    {
        public readonly List<ShowEvent> Dispatched = new();
        public int StopCalls;

        public ShowDispatchResult Dispatch(ShowEvent e)
        {
            Dispatched.Add(e);
            return ShowDispatchResult.Success();
        }

        public void OnShowStart() { }

        public void OnStop()
        {
            StopCalls++;
            throw new InvalidOperationException("清扫炸了");
        }
    }
}
