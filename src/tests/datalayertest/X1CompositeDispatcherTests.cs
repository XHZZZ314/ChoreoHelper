// 这个文件是干嘛的：X1 纯复合分发器命名回归（x1-composite-dispatcher）：种类路由矩阵、
// 准入种 parity（与纯生产半字节一致）、幂等扇出、终端态、停后重演、休眠零槽、观测 fail-closed
// （TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING）。纯离线：记录假生产半 + 真 X1ShowDispatcher
// 核心（槽/观测皆记录假件；GameShowDispatcher 为 Dalamud 绑定不进 datalayertest）。
// 命名模式（-- 用例名 [--red]）与全量模式共用同一批断言，--red 仅抑制 OK 输出。
// 失败打印声明哨兵行恰一次并退出 1（供 record-red 绑定 REG-COMPOSITE）。
using ChoreoHelper;

internal static class X1CompositeDispatcherCases
{
    private const string Sentinel = "X1_COMPOSITE_PARITY_ASSERTION";

    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 纯复合分发器（{caseName}{(red ? " --red" : "")}） ==");
        RunCompositeCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            Console.WriteLine(Sentinel);
            return 1;
        }
        return 0;
    }

    public static void RunCompositeCase(CheckFn check)
    {
        RunKindRouting(check);
        RunAdmittedParity(check);
        RunIdempotentFanOut(check);
        RunTerminalStates(check);
        RunReplayAfterStop(check);
        RunDormantZeroSink(check);
        RunObservationFailClosed(check);
    }

    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);

    // ---- 种类路由矩阵 ----
    private static void RunKindRouting(CheckFn check)
    {
        var built = BuildComposite();
        // 准入种走生产半
        var rMo = built.Composite.Dispatch(new ShowEvent { Id = "e-mo", Kind = "motion", StartMs = 0, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        check("[comp-route] motion 走生产半", rMo.Ok && built.Production.Dispatched.Count == 1 && built.X1.Dispatched.Count == 0);
        var rCue = built.Composite.Dispatch(new ShowEvent { Id = "e-cue", Kind = "cue", StartMs = 0, DurationMs = 100, PerformerId = "p1" });
        check("[comp-route] cue 走生产半", rCue.Ok && built.Production.Dispatched.Count == 2 && built.X1.Dispatched.Count == 0);
        var rLyr = built.Composite.Dispatch(new ShowEvent { Id = "e-lyr", Kind = "lyrics", StartMs = 0, DurationMs = 500, PerformerId = "" });
        check("[comp-route] lyrics 走生产半", rLyr.Ok && built.Production.Dispatched.Count == 3 && built.X1.Dispatched.Count == 0);
        // X1 种走 X1 核心（需先登记离线输入）
        var rMv = built.Composite.Dispatch(new ShowEvent { Id = "m-1", Kind = "movement", StartMs = 0, DurationMs = 1000, PerformerId = "p1" });
        check("[comp-route] movement 走 X1 核心", rMv.Ok && built.X1.Dispatched.Exists(e => e.Id == "m-1") && built.Production.Dispatched.Count == 3, JoinIds(built.Production) + "|" + JoinIds(built.X1));
        var rFc = built.Composite.Dispatch(new ShowEvent { Id = "f-1", Kind = "facing", StartMs = 0, DurationMs = 500, PerformerId = "p1" });
        check("[comp-route] facing 走 X1 核心", rFc.Ok && built.X1.Dispatched.Exists(e => e.Id == "f-1") && built.Production.Dispatched.Count == 3);
        var rAb = built.Composite.Dispatch(new ShowEvent { Id = "a-1", Kind = "ability", StartMs = 0, DurationMs = 100, PerformerId = "p1" });
        check("[comp-route] ability 走 X1 核心", rAb.Ok && built.X1.Dispatched.Exists(e => e.Id == "a-1") && built.Production.Dispatched.Count == 3);
        // 未知种防御走生产半（与生产行为一致）
        var rUn = built.Composite.Dispatch(new ShowEvent { Id = "e-un", Kind = "nope", StartMs = 0, DurationMs = 100, PerformerId = "p1" });
        check("[comp-route] 未知种走生产半", built.Production.Dispatched.Exists(e => e.Id == "e-un") && !built.X1.Dispatched.Exists(e => e.Id == "e-un"), rUn.Reason);
        // 种类判定助手
        check("[comp-route] 种类助手 production/X1 互斥",
            X1CompositeShowDispatcher.IsProductionKind("motion") && X1CompositeShowDispatcher.IsProductionKind("cue") && X1CompositeShowDispatcher.IsProductionKind("lyrics")
            && X1CompositeShowDispatcher.IsX1Kind("ability") && X1CompositeShowDispatcher.IsX1Kind("movement") && X1CompositeShowDispatcher.IsX1Kind("facing")
            && !X1CompositeShowDispatcher.IsX1Kind("motion") && !X1CompositeShowDispatcher.IsProductionKind("movement"));
    }

    // ---- 准入种 parity：同一准入包经复合与纯生产半，分发/启停序列/状态 JSON 字节一致 ----
    private static void RunAdmittedParity(CheckFn check)
    {
        var pkg = AdmittedPackage();
        // 纯生产路径
        var plainProd = new RecProductionDispatcher();
        long tPlain = 5000;
        var plainRunner = new ShowRunner(plainProd, () => tPlain);
        plainRunner.SetGuardProvider(() => new GuardSnapshot());
        plainRunner.Load(pkg); plainRunner.Arm(); plainRunner.Start(0); plainRunner.Tick();
        while (plainRunner.State == ShowState.Playing && tPlain < 60000) { tPlain += 100; plainRunner.Tick(); }
        // 复合路径（同一包、同一时钟脚本）
        var built = BuildComposite();
        long tComp = 5000;
        var compRunner = new ShowRunner(built.Composite, () => tComp);
        compRunner.SetGuardProvider(() => new GuardSnapshot());
        compRunner.Load(ClonePackage(pkg)); compRunner.Arm(); compRunner.Start(0); compRunner.Tick();
        while (compRunner.State == ShowState.Playing && tComp < 60000) { tComp += 100; compRunner.Tick(); }
        check("[comp-parity] 双路径同终态 Completed", plainRunner.State == ShowState.Completed && compRunner.State == ShowState.Completed,
            plainRunner.State + "/" + compRunner.State + " " + compRunner.StopReason);
        check("[comp-parity] 分发 id 序列一致", JoinIds(plainProd) == JoinIds(built.Production), JoinIds(plainProd) + " vs " + JoinIds(built.Production));
        check("[comp-parity] OnShowStart 各恰一次", plainProd.ShowStartCalls == 1 && built.Production.ShowStartCalls == 1 && built.X1.ShowStartCalls == 1,
            $"{plainProd.ShowStartCalls}/{built.Production.ShowStartCalls}/{built.X1.ShowStartCalls}");
        check("[comp-parity] OnStop 各恰一次", plainProd.StopCalls == 1 && built.Production.StopCalls == 1 && built.X1.StopCalls == 1,
            $"{plainProd.StopCalls}/{built.Production.StopCalls}/{built.X1.StopCalls}");
        check("[comp-parity] 状态 JSON 字节一致", plainRunner.StatusJson() == compRunner.StatusJson(), DiffShow(plainRunner.StatusJson(), compRunner.StatusJson()));
        check("[comp-parity] 计数一致", plainRunner.DispatchedCount == compRunner.DispatchedCount && plainRunner.SkippedCount == compRunner.SkippedCount);
    }

    // ---- 幂等扇出：重复 OnShowStart/OnStop 不触发移动输入/命令/异常 ----
    private static void RunIdempotentFanOut(CheckFn check)
    {
        var built = BuildCompositeWithActive();
        var moveEmits = built.MoveSink.Emits.Count;
        var prodDispatched = built.Production.Dispatched.Count;
        Exception? seen = null;
        try
        {
            built.Composite.OnShowStart();
            built.Composite.OnShowStart();
            built.Composite.OnStop();
            built.Composite.OnStop();
            built.Composite.OnStop();
        }
        catch (Exception ex) { seen = ex; }
        check("[comp-idem] 重复启停无异常", seen == null, seen?.Message);
        check("[comp-idem] 零新增移动输入", built.MoveSink.Emits.Count == moveEmits, $"{moveEmits}->{built.MoveSink.Emits.Count}");
        check("[comp-idem] 零新增生产分发", built.Production.Dispatched.Count == prodDispatched);
        check("[comp-idem] 移动释放恰一次", built.MoveSink.Releases.Count == 1, built.MoveSink.Releases.Count.ToString());
        check("[comp-idem] 朝向释放恰一次", built.FaceSink.Releases.Count == 1, built.FaceSink.Releases.Count.ToString());
    }

    // ---- 终端态：Completed / Stopped / Faulted 三态复合与纯路径一致 ----
    private static void RunTerminalStates(CheckFn check)
    {
        // Completed：短包跑完
        {
            var plain = new RecProductionDispatcher();
            long t0 = 0;
            var r0 = new ShowRunner(plain, () => t0);
            r0.SetGuardProvider(() => new GuardSnapshot());
            r0.Load(AdmittedPackage()); r0.Arm(); r0.Start(0); r0.Tick();
            while (r0.State == ShowState.Playing) { t0 += 100; r0.Tick(); }
            var built = BuildComposite();
            long t1 = 0;
            var r1 = new ShowRunner(built.Composite, () => t1);
            r1.SetGuardProvider(() => new GuardSnapshot());
            r1.Load(AdmittedPackage()); r1.Arm(); r1.Start(0); r1.Tick();
            while (r1.State == ShowState.Playing) { t1 += 100; r1.Tick(); }
            check("[comp-term] Completed 双路径一致", r0.State == ShowState.Completed && r1.State == ShowState.Completed && r0.StatusJson() == r1.StatusJson());
        }
        // Stopped：演中 RequestStop
        {
            var plain = new RecProductionDispatcher();
            long t0 = 10000;
            var r0 = new ShowRunner(plain, () => t0);
            r0.SetGuardProvider(() => new GuardSnapshot());
            r0.Load(AdmittedPackage()); r0.Arm(); r0.Start(0); r0.Tick();
            t0 += 600; r0.Tick();
            r0.RequestStop("网页紧急停止");
            var built = BuildComposite();
            long t1 = 10000;
            var r1 = new ShowRunner(built.Composite, () => t1);
            r1.SetGuardProvider(() => new GuardSnapshot());
            r1.Load(AdmittedPackage()); r1.Arm(); r1.Start(0); r1.Tick();
            t1 += 600; r1.Tick();
            r1.RequestStop("网页紧急停止");
            check("[comp-term] Stopped 双路径 Loaded 且原因一致", r0.State == ShowState.Loaded && r1.State == ShowState.Loaded && r0.StopReason == r1.StopReason);
            check("[comp-term] Stopped 状态 JSON 一致", r0.StatusJson() == r1.StatusJson(), DiffShow(r0.StatusJson(), r1.StatusJson()));
        }
        // Faulted：守卫故障
        {
            var g0 = new GuardSnapshot();
            var plain = new RecProductionDispatcher();
            long t0 = 20000;
            var r0 = new ShowRunner(plain, () => t0);
            r0.SetGuardProvider(() => g0);
            r0.Load(AdmittedPackage()); r0.Arm(); r0.Start(0); r0.Tick();
            t0 += 600; r0.Tick();
            g0.InCombat = true;
            t0 += 500; r0.Tick();
            var g1 = new GuardSnapshot();
            var built = BuildComposite();
            long t1 = 20000;
            var r1 = new ShowRunner(built.Composite, () => t1);
            r1.SetGuardProvider(() => g1);
            r1.Load(AdmittedPackage()); r1.Arm(); r1.Start(0); r1.Tick();
            t1 += 600; r1.Tick();
            g1.InCombat = true;
            t1 += 500; r1.Tick();
            check("[comp-term] Faulted 双路径一致且原因中文", r0.State == ShowState.Faulted && r1.State == ShowState.Faulted && r0.StopReason == r1.StopReason && HasChinese(r1.StopReason), r1.StopReason);
        }
    }

    // ---- 停后重演：终端后 Arm+Start 行为如新场，零陈旧适配器输入 ----
    private static void RunReplayAfterStop(CheckFn check)
    {
        var built = BuildComposite();
        long t = 30000;
        var runner = new ShowRunner(built.Composite, () => t);
        runner.SetGuardProvider(() => new GuardSnapshot());
        runner.Load(AdmittedPackage()); runner.Arm(); runner.Start(0); runner.Tick();
        t += 600; runner.Tick();
        runner.RequestStop("网页紧急停止");
        check("[comp-replay] 停止回 Loaded", runner.State == ShowState.Loaded);
        var prodBefore = built.Production.Dispatched.Count;
        check("[comp-replay] 显式 Arm 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
        runner.Start(0); runner.Tick();
        while (runner.State == ShowState.Playing && t < 90000) { t += 100; runner.Tick(); }
        check("[comp-replay] 重演至 Completed", runner.State == ShowState.Completed, runner.State + " " + runner.StopReason);
        check("[comp-replay] 重演分发完整（5 条新分发）", built.Production.Dispatched.Count == prodBefore + 5, built.Production.Dispatched.Count + " vs " + prodBefore);
        check("[comp-replay] 休眠 X1 零槽调用", built.MoveSink.Emits.Count == 0 && built.MoveSink.Releases.Count == 0 && built.FaceSink.Emits.Count == 0, DumpSinks(built));
    }

    // ---- 休眠零槽：零 X1 事件时复合与纯路径不可区分 ----
    private static void RunDormantZeroSink(CheckFn check)
    {
        var built = BuildComposite();
        long t = 40000;
        var runner = new ShowRunner(built.Composite, () => t);
        runner.SetGuardProvider(() => new GuardSnapshot());
        runner.Load(AdmittedPackage()); runner.Arm(); runner.Start(0); runner.Tick();
        while (runner.State == ShowState.Playing && t < 100000) { t += 100; runner.Tick(); }
        check("[comp-dormant] 完成态", runner.State == ShowState.Completed);
        check("[comp-dormant] 移动零槽调用", built.MoveSink.Emits.Count == 0 && built.MoveSink.Releases.Count == 0, DumpSinks(built));
        check("[comp-dormant] 朝向零槽调用", built.FaceSink.Emits.Count == 0 && built.FaceSink.Releases.Count == 0, DumpSinks(built));
        check("[comp-dormant] 技能零提交", built.AbilitySink.Calls.Count == 0, built.AbilitySink.Calls.Count.ToString());
    }

    // ---- 观测 fail-closed：缺失/抛异常/非有限/未知目标不编造位置、不逃异常 ----
    private static void RunObservationFailClosed(CheckFn check)
    {
        // 缺失观测供给 + 激活移动 → UpdateActive 故障（中文），零异常逃逸
        {
            var built = BuildCompositeWithActive();
            built.X1.ObservedProvider = null;
            var (ok, err, _, _) = built.Composite.UpdateActive(500);
            check("[comp-obs] 缺观测故障停且中文", !ok && HasChinese(err), err);
        }
        // 抛异常供给 → 故障，不逃异常
        {
            var built = BuildCompositeWithActive();
            built.X1.ObservedProvider = () => throw new InvalidOperationException("观测炸了");
            Exception? escaped = null;
            bool ok = true;
            string err = "";
            try { (ok, err, _, _) = built.Composite.UpdateActive(500); }
            catch (Exception ex) { escaped = ex; }
            check("[comp-obs] 抛异常供给不逃逸且故障", escaped == null && !ok && HasChinese(err), escaped?.Message ?? err);
        }
        // 非有限观测 → 故障，不编造位置（零新增输出）
        {
            var built = BuildCompositeWithActive();
            built.X1.ObservedProvider = () => (double.NaN, 0);
            var before = built.MoveSink.Emits.Count;
            var (ok, err, _, _) = built.Composite.UpdateActive(500);
            check("[comp-obs] 非有限观测故障且零新增输出", !ok && HasChinese(err) && built.MoveSink.Emits.Count == before, err);
        }
        // 舞台中心朝向 Skip 下观测失败 → 无激活移动时跳过（保持上次角度，零输出）；
        // 有激活移动时故障（移动需自身观测，冻结语义）；他演员目标观测 Skip 不挡同窗移动
        {
            var x1 = new X1ShowDispatcher("p1");
            var ms = new RecMovementSink();
            var fs = new RecFacingSink();
            x1.MovementSink = ms; x1.FacingSink = fs;
            x1.AbilitySink = new RecAbilitySink();
            x1.AddFacing(new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 0, FailurePolicy = X1FailurePolicy.Skip });
            x1.ObservedProvider = () => (0, 0);
            var comp = new X1CompositeShowDispatcher(new RecProductionDispatcher(), x1);
            x1.Dispatch(new ShowEvent { Id = "f-sc", Kind = "facing", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            var (ok1, _, _, _) = comp.UpdateActive(500);
            check("[comp-obs] 正常窗朝向输出", ok1 && fs.Emits.Count == 1, $"f={fs.Emits.Count}");
            x1.ObservedProvider = () => throw new InvalidOperationException("观测丢失");
            var (ok2, _, skips, _) = comp.UpdateActive(600);
            check("[comp-obs] 朝向观测丢失 Skip 不故障", ok2 && skips != null && skips.Count == 1 && skips[0].SkipClass == "facing-observation", ok2 + " sk=" + (skips?.Count ?? -1));
            check("[comp-obs] 跳过零输出保持上次角度", fs.Emits.Count == 1, $"f={fs.Emits.Count}");
        }
        {
            // 激活移动 + 自身观测丢失 → 故障（冻结语义：移动更新必需观测）
            var x1 = new X1ShowDispatcher("p1");
            var ms = new RecMovementSink();
            var fs = new RecFacingSink();
            x1.MovementSink = ms; x1.FacingSink = fs;
            x1.AbilitySink = new RecAbilitySink();
            var mv = new X1MovementInput { EventId = "m-sc", PerformerId = "p1", ArrivalToleranceM = 50, MaxCorrectionM = 1.5 };
            mv.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mv.Points.Add(new X1Waypoint { TMs = 2000, X = 2, Z = 0 });
            x1.AddMovement(mv);
            x1.AddFacing(new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 0, FailurePolicy = X1FailurePolicy.Skip });
            x1.ObservedProvider = () => (0, 0);
            var comp = new X1CompositeShowDispatcher(new RecProductionDispatcher(), x1);
            x1.Dispatch(new ShowEvent { Id = "m-sc", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            x1.Dispatch(new ShowEvent { Id = "f-sc", Kind = "facing", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            x1.ObservedProvider = () => throw new InvalidOperationException("观测丢失");
            var (ok, err, _, _) = comp.UpdateActive(600);
            check("[comp-obs] 激活移动时观测丢失故障停", !ok && HasChinese(err), err);
        }
        {
            // 他演员目标观测 Skip 不挡同窗移动：移动修正继续，朝向跳过
            var x1 = new X1ShowDispatcher("p1");
            var ms = new RecMovementSink();
            var fs = new RecFacingSink();
            x1.MovementSink = ms; x1.FacingSink = fs;
            x1.AbilitySink = new RecAbilitySink();
            var mv = new X1MovementInput { EventId = "m-oa", PerformerId = "p1", ArrivalToleranceM = 50, MaxCorrectionM = 1.5 };
            mv.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mv.Points.Add(new X1Waypoint { TMs = 2000, X = 2, Z = 0 });
            x1.AddMovement(mv);
            x1.AddFacing(new X1FacingInput { EventId = "f-oa2", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "ghost", FailurePolicy = X1FailurePolicy.Skip });
            x1.ObservedProvider = () => (0, 0);
            x1.OtherActorPositionProvider = _ => throw new InvalidOperationException("未知目标");
            var comp = new X1CompositeShowDispatcher(new RecProductionDispatcher(), x1);
            x1.Dispatch(new ShowEvent { Id = "m-oa", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            x1.Dispatch(new ShowEvent { Id = "f-oa2", Kind = "facing", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            var (ok, _, skips, _) = comp.UpdateActive(500);
            check("[comp-obs] 目标观测 Skip 不挡移动", ok && skips != null && skips.Count == 1 && ms.Emits.Count == 1 && fs.Emits.Count == 0,
                $"ok={ok} sk={skips?.Count ?? -1} m={ms.Emits.Count} f={fs.Emits.Count}");
        }
        // 未知他演员目标 → fail-closed（Skip 下跳过，StopShow 下故障），绝不编造
        {
            var x1 = new X1ShowDispatcher("p1");
            var ms = new RecMovementSink();
            var fs = new RecFacingSink();
            x1.MovementSink = ms; x1.FacingSink = fs;
            x1.AbilitySink = new RecAbilitySink();
            x1.ObservedProvider = () => (0, 0);
            x1.OtherActorPositionProvider = _ => throw new InvalidOperationException("未知目标「ghost」：无目标观测");
            x1.AddFacing(new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "ghost", FailurePolicy = X1FailurePolicy.Skip });
            x1.Dispatch(new ShowEvent { Id = "f-oa", Kind = "facing", StartMs = 0, DurationMs = 1000, PerformerId = "p1" });
            var comp = new X1CompositeShowDispatcher(new RecProductionDispatcher(), x1);
            var (ok, _, skips, _) = comp.UpdateActive(500);
            check("[comp-obs] 未知目标 Skip 且零朝向输出", ok && skips != null && skips.Count == 1 && fs.Emits.Count == 0, $"ok={ok} f={fs.Emits.Count}");
        }
    }

    // ---- 夹具 ----
    private sealed class Built
    {
        public X1CompositeShowDispatcher Composite = null!;
        public RecProductionDispatcher Production = null!;
        public X1ShowDispatcher X1 = null!;
        public RecAbilitySink AbilitySink = null!;
        public RecMovementSink MoveSink = null!;
        public RecFacingSink FaceSink = null!;
    }

    private static Built BuildComposite()
    {
        var prod = new RecProductionDispatcher();
        var x1 = new X1ShowDispatcher("p1");
        var ab = new RecAbilitySink();
        var ms = new RecMovementSink();
        var fs = new RecFacingSink();
        x1.AbilitySink = ab; x1.MovementSink = ms; x1.FacingSink = fs;
        x1.ObservedProvider = () => (0, 0);
        x1.OtherActorPositionProvider = _ => throw new InvalidOperationException("未知目标");
        var mv = new X1MovementInput { EventId = "m-1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        mv.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        mv.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        x1.AddMovement(mv);
        x1.AddFacing(new X1FacingInput { EventId = "f-1", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
        x1.AddAbility(new X1AbilityInput { EventId = "a-1", PerformerId = "p1", ActionId = "ac-1" }, HealthyConds(), "t-1");
        return new Built { Composite = new X1CompositeShowDispatcher(prod, x1), Production = prod, X1 = x1, AbilitySink = ab, MoveSink = ms, FaceSink = fs };
    }

    private static Built BuildCompositeWithActive()
    {
        var built = BuildComposite();
        built.Composite.Dispatch(new ShowEvent { Id = "m-1", Kind = "movement", StartMs = 0, DurationMs = 1000, PerformerId = "p1" });
        built.Composite.Dispatch(new ShowEvent { Id = "f-1", Kind = "facing", StartMs = 0, DurationMs = 1000, PerformerId = "p1" });
        built.Composite.OnShowStart();
        built.Composite.UpdateActive(100);
        built.MoveSink.Emits.Clear();
        built.FaceSink.Emits.Clear();
        return built;
    }

    private static X1AbilityConditions HealthyConds() => new()
    {
        JobMatches = true, LevelMeets = true, TargetValid = true, NotCasting = true,
        CooldownReady = true, MovementAllowed = true, Controllable = true,
    };

    private static ShowPackage AdmittedPackage()
    {
        var p = new ShowPackage { ProtocolVersion = 1, Name = "准入包", DurationMs = 10000 };
        p.Events.Add(new ShowEvent { Id = "g1", Kind = "motion", StartMs = 0, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g2", Kind = "motion", StartMs = 1000, DurationMs = 500, Command = "/wave motion", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g3", Kind = "cue", StartMs = 2000, DurationMs = 100, PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "g4", Kind = "lyrics", StartMs = 3000, DurationMs = 500, PerformerId = "" });
        p.Events.Add(new ShowEvent { Id = "g5", Kind = "motion", StartMs = 4000, DurationMs = 500, Command = "/dance motion", PerformerId = "p1" });
        return p;
    }

    private static ShowPackage ClonePackage(ShowPackage src)
    {
        var p = new ShowPackage { ProtocolVersion = src.ProtocolVersion, Name = src.Name, ProjectId = src.ProjectId, DurationMs = src.DurationMs, TimelineRevision = src.TimelineRevision, ProjectHash = src.ProjectHash };
        foreach (var e in src.Events)
            p.Events.Add(new ShowEvent { Id = e.Id, Kind = e.Kind, StartMs = e.StartMs, DurationMs = e.DurationMs, Command = e.Command, PerformerId = e.PerformerId, Name = e.Name, PlayMode = e.PlayMode });
        return p;
    }

    private static string JoinIds(RecProductionDispatcher d) => string.Join(",", d.Dispatched.Select(e => e.Id));
    private static string JoinIds(X1ShowDispatcher d) => string.Join(",", d.Dispatched.Select(e => e.Id));

    private static string DumpSinks(Built b) =>
        $"moveE={b.MoveSink.Emits.Count} moveR={b.MoveSink.Releases.Count} faceE={b.FaceSink.Emits.Count} faceR={b.FaceSink.Releases.Count} ab={b.AbilitySink.Calls.Count}";

    private static string DiffShow(string a, string b)
    {
        if (a == b) return "";
        var n = Math.Min(a.Length, b.Length);
        var i = 0;
        while (i < n && a[i] == b[i]) i++;
        return $"len {a.Length} vs {b.Length}; 首异 @{i}: 「{a.Substring(Math.Max(0, i - 40), Math.Min(40, i))}→{a.Substring(i, Math.Min(80, a.Length - i))}」vs「{b.Substring(i, Math.Min(80, b.Length - i))}」";
    }

    private sealed class RecProductionDispatcher : IShowDispatcher
    {
        public readonly List<ShowEvent> Dispatched = new();
        public int StopCalls;
        public int ShowStartCalls;
        public ShowDispatchResult Dispatch(ShowEvent e)
        {
            Dispatched.Add(e);
            return e.Kind switch
            {
                "motion" or "cue" or "lyrics" => ShowDispatchResult.Success(),
                _ => ShowDispatchResult.Fail("事件类型「" + e.Kind + "」没有执行器"),
            };
        }
        public void OnShowStart() => ShowStartCalls++;
        public void OnStop() => StopCalls++;
    }

    private sealed class RecAbilitySink : IX1AbilitySink
    {
        public readonly List<(string ActionId, string Target)> Calls = new();
        public bool Submit(string actionId, string target)
        {
            Calls.Add((actionId, target));
            return true;
        }
    }

    private sealed class RecMovementSink : IX1MovementSink
    {
        public sealed class Emit
        {
            public double Dx; public double Dz; public double TargetX; public double TargetZ; public long ShowTimeMs;
        }
        public readonly List<Emit> Emits = new();
        public readonly List<string> Releases = new();
        public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs)
            => Emits.Add(new Emit { Dx = dx, Dz = dz, TargetX = targetX, TargetZ = targetZ, ShowTimeMs = showTimeMs });
        public void ReleaseMovement(string eventId) => Releases.Add(eventId);
    }

    private sealed class RecFacingSink : IX1FacingSink
    {
        public sealed class Emit
        {
            public string EventId = ""; public double AngleDeg; public long ShowTimeMs;
        }
        public readonly List<Emit> Emits = new();
        public readonly List<string> Releases = new();
        public void EmitFacing(string eventId, double angleDeg, long showTimeMs)
            => Emits.Add(new Emit { EventId = eventId, AngleDeg = angleDeg, ShowTimeMs = showTimeMs });
        public void ReleaseFacing(string eventId) => Releases.Add(eventId);
    }
}
