// 这个文件是干嘛的：X1 离线执行器六组命名回归（输入/时钟/技能/移动/朝向/停止），全量套件同样执行。
using ChoreoHelper;

internal static class X1ExecutorCases
{
    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 离线执行器（{caseName}{(red ? " --red" : "")}） ==");
        switch (caseName)
        {
            case "x1-inputs": RunInputsCase(CheckNamed); break;
            case "x1-clock": RunClockCase(CheckNamed); break;
            case "x1-ability": RunAbilityCase(CheckNamed); break;
            case "x1-movement": RunMovementCase(CheckNamed); break;
            case "x1-facing": RunFacingCase(CheckNamed); break;
            case "x1-stop": RunStopCase(CheckNamed); break;
            default:
                Console.WriteLine($"未知命名用例：{caseName}（可用 x1-inputs / x1-clock / x1-ability / x1-movement / x1-facing / x1-stop）");
                return 2;
        }
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        return fails > 0 ? 1 : 0;
    }

    // ---- AC-1 输入层 ----
    public static void RunInputsCase(CheckFn check)
    {
        var ability = new X1AbilityInput { EventId = "a1", PerformerId = "p1", ActionId = "ac-1001", RequiredJob = "战士", RequiredLevel = 90 };
        var movement = new X1MovementInput { EventId = "m1", PerformerId = "p1", Locomotion = X1Locomotion.Run, ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        movement.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        movement.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        movement.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
        var facing = new X1FacingInput { EventId = "f1", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 };
        check("[inputs] 有效技能输入通过", X1InputValidation.ValidateAbility(ability).Ok);
        check("[inputs] 有效移动输入通过", X1InputValidation.ValidateMovement(movement).Ok);
        check("[inputs] 有效朝向输入通过", X1InputValidation.ValidateFacing(facing).Ok);
        check("[inputs] 单演员捆绑通过",
            X1InputValidation.ValidateBundle("p1", new[] { ability }, new[] { movement }, new[] { facing }).Ok);

        var noAction = new X1AbilityInput { EventId = "a1", PerformerId = "p1", ActionId = "" };
        check("[inputs] 缺动作标识拒绝且中文", FailChinese(X1InputValidation.ValidateAbility(noAction)));
        var nanMove = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        nanMove.Points.Add(new X1Waypoint { TMs = 0, X = double.NaN, Z = 0 });
        nanMove.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 路点 NaN 拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(nanMove)));
        var infMove = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = double.PositiveInfinity };
        infMove.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        infMove.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 修正界 Infinity 拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(infMove)));
        var nanTol = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = double.NaN, MaxCorrectionM = 1.5 };
        nanTol.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        nanTol.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 容差 NaN 拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(nanTol)));
        var nanAngle = new X1FacingInput { EventId = "f1", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = double.NaN };
        check("[inputs] 角度 NaN 拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(nanAngle)));
        var emptyPts = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        check("[inputs] 空路点拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(emptyPts)));
        var nonMono = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        nonMono.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        nonMono.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        nonMono.Points.Add(new X1Waypoint { TMs = 500, X = 2, Z = 0 });
        check("[inputs] 非单调时刻拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(nonMono)));
        var dupT = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        dupT.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        dupT.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        dupT.Points.Add(new X1Waypoint { TMs = 1000, X = 2, Z = 0 });
        check("[inputs] 重复时刻（含零长段）拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(dupT)));
        var zeroTol = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0, MaxCorrectionM = 1.5 };
        zeroTol.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        zeroTol.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 零容差拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(zeroTol)));
        var negCorr = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = -1 };
        negCorr.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        negCorr.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 负修正界拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(negCorr)));
        var otherPerformer = new X1MovementInput { EventId = "m1", PerformerId = "p2", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        otherPerformer.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        otherPerformer.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 第二演员拒绝且中文",
            FailChinese(X1InputValidation.ValidateBundle("p1", new[] { ability }, new[] { otherPerformer }, new[] { facing })));
        var skipAbility = new X1AbilityInput { EventId = "a1", PerformerId = "p1", ActionId = "ac-1", FailurePolicy = X1FailurePolicy.Skip };
        check("[inputs] 技能 skip 策略拒绝且中文", FailChinese(X1InputValidation.ValidateAbility(skipAbility)));
        var waitMove = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5, FailurePolicy = X1FailurePolicy.Wait };
        waitMove.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        waitMove.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 移动 wait 策略拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(waitMove)));
        foreach (var mode in new[] { X1FacingMode.Transition, X1FacingMode.OtherActor })
        {
            var f = new X1FacingInput { EventId = "f1", PerformerId = "p1", FacingMode = mode, FixedAngleDeg = 90 };
            check("[inputs] 朝向 " + mode + " 拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(f)));
        }
        // 舞台中心已支持：缺中心仍拒绝（无隐式 (0,0)），显式有限中心放行（行为详测在 x1-stage-center）。
        var scNoCenter = new X1FacingInput { EventId = "f1", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, FixedAngleDeg = 90 };
        check("[inputs] 舞台中心缺中心拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(scNoCenter)));
        check("[inputs] 舞台中心显式有限中心放行",
            X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f1", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 }).Ok);
        var curve = new X1MovementInput { EventId = "m1", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5, IsCurveControlPoints = true };
        curve.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        curve.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[inputs] 未采样曲线控制点拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(curve)));

        // 拒绝先于构造且零槽调用
        var countingAbility = new X1CountingAbilitySink();
        var badAbility = new X1AbilityInput { EventId = "a-bad", PerformerId = "p1", ActionId = "" };
        var (bok, _, _) = X1MovementExecutor.TryCreate(emptyPts, 0);
        check("[inputs] 无效移动不构造执行器", !bok);
        var (aok, aerr, afail, _) = X1AbilityExecutor.TryExecute(badAbility, HealthyConds(), "t1", countingAbility);
        check("[inputs] 无效技能零槽调用且中文", !aok && afail == X1AbilityFailure.InputInvalid && countingAbility.Calls.Count == 0 && HasChinese(aerr), aerr);
        var countingMove = new X1CountingMovementSink();
        var (mok, merr, mexec) = X1MovementExecutor.TryCreate(nanMove, 0);
        check("[inputs] 无效移动零槽调用", !mok && mexec == null && countingMove.Emits.Count == 0 && countingMove.Releases.Count == 0, merr);
        var countingFace = new X1CountingFacingSink();
        var (fok, ferr, fexec) = X1FacingExecutor.TryCreate(nanAngle, 0, 1000);
        check("[inputs] 无效朝向零槽调用", !fok && fexec == null && countingFace.Emits.Count == 0, ferr);

        // 生产拒绝面保持（存量文案）
        ShowEvent Se(string id, string kind) => new() { Id = id, Kind = kind, StartMs = 0, DurationMs = 500, Command = kind == "motion" ? "/bow motion" : "", PerformerId = "p1" };
        ShowPackage Pkg(params ShowEvent[] evs) { var p = new ShowPackage { ProtocolVersion = 1, DurationMs = 100000 }; p.Events.AddRange(evs); return p; }
        check("[inputs] 生产仍拒绝 movement", !ShowValidator.Validate(Pkg(Se("e1", "movement"))).Ok);
        check("[inputs] 生产仍拒绝 facing", !ShowValidator.Validate(Pkg(Se("e1", "facing"))).Ok);
        check("[inputs] 生产仍拒绝 ability", !ShowValidator.Validate(Pkg(Se("e1", "ability"))).Ok);
        var capMove = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
        capMove.Events.Add(Se("e1", "cue"));
        capMove.Capabilities.Add(new ShowCapability { Name = "movement-control" });
        check("[inputs] 生产仍拒绝 movement-control 能力",
            !ShowValidator.Validate(capMove).Ok && ShowValidator.Validate(capMove).Issues.Exists(i => i.Code == "E_CAPABILITY_UNSUPPORTED"));
        var capAb = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
        capAb.Events.Add(Se("e1", "cue"));
        capAb.Capabilities.Add(new ShowCapability { Name = "ability-execution" });
        check("[inputs] 生产仍拒绝 ability-execution 能力",
            !ShowValidator.Validate(capAb).Ok && ShowValidator.Validate(capAb).Issues.Exists(i => i.Code == "E_CAPABILITY_UNSUPPORTED"));
        check("[inputs] 未广告新事件种（协议 6 种）", ShowProtocol.Kinds.Count == 6);
        check("[inputs] 未广告新执行器（生产 3 执行器）", ShowValidator.SupportedExecutors.Count == 3);
    }

    // ---- AC-2 时钟 ----
    public static void RunClockCase(CheckFn check)
    {
        foreach (var schedule in new[] { "16ms", "33ms", "irregular" })
        {
            var tag = "[clock " + schedule + "] ";
            var built = BuildClockShow();
            var disp = built.Dispatcher;
            long t = 0;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            check(tag + "装载", runner.Load(built.Package).Ok);
            check(tag + "就绪", runner.Arm().Ok);
            check(tag + "启动", runner.Start(0).Ok);
            runner.Tick();
            check(tag + "转换后 Playing", runner.State == ShowState.Playing);
            var steps = schedule == "16ms" ? Repeat(16, 20000)
                : schedule == "33ms" ? Repeat(33, 10000)
                : IrregularSteps();
            var maxStep = schedule == "16ms" ? 16 : schedule == "33ms" ? 33 : 97;
            foreach (var s in steps)
            {
                if (runner.State != ShowState.Playing) break;
                t += s;
                runner.Tick();
            }
            check(tag + "终态 Completed", runner.State == ShowState.Completed);
            check(tag + "离散事件各恰一次（9 条）", disp.Dispatched.Count == 9 && disp.Dispatched.Select(e => e.Id).Distinct().Count() == 9,
                string.Join(",", disp.Dispatched.Select(e => e.Id)));
            var ids = disp.Dispatched.Select(e => e.Id).ToList();
            var tie = ids.Where(id => id.EndsWith("@1000")).ToList();
            check(tag + "同刻优先级 facing>movement>ability>motion>cue>lyrics",
                string.Join(",", tie) == "f-tie@1000,m-tie@1000,a-tie@1000,mo-tie@1000,mo-tie2@1000,c-tie@1000,l-tie@1000", string.Join(",", tie));
            // 计划/实际时间：recentLog 全覆盖（9 条 ≤ 10）
            var entries = RecentLogEntries(runner);
            check(tag + "日志覆盖全部 9 条", entries.Count == 9, entries.Count.ToString());
            var okTimes = true;
            long maxLate = 0;
            foreach (var en in entries)
            {
                if (en.Dispatched < en.Planned) okTimes = false;
                maxLate = Math.Max(maxLate, en.Dispatched - en.Planned);
            }
            check(tag + "从不早发（实际≥计划）", okTimes);
            check(tag + "抖动有界（≤ " + maxStep + "ms，无链式漂移）", maxLate <= maxStep, "maxLate=" + maxLate);
            check(tag + "离线意图与游戏确认区分",
                entries.Where(e => e.Kind == "ability" || e.Kind == "movement" || e.Kind == "facing").All(e => e.Reason.Contains("离线意图"))
                && entries.Where(e => e.Kind == "motion").All(e => e.Reason == ""), DumpReasons(entries));
            check(tag + "移动释放恰一次", disp.MovementSink is X1CountingMovementSink mm && mm.Releases.Count == 1, ReleaseDump(disp));
            check(tag + "朝向释放恰一次（终端统一释放 1 独立）", disp.FacingSink is X1CountingFacingSink ff && ff.Releases.Count == 1, ReleaseDump(disp));
            check(tag + "完成清扫恰一次", runner.StopCleanupRuns == 1, runner.StopCleanupRuns.ToString());
        }
    }

    // ---- AC-3 技能 ----
    public static void RunAbilityCase(CheckFn check)
    {
        string[] condNames = { "职业", "等级", "目标", "咏唱", "冷却", "移动", "可控" };
        for (var i = 0; i < 7; i++)
        {
            foreach (var unknown in new[] { false, true })
            {
                var tag = "[ability " + condNames[i] + (unknown ? "=未知" : "=假") + "] ";
                var cond = HealthyConds();
                SetCond(cond, i, unknown ? null : (bool?)false);
                var sink = new X1CountingAbilitySink();
                var built = BuildAbilityShow(cond, sink, "target-explicit-1");
                long t = 0;
                var runner = new ShowRunner(built.Dispatcher, () => t);
                runner.SetGuardProvider(() => new GuardSnapshot());
                runner.Load(built.Package); runner.Arm(); runner.Start(0); runner.Tick();
                t += 600; runner.Tick();
                check(tag + "Faulted 且原因含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("e-ab") && HasChinese(runner.StopReason), runner.StopReason);
                check(tag + "零技能提交", sink.Calls.Count == 0);
                t += 2000; runner.Tick();
                check(tag + "后续到期事件被阻止", !built.Dispatcher.Dispatched.Any(e => e.Id == "e-mo"), JoinIds(built.Dispatcher));
                t += 100; runner.Tick();
                runner.RequestStop("x");
                check(tag + "重复 Tick/Stop 零重试", sink.Calls.Count == 0);
            }
        }
        {
            var sink = new X1CountingAbilitySink();
            var built = BuildAbilityShow(HealthyConds(), sink, "target-explicit-1");
            long t = 0;
            var runner = new ShowRunner(built.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(built.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick();
            check("[ability 成功] Playing 且提交恰一次", runner.State == ShowState.Playing && sink.Calls.Count == 1,
                runner.State + " calls=" + sink.Calls.Count);
            check("[ability 成功] 仅提交供给动作与显式目标",
                sink.Calls.Count == 1 && sink.Calls[0].ActionId == "ac-ability-77" && sink.Calls[0].Target == "target-explicit-1",
                DumpAbilityCalls(sink));
            t += 2000; runner.Tick();
            check("[ability 成功] 后续事件照常", built.Dispatcher.Dispatched.Any(e => e.Id == "e-mo"));
            for (var i = 0; i < 20 && runner.State != ShowState.Completed; i++) { t += 1000; runner.Tick(); }
            check("[ability 成功] 至 Completed", runner.State == ShowState.Completed);
            check("[ability 成功] 无重试（仍一次）", sink.Calls.Count == 1);
        }
        {
            var sink = new X1CountingAbilitySink { FailNext = true };
            var built = BuildAbilityShow(HealthyConds(), sink, "target-explicit-1");
            long t = 0;
            var runner = new ShowRunner(built.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(built.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick();
            check("[ability 槽拒绝] Faulted", runner.State == ShowState.Faulted);
            check("[ability 槽拒绝] 提交恰一次尝试", sink.Calls.Count == 1);
            t += 2000; runner.Tick();
            check("[ability 槽拒绝] 后续被阻止", !built.Dispatcher.Dispatched.Any(e => e.Id == "e-mo"));
        }
        {
            var sink = new X1CountingAbilitySink { ThrowNext = true };
            var built = BuildAbilityShow(HealthyConds(), sink, "target-explicit-1");
            long t = 0;
            var runner = new ShowRunner(built.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(built.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick();
            check("[ability 槽异常] Faulted", runner.State == ShowState.Faulted);
            t += 2000; runner.Tick();
            check("[ability 槽异常] 后续被阻止", !built.Dispatcher.Dispatched.Any(e => e.Id == "e-mo"));
        }
    }

    // ---- AC-4 移动 ----
    public static void RunMovementCase(CheckFn check)
    {
        var tol = 0.25;
        var bound = 1.5;
        X1MovementInput Mk(string id, params (long t, double x, double z)[] pts)
        {
            var m = new X1MovementInput { EventId = id, PerformerId = "p1", ArrivalToleranceM = tol, MaxCorrectionM = bound };
            foreach (var (t, x, z) in pts) m.Points.Add(new X1Waypoint { TMs = t, X = x, Z = z });
            return m;
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-s", (0, 0, 0), (1000, 1, 0)), 0);
            check("[movement 直线] 构造通过", ok && ex != null);
            var sink = new X1CountingMovementSink();
            ex!.Update(500, 0, 0, sink);
            check("[movement 直线] 500ms 目标 (0.5,0)", sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].TargetX - 0.5) < 1e-9 && Math.Abs(sink.Emits[0].TargetZ) < 1e-9, DumpMove(sink));
            check("[movement 直线] 修正 (0.5,0) 有界", Math.Abs(sink.Emits[0].Dx - 0.5) < 1e-9 && Magnitude(sink.Emits[0]) <= bound + 1e-9);
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-p", (0, 0, 0), (1000, 1, 0), (2000, 1, 1)), 0);
            check("[movement 折线] 构造通过", ok);
            var s1 = new X1CountingMovementSink();
            ex!.Update(500, 0, 0, s1);
            check("[movement 折线] 500ms 目标 (0.5,0)", Math.Abs(s1.Emits[0].TargetX - 0.5) < 1e-9);
            var s2 = new X1CountingMovementSink();
            ex.Update(1500, 1, 0, s2);
            check("[movement 折线] 1500ms 目标 (1,0.5)", Math.Abs(s2.Emits[0].TargetX - 1) < 1e-9 && Math.Abs(s2.Emits[0].TargetZ - 0.5) < 1e-9, DumpMove(s2));
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-c", (0, 0, 0), (250, 0.25, 0.01), (500, 0.5, 0.02), (750, 0.75, 0.01), (1000, 1, 0)), 0);
            check("[movement 已采样曲线] 构造通过", ok);
            var s = new X1CountingMovementSink();
            ex!.Update(500, 0.5, 0.02, s);
            check("[movement 已采样曲线] 500ms 目标 (0.5,0.02)", Math.Abs(s.Emits[0].TargetX - 0.5) < 1e-9 && Math.Abs(s.Emits[0].TargetZ - 0.02) < 1e-9, DumpMove(s));
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-b", (0, 0, 0), (1000, 1, 0)), 0);
            var s = new X1CountingMovementSink();
            ex!.Update(1000 - 1, 0, 0, s);
            var s2 = new X1CountingMovementSink();
            // 边界帧：用新执行器在恰好 999 与 1000 验证插值连续
            var t1 = X1MovementExecutor.Interpolate(ex.Input.Points, 999);
            var t2 = X1MovementExecutor.Interpolate(ex.Input.Points, 1000);
            check("[movement 边界] 路点时刻目标精确 (1,0)", Math.Abs(t2.X - 1) < 1e-9 && Math.Abs(t2.Z) < 1e-9);
            check("[movement 边界] 999ms 接近 (0.999,0)", Math.Abs(t1.X - 0.999) < 1e-9);
            check("[movement 边界] 构造通过", ok);
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-4m", (0, 0, 0), (1000, 0, 0)), 0);
            check("[movement 4m 误差] 构造通过", ok);
            var s = new X1CountingMovementSink();
            ex!.Update(0, 4, 0, s);
            check("[movement 4m 误差] 输出恰好 1.5m 界朝向路点",
                s.Emits.Count == 1 && Math.Abs(Magnitude(s.Emits[0]) - 1.5) < 1e-9 && Math.Abs(s.Emits[0].Dx + 1.5) < 1e-9 && Math.Abs(s.Emits[0].Dz) < 1e-9, DumpMove(s));
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-end", (0, 0, 0), (1000, 1, 0)), 0);
            check("[movement 终点容差] 构造通过", ok);
            var s = new X1CountingMovementSink();
            var (rok, rerr, rfail) = ex!.Update(1000, 1.5, 0, s);
            check("[movement 终点 0.5m 误差] 故障且中文含事件", !rok && rfail == X1MovementFailure.ToleranceExceeded && rerr.Contains("m-end") && HasChinese(rerr), rerr);
            check("[movement 终点 0.5m 误差] 释放恰一次", s.Releases.Count == 1);
            var before = s.Emits.Count;
            ex.Update(1500, 1.5, 0, s);
            check("[movement 终点后] 零追赶（零新增输出）", s.Emits.Count == before && s.Releases.Count == 1);
        }
        {
            var (ok, _, ex) = X1MovementExecutor.TryCreate(Mk("m-stuck", (0, 0, 0), (1000, 1, 0)), 0);
            var s = new X1CountingMovementSink();
            // 静止观测全程不动
            ex!.Update(500, 0, 0, s);
            var (rok, rerr, _) = ex.Update(1000, 0, 0, s);
            check("[movement 静止观测] 终点同规则故障", !rok && HasChinese(rerr), rerr);
            check("[movement 静止观测] 构造通过", ok);
        }
        // 无效输入
        var badEmpty = new X1MovementInput { EventId = "m-bad", PerformerId = "p1", ArrivalToleranceM = tol, MaxCorrectionM = bound };
        var badMono = Mk("m-bad", (0, 0, 0), (1000, 1, 0), (500, 2, 0));
        var badDup = Mk("m-bad", (0, 0, 0), (1000, 1, 0), (1000, 2, 0));
        var badNan = Mk("m-bad", (0, 0, 0), (1000, double.NaN, 0));
        foreach (var (name, inp) in new[] { ("空", badEmpty), ("非单调", badMono), ("重复时刻", badDup), ("非有限", badNan) })
        {
            var s = new X1CountingMovementSink();
            var (ok, err, exec) = X1MovementExecutor.TryCreate(inp, 0);
            check("[movement 无效 " + name + "] 拒绝且中文零槽", !ok && exec == null && HasChinese(err) && s.Emits.Count == 0 && s.Releases.Count == 0, err);
        }
        // 集成：时钟越过终点故障且释放，终点后零更新
        {
            var disp = new X1ShowDispatcher("p1");
            var msink = new X1CountingMovementSink();
            var fsink = new X1CountingFacingSink();
            disp.MovementSink = msink; disp.FacingSink = fsink;
            disp.AbilitySink = new X1CountingAbilitySink();
            disp.ObservedProvider = () => (10, 0);
            var mi = Mk("m-int", (0, 0, 0), (1000, 1, 0));
            mi.EventId = "m-int"; disp.AddMovement(mi);
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
            pkg.Events.Add(new ShowEvent { Id = "m-int", Kind = "movement", StartMs = 0, DurationMs = 1000, PerformerId = "p1" });
            long t = 0;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t += 1000; runner.Tick();
            check("[movement 集成] 终点大误差故障", runner.State == ShowState.Faulted && runner.StopReason.Contains("m-int"), runner.StopReason);
            var emits = msink.Emits.Count;
            t += 1000; runner.Tick();
            check("[movement 集成] 终点后零更新", msink.Emits.Count == emits);
        }
    }

    // ---- AC-5 朝向 ----
    public static void RunFacingCase(CheckFn check)
    {
        var disp = new X1ShowDispatcher("p1");
        var msink = new X1CountingMovementSink();
        var fsink = new X1CountingFacingSink();
        disp.MovementSink = msink; disp.FacingSink = fsink;
        disp.AbilitySink = new X1CountingAbilitySink();
        disp.ObservedProvider = () => (1, 2);
        var mi = new X1MovementInput { EventId = "m-face", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
        mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        mi.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 1 });
        mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
        mi.Points.Add(new X1Waypoint { TMs = 3000, X = 1, Z = 2 });
        var fi = new X1FacingInput { EventId = "f-face", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 };
        check("[facing] 移动输入通过", disp.AddMovement(mi).Ok);
        check("[facing] 独立输入通过", disp.AddFacing(fi).Ok);
        var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
        pkg.Events.Add(new ShowEvent { Id = "m-face", Kind = "movement", StartMs = 0, DurationMs = 3000, PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "f-face", Kind = "facing", StartMs = 200, DurationMs = 600, PerformerId = "p1" });
        long t = 0;
        var runner = new ShowRunner(disp, () => t);
        runner.SetGuardProvider(() => new GuardSnapshot());
        runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
        // 逐 100ms 推进到 3000
        for (var step = 0; step < 30; step++) { t += 100; runner.Tick(); if (runner.State != ShowState.Playing) break; }
        check("[facing] 演中保持 Playing", runner.State == ShowState.Playing, runner.State + " " + runner.StopReason);
        check("[facing] 每更新恰一条意图（无双发）", fsink.Emits.Count <= 30 && fsink.Emits.Count >= 20, fsink.Emits.Count.ToString());
        var e100 = ClosestEmit(fsink, 100);
        var e300 = ClosestEmit(fsink, 300);
        var e900 = ClosestEmit(fsink, 900);
        var e1500 = ClosestEmit(fsink, 1500);
        var e2500 = ClosestEmit(fsink, 2500);
        check("[facing] 重叠前移动切向 45°", e100.HasValue && Math.Abs(e100.Value - 45) < 1e-6, "100ms=" + e100);
        check("[facing] 重叠期独立 90° 优先", e300.HasValue && Math.Abs(e300.Value - 90) < 1e-6, "300ms=" + e300);
        check("[facing] 独立结束后无残留（回 45°）", e900.HasValue && Math.Abs(e900.Value - 45) < 1e-6, "900ms=" + e900);
        check("[facing] 静止段保持上次（45°，非 0/NaN）", e1500.HasValue && Math.Abs(e1500.Value - 45) < 1e-6, "1500ms=" + e1500);
        check("[facing] 静止后切向 0°", e2500.HasValue && Math.Abs(e2500.Value - 0) < 1e-6, "2500ms=" + e2500);
        for (var i = 0; i < 80 && runner.State == ShowState.Playing; i++) { t += 100; runner.Tick(); }
        check("[facing] 至 Completed", runner.State == ShowState.Completed, runner.State + " " + runner.StopReason);
        check("[facing] 终端释放朝向恰一次", fsink.Releases.Count == 1, fsink.Releases.Count.ToString());
        foreach (var mode in new[] { X1FacingMode.Transition, X1FacingMode.OtherActor })
        {
            var f = new X1FacingInput { EventId = "f-bad", PerformerId = "p1", FacingMode = mode, FixedAngleDeg = 0 };
            var s = new X1CountingFacingSink();
            var (ok, err, exec) = X1FacingExecutor.TryCreate(f, 0, 1000);
            check("[facing 不支持 " + mode + "] 拒绝且中文零槽", !ok && exec == null && HasChinese(err) && s.Emits.Count == 0, err);
        }
        // 舞台中心已支持：缺中心拒绝的执行器构造见证（行为详测在 x1-stage-center）。
        {
            var f = new X1FacingInput { EventId = "f-bad", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, FixedAngleDeg = 0 };
            var s = new X1CountingFacingSink();
            var (ok, err, exec) = X1FacingExecutor.TryCreate(f, 0, 1000);
            check("[facing 舞台中心缺中心] 拒绝且中文零槽", !ok && exec == null && HasChinese(err) && s.Emits.Count == 0, err);
        }
    }

    // ---- AC-6 停止 ----
    public static void RunStopCase(CheckFn check)
    {
        // 守卫全集 + 不可用形态：活动移动/朝向 + 前缀保留 + 零后续 + 释放一次
        var guardSets = new (string Name, Action<GuardSnapshot> Set)[]
        {
            ("角色消失", s => s.CharacterPresent = false),
            ("换图", s => s.TerritoryChanged = true),
            ("过场", s => s.InCutscene = true),
            ("战斗", s => s.InCombat = true),
            ("不可控", s => s.Uncontrollable = true),
            ("手动接管", s => s.ManualTakeover = true),
            ("适配器失败", s => s.AdapterFailure = true),
            ("移动误差", s => s.MovementErrorOverLimit = true),
        };
        foreach (var (name, set) in guardSets)
        {
            var tag = "[stop 守卫 " + name + "] ";
            var ctx = BuildStopShow();
            long t = 0;
            var guard = new GuardSnapshot();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => guard);
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick();
            t += 900; runner.Tick();
            check(tag + "前置 Playing 且前缀+移动/朝向已发", runner.State == ShowState.Playing && ctx.Dispatcher.Dispatched.Count == 4,
                JoinIds(ctx.Dispatcher));
            set(guard);
            var before = ctx.Dispatcher.Dispatched.Count;
            var moveEmits = ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Emits.Count;
            t += 500; runner.Tick();
            check(tag + "Faulted", runner.State == ShowState.Faulted && HasChinese(runner.StopReason), runner.StopReason);
            check(tag + "前缀冻结零进一步分发", ctx.Dispatcher.Dispatched.Count == before, JoinIds(ctx.Dispatcher));
            check(tag + "故障 Tick 守卫先于输出（零新增移动意图）",
                ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Emits.Count == moveEmits);
            var dc = ctx.Dispatcher.Dispatched.Count;
            for (var i = 0; i < 3; i++) { t += 200; runner.Tick(); }
            runner.RequestStop("重复");
            check(tag + "重复 Tick/Stop 零输出", ctx.Dispatcher.Dispatched.Count == dc);
            check(tag + "释放各恰一次", ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Releases.Count == 1
                && ((X1CountingFacingSink)ctx.Dispatcher.FacingSink!).Releases.Count == 1,
                ReleaseDump(ctx.Dispatcher));
        }
        // 不可用三形态
        for (var form = 0; form < 3; form++)
        {
            var tag = "[stop 不可用 " + form + "] ";
            var ctx = BuildStopShow();
            long t = 0;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick(); t += 900; runner.Tick();
            check(tag + "前置 Playing", runner.State == ShowState.Playing);
            if (form == 0) runner.SetGuardProvider(null);
            else if (form == 1) runner.SetGuardProvider(() => throw new InvalidOperationException("守卫采集器炸了"));
            else runner.SetGuardProvider(() => null!);
            var before = ctx.Dispatcher.Dispatched.Count;
            t += 500; runner.Tick();
            check(tag + "Faulted 且含守卫采集", runner.State == ShowState.Faulted && runner.StopReason.Contains("守卫采集"), runner.StopReason);
            check(tag + "零进一步分发", ctx.Dispatcher.Dispatched.Count == before);
        }
        // RequestStop
        {
            var ctx = BuildStopShow();
            long t = 0;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick(); t += 900; runner.Tick();
            runner.RequestStop("网页紧急停止");
            check("[stop 主动停止] Loaded", runner.State == ShowState.Loaded);
            var dc = ctx.Dispatcher.Dispatched.Count;
            t += 2000; runner.Tick();
            check("[stop 主动停止] 零后续", ctx.Dispatcher.Dispatched.Count == dc);
            check("[stop 主动停止] 释放各一次", ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Releases.Count == 1
                && ((X1CountingFacingSink)ctx.Dispatcher.FacingSink!).Releases.Count == 1);
        }
        // 执行器更新失败（终点大误差）
        {
            var ctx = BuildStopShow();
            ctx.Dispatcher.ObservedProvider = () => (10, 0);
            long t = 0;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            // 推进到移动终点（m-stop 1000+2000=3000）
            for (var i = 0; i < 40 && runner.State == ShowState.Playing; i++) { t += 200; runner.Tick(); }
            check("[stop 更新失败] Faulted", runner.State == ShowState.Faulted, runner.State + " " + runner.StopReason);
            var dc = ctx.Dispatcher.Dispatched.Count;
            t += 500; runner.Tick();
            check("[stop 更新失败] 零后续", ctx.Dispatcher.Dispatched.Count == dc);
        }
        // 可重入停止（槽回调内 RequestStop）
        {
            var ctx = BuildStopShow();
            long t = 0;
            ShowRunner? holder = null;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            holder = runner;
            runner.SetGuardProvider(() => new GuardSnapshot());
            var reentrant = (X1CountingMovementSink)ctx.Dispatcher.MovementSink!;
            reentrant.OnEmit = _ => holder!.RequestStop("槽内重入停止");
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick();
            t += 900; runner.Tick();
            // 首个移动修正触发重入 → Loaded，剩余突发与更新零泄漏
            check("[stop 重入] Loaded 且零泄漏", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            var dc = ctx.Dispatcher.Dispatched.Count;
            t += 500; runner.Tick();
            runner.RequestStop("重复");
            check("[stop 重入] 重复零输出", ctx.Dispatcher.Dispatched.Count == dc);
        }
        // 释放抛异常仍全尝试恰一次
        {
            var ctx = BuildStopShow();
            ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).ThrowOnRelease = true;
            long t = 0;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick(); t += 900; runner.Tick();
            runner.RequestStop("停止");
            check("[stop 释放异常] 仍 Loaded/Faulted", runner.State is ShowState.Loaded or ShowState.Faulted, runner.State.ToString());
            check("[stop 释放异常] 双释放各尝试一次",
                ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Releases.Count == 1
                && ((X1CountingFacingSink)ctx.Dispatcher.FacingSink!).Releases.Count == 1,
                ReleaseDump(ctx.Dispatcher));
            var mrel = ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Releases.Count;
            var frel = ((X1CountingFacingSink)ctx.Dispatcher.FacingSink!).Releases.Count;
            runner.RequestStop("重复");
            t += 200; runner.Tick();
            check("[stop 释放异常] 不重复释放",
                ((X1CountingMovementSink)ctx.Dispatcher.MovementSink!).Releases.Count == mrel
                && ((X1CountingFacingSink)ctx.Dispatcher.FacingSink!).Releases.Count == frel);
        }
        // 恢复不自动复演，显式 Arm+Start 唯一路径；Countdown/Playing/Unload 拒绝
        {
            var ctx = BuildStopShow();
            long t = 0;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick(); t += 900; runner.Tick();
            runner.RequestStop("停");
            var dc = ctx.Dispatcher.Dispatched.Count;
            for (var i = 0; i < 3; i++) { t += 1000; runner.Tick(); }
            check("[stop 恢复] 输入恢复+时钟前进不自动复演", runner.State == ShowState.Loaded && ctx.Dispatcher.Dispatched.Count == dc);
            check("[stop 恢复] 显式 Arm 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
            // 新分发器（释放态已清）重演
            var ctx2 = BuildStopShow();
            var runner2 = new ShowRunner(ctx2.Dispatcher, () => t);
            runner2.SetGuardProvider(() => new GuardSnapshot());
            runner2.Load(ctx2.Package); runner2.Arm(); runner2.Start(0); runner2.Tick();
            for (var i = 0; i < 80 && runner2.State != ShowState.Completed; i++) { t += 500; runner2.Tick(); }
            check("[stop 恢复] 显式重演至 Completed", runner2.State == ShowState.Completed, runner2.State + " " + runner2.StopReason);
        }
        {
            long t = 0;
            var ctx = BuildStopShow();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(10000);
            check("[stop 卸载] Countdown 拒绝", !runner.Unload().Ok);
            t += 100; runner.Tick();
            // 仍 Countdown（倒计时 10000 未到）
            check("[stop 卸载] 仍 Countdown", runner.State == ShowState.Countdown);
            check("[stop 卸载] Countdown 仍拒绝", !runner.Unload().Ok);
            // 快进到 Playing
            t += 20000; runner.Tick();
            if (runner.State == ShowState.Playing)
                check("[stop 卸载] Playing 拒绝", !runner.Unload().Ok);
        }
        // 序列化排列：RequestStop / Tick / 重入 Tick 零泄漏
        foreach (var perm in Perms(new[] { "stop", "tick", "reentrant" }))
        {
            var tag = "[stop 排列 " + string.Join("<", perm) + "] ";
            var ctx = BuildStopShow();
            long t = 0;
            ShowRunner? holder = null;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            holder = runner;
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t += 600; runner.Tick(); t += 900; runner.Tick();
            check(tag + "前置 Playing", runner.State == ShowState.Playing);
            var reentrant = (X1CountingMovementSink)ctx.Dispatcher.MovementSink!;
            var frozenAt = -1;
            var left = false;
            foreach (var op in perm)
            {
                if (op == "stop") runner.RequestStop("排列停止");
                else if (op == "reentrant")
                {
                    reentrant.OnEmit = _ => holder!.RequestStop("排列重入");
                    t += 200; runner.Tick();
                    reentrant.OnEmit = null;
                }
                else { t += 200; runner.Tick(); }
                if (runner.State is not (ShowState.Countdown or ShowState.Playing))
                {
                    if (!left) { left = true; frozenAt = ctx.Dispatcher.Dispatched.Count; }
                    check(tag + op + " 后零进一步分发", ctx.Dispatcher.Dispatched.Count == frozenAt);
                }
            }
            check(tag + "终态 Loaded/Faulted 且清扫一次", runner.State is ShowState.Loaded or ShowState.Faulted && runner.StopCleanupRuns == 1,
                runner.State + " clean=" + runner.StopCleanupRuns);
        }
    }

    // ----  helpers ----
    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);
    private static bool FailChinese((bool Ok, string Error) r) => !r.Ok && HasChinese(r.Error);

    internal static X1AbilityConditions HealthyConds() => new()
    {
        JobMatches = true, LevelMeets = true, TargetValid = true, NotCasting = true,
        CooldownReady = true, MovementAllowed = true, Controllable = true,
    };

    private static void SetCond(X1AbilityConditions c, int i, bool? v)
    {
        switch (i)
        {
            case 0: c.JobMatches = v; break;
            case 1: c.LevelMeets = v; break;
            case 2: c.TargetValid = v; break;
            case 3: c.NotCasting = v; break;
            case 4: c.CooldownReady = v; break;
            case 5: c.MovementAllowed = v; break;
            case 6: c.Controllable = v; break;
        }
    }

    private sealed record LogEntry(string Id, string Kind, long Planned, long Dispatched, bool Ok, string Reason);
    private static List<LogEntry> RecentLogEntries(ShowRunner runner)
    {
        var list = new List<LogEntry>();
        using var doc = System.Text.Json.JsonDocument.Parse(runner.StatusJson());
        foreach (var e in doc.RootElement.GetProperty("recentLog").EnumerateArray())
            list.Add(new LogEntry(
                e.GetProperty("id").GetString() ?? "",
                e.GetProperty("kind").GetString() ?? "",
                e.GetProperty("plannedMs").GetInt64(),
                e.GetProperty("dispatchedMs").GetInt64(),
                e.GetProperty("ok").GetBoolean(),
                e.GetProperty("reason").GetString() ?? ""));
        return list;
    }

    private static string DumpReasons(List<LogEntry> entries) =>
        string.Join(";", entries.Select(e => e.Id + ":" + e.Kind + ":" + e.Reason));
    private static string JoinIds(X1ShowDispatcher d) => string.Join(",", d.Dispatched.Select(e => e.Id));
    private static string ReleaseDump(X1ShowDispatcher d) =>
        "moveRel=" + (d.MovementSink as X1CountingMovementSink)?.Releases.Count
        + " faceRel=" + (d.FacingSink as X1CountingFacingSink)?.Releases.Count;
    private static string DumpAbilityCalls(X1CountingAbilitySink s) =>
        string.Join(";", s.Calls.Select(c => c.ActionId + "@" + c.Target));
    private static string DumpMove(X1CountingMovementSink s) =>
        string.Join(";", s.Emits.Select(e => $"({e.Dx:F3},{e.Dz:F3})->({e.TargetX:F3},{e.TargetZ:F3})@{e.ShowTimeMs}"));
    private static double Magnitude(X1CountingMovementSink.Emit e) => Math.Sqrt(e.Dx * e.Dx + e.Dz * e.Dz);

    private static List<long> Repeat(long step, int n) { var l = new List<long>(); for (var i = 0; i < n; i++) l.Add(step); return l; }
    private static List<long> IrregularSteps()
    {
        var pat = new long[] { 16, 33, 50, 17, 29, 97, 13, 41, 23, 61 };
        var l = new List<long>();
        for (var i = 0; i < 10000; i++) l.Add(pat[i % pat.Length]);
        return l;
    }

    private static double? ClosestEmit(X1CountingFacingSink sink, long showTime)
    {
        X1CountingFacingSink.Emit? best = null;
        foreach (var e in sink.Emits)
        {
            if (e.ShowTimeMs <= showTime && (best == null || e.ShowTimeMs > best.ShowTimeMs)) best = e;
        }
        return best?.AngleDeg;
    }

    private sealed class BuiltClock
    {
        public ShowPackage Package = new();
        public X1ShowDispatcher Dispatcher = new("p1");
    }

    private static BuiltClock BuildClockShow()
    {
        var disp = new X1ShowDispatcher("p1");
        var abilitySink = new X1CountingAbilitySink();
        var moveSink = new X1CountingMovementSink();
        var faceSink = new X1CountingFacingSink();
        disp.AbilitySink = abilitySink; disp.MovementSink = moveSink; disp.FacingSink = faceSink;
        disp.ObservedProvider = () => (0, 0);
        var pkg = new ShowPackage { ProtocolVersion = 1, Name = "时钟", DurationMs = 300000 };
        void AddEv(string id, string kind, long start, long dur, string cmd, string performer)
            => pkg.Events.Add(new ShowEvent { Id = id, Kind = kind, StartMs = start, DurationMs = dur, Command = cmd, PerformerId = performer });
        AddEv("e-early", "motion", 500, 500, "/bow motion", "p1");
        AddEv("f-tie@1000", "facing", 1000, 500, "", "p1");
        AddEv("m-tie@1000", "movement", 1000, 500, "", "p1");
        AddEv("a-tie@1000", "ability", 1000, 100, "", "p1");
        AddEv("mo-tie@1000", "motion", 1000, 500, "/wave motion", "p1");
        AddEv("mo-tie2@1000", "motion", 1000, 500, "/bow motion", "p1");
        AddEv("c-tie@1000", "cue", 1000, 100, "", "p1");
        AddEv("l-tie@1000", "lyrics", 1000, 500, "", "");
        AddEv("e-last", "motion", 2000, 500, "/bow motion", "p1");
        var ab = new X1AbilityInput { EventId = "a-tie@1000", PerformerId = "p1", ActionId = "ac-clock-1" };
        disp.AddAbility(ab, HealthyConds(), "target-clock");
        var mv = new X1MovementInput { EventId = "m-tie@1000", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
        mv.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        mv.Points.Add(new X1Waypoint { TMs = 500, X = 0.05, Z = 0 });
        disp.AddMovement(mv);
        disp.AddFacing(new X1FacingInput { EventId = "f-tie@1000", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
        return new BuiltClock { Package = pkg, Dispatcher = disp };
    }

    private sealed class BuiltAbility
    {
        public ShowPackage Package = new();
        public X1ShowDispatcher Dispatcher = new("p1");
    }

    private static BuiltAbility BuildAbilityShow(X1AbilityConditions cond, X1CountingAbilitySink sink, string target)
    {
        var disp = new X1ShowDispatcher("p1");
        disp.AbilitySink = sink;
        disp.MovementSink = new X1CountingMovementSink();
        disp.FacingSink = new X1CountingFacingSink();
        disp.ObservedProvider = () => (0, 0);
        disp.AddAbility(new X1AbilityInput { EventId = "e-ab", PerformerId = "p1", ActionId = "ac-ability-77" }, cond, target);
        var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
        pkg.Events.Add(new ShowEvent { Id = "e-ab", Kind = "ability", StartMs = 500, DurationMs = 100, PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "e-mo", Kind = "motion", StartMs = 1500, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        return new BuiltAbility { Package = pkg, Dispatcher = disp };
    }

    private sealed class BuiltStop
    {
        public ShowPackage Package = new();
        public X1ShowDispatcher Dispatcher = new("p1");
    }

    private static BuiltStop BuildStopShow()
    {
        var disp = new X1ShowDispatcher("p1");
        disp.AbilitySink = new X1CountingAbilitySink();
        disp.MovementSink = new X1CountingMovementSink();
        disp.FacingSink = new X1CountingFacingSink();
        disp.ObservedProvider = () => (0, 0);
        var mv = new X1MovementInput { EventId = "m-stop", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
        mv.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        mv.Points.Add(new X1Waypoint { TMs = 2000, X = 0.1, Z = 0 });
        disp.AddMovement(mv);
        disp.AddFacing(new X1FacingInput { EventId = "f-stop", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
        disp.AddAbility(new X1AbilityInput { EventId = "a-pending", PerformerId = "p1", ActionId = "ac-pending-1" }, HealthyConds(), "t-pending");
        var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
        pkg.Events.Add(new ShowEvent { Id = "e-pre1", Kind = "motion", StartMs = 0, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "e-pre2", Kind = "motion", StartMs = 500, DurationMs = 500, Command = "/wave motion", PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "m-stop", Kind = "movement", StartMs = 1000, DurationMs = 2000, PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "f-stop", Kind = "facing", StartMs = 1000, DurationMs = 1000, PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "a-pending", Kind = "ability", StartMs = 3000, DurationMs = 100, PerformerId = "p1" });
        pkg.Events.Add(new ShowEvent { Id = "e-post", Kind = "motion", StartMs = 4000, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        return new BuiltStop { Package = pkg, Dispatcher = disp };
    }

    private static IEnumerable<string[]> Perms(string[] items)
    {
        if (items.Length <= 1) { yield return items; yield break; }
        for (var i = 0; i < items.Length; i++)
            foreach (var rest in Perms(items.Where((_, j) => j != i).ToArray()))
                yield return new[] { items[i] }.Concat(rest).ToArray();
    }

    // ---- recording sinks ----
    internal sealed class X1CountingAbilitySink : IX1AbilitySink
    {
        public readonly List<(string ActionId, string Target)> Calls = new();
        public bool FailNext;
        public bool ThrowNext;
        public bool Submit(string actionId, string target)
        {
            Calls.Add((actionId, target));
            if (ThrowNext) throw new InvalidOperationException("槽炸了");
            if (FailNext) return false;
            return true;
        }
    }

    internal sealed class X1CountingMovementSink : IX1MovementSink
    {
        public sealed class Emit
        {
            public double Dx; public double Dz; public double TargetX; public double TargetZ; public long ShowTimeMs;
        }
        public readonly List<Emit> Emits = new();
        public readonly List<string> Releases = new();
        public Action<Emit>? OnEmit;
        public bool ThrowOnRelease;
        public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs)
        {
            var e = new Emit { Dx = dx, Dz = dz, TargetX = targetX, TargetZ = targetZ, ShowTimeMs = showTimeMs };
            Emits.Add(e);
            OnEmit?.Invoke(e);
        }
        public void ReleaseMovement(string eventId)
        {
            Releases.Add(eventId);
            if (ThrowOnRelease) throw new InvalidOperationException("移动释放炸了");
        }
    }

    internal sealed class X1CountingFacingSink : IX1FacingSink
    {
        public sealed class Emit
        {
            public string EventId = ""; public double AngleDeg; public long ShowTimeMs;
        }
        public readonly List<Emit> Emits = new();
        public readonly List<string> Releases = new();
        public void EmitFacing(string eventId, double angleDeg, long showTimeMs)
        {
            Emits.Add(new Emit { EventId = eventId, AngleDeg = angleDeg, ShowTimeMs = showTimeMs });
        }
        public void ReleaseFacing(string eventId) => Releases.Add(eventId);
    }
}
