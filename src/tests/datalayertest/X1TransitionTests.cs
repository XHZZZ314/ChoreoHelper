// 这个文件是干嘛的：X1 过渡朝向命名回归（x1-transition）：显式起止角准入、线性插值、优先级与停止生命周期（TASK-20260911-X1-OFFLINE-FACING-TRANSITION）。
using ChoreoHelper;

internal static class X1TransitionCases
{
    private const string Sentinel = "X1_TRANSITION_ASSERTION";

    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 过渡朝向（{caseName}{(red ? " --red" : "")}） ==");
        RunTransitionCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            Console.WriteLine(Sentinel);
            return 1;
        }
        return 0;
    }

    public static void RunTransitionCase(CheckFn check)
    {
        RunAdmission(check);
        RunInterpolation(check);
        RunPrecedence(check);
        RunFailureStop(check);
    }

    // ---- AC-1 显式起止角准入 ----
    private static void RunAdmission(CheckFn check)
    {
        var good = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = 100 };
        check("[tr-inputs] 显式有限起止角放行", X1InputValidation.ValidateFacing(good).Ok);
        check("[tr-inputs] 单演员捆绑放行", X1InputValidation.ValidateBundle("p1", null, null, new[] { good }).Ok);
        var (gok, _, gexec) = X1FacingExecutor.TryCreate(good, 1000, 2000);
        check("[tr-inputs] 执行器构造通过", gok && gexec != null);
        var dispOk = new X1ShowDispatcher("p1");
        check("[tr-inputs] 分发器收过渡朝向", dispOk.AddFacing(good).Ok);

        // extraneous StageCenterX/Z ignored (preserved precedent: FixedAngle/AlongPath ignore centers)
        var withCenter = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = 100, StageCenterX = 999, StageCenterZ = 999 };
        check("[tr-inputs] 附带中心坐标仍放行（忽略）", X1InputValidation.ValidateFacing(withCenter).Ok);
        var (cok, _, cexec) = X1FacingExecutor.TryCreate(withCenter, 1000, 2000);
        check("[tr-inputs] 附带中心坐标可构造", cok && cexec != null);
        {
            var s1 = new RecFacingSink();
            var s2 = new RecFacingSink();
            var (eok, _, eexec) = X1FacingExecutor.TryCreate(good, 1000, 2000);
            if (cexec != null && eexec != null)
            {
                cexec.Update(1500, 999, s1, 999, 999);
                eexec.Update(1500, 999, s2, 999, 999);
            }
            check("[tr-inputs] 中心坐标不影响插值输出", eok && cok && s1.Emits.Count == 1 && s2.Emits.Count == 1 && Math.Abs(s1.Emits[0].AngleDeg - s2.Emits[0].AngleDeg) < 1e-9, DumpFace(s1) + " vs " + DumpFace(s2));
        }

        // invalid matrix: each rejects before executor creation with Chinese + zero sink calls
        var noFrom = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionToDeg = 100 };
        var noTo = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10 };
        var nanFrom = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = double.NaN, TransitionToDeg = 100 };
        var infFrom = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = double.PositiveInfinity, TransitionToDeg = 100 };
        var nanTo = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = double.NaN };
        var infTo = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = double.NegativeInfinity };
        var skip = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = 100, FailurePolicy = X1FailurePolicy.Skip };
        var wait = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = 100, FailurePolicy = X1FailurePolicy.Wait };
        var undef = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = (X1FacingMode)999, TransitionFromDeg = 10, TransitionToDeg = 100 };
        var other = new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, FixedAngleDeg = 90 };
        foreach (var (name, inp) in new[] { ("缺起始角", noFrom), ("缺结束角", noTo), ("起始角NaN", nanFrom), ("起始角Infinity", infFrom), ("结束角NaN", nanTo), ("结束角Infinity", infTo), ("skip策略", skip), ("wait策略", wait), ("未知枚举", undef), ("他演员", other) })
        {
            var sink = new RecFacingSink();
            var (ok, err) = X1InputValidation.ValidateFacing(inp);
            check("[tr-inputs] " + name + "拒绝且中文", !ok && HasChinese(err), err);
            var (bok, berr, bexec) = X1FacingExecutor.TryCreate(inp, 1000, 2000);
            check("[tr-inputs] " + name + "不构造执行器零槽", !bok && bexec == null && HasChinese(berr) && sink.Emits.Count == 0 && sink.Releases.Count == 0, berr);
        }
        // mixed performer
        var mixed = new X1FacingInput { EventId = "f-tr", PerformerId = "p2", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = 100 };
        check("[tr-inputs] 混入第二演员拒绝且中文", FailChinese(X1InputValidation.ValidateBundle("p1", null, null, new[] { good, mixed })));
        {
            var d = new X1ShowDispatcher("p1");
            check("[tr-inputs] 分发器拒混演员", !d.AddFacing(mixed).Ok);
            check("[tr-inputs] 分发器拒缺端点", !d.AddFacing(noFrom).Ok);
        }
    }

    // ---- AC-2 线性插值 ----
    private static void RunInterpolation(CheckFn check)
    {
        // rows: (name, A, B) — caller-declared direction via signed distance, no auto-shortest-path
        (string Name, double A, double B)[] rows =
        {
            ("基本 10→100", 10, 100),
            ("跨零 350→370", 350, 370),
            ("反向 10→-10", 10, -10),
            ("分歧 0→340", 0, 340),
            ("多圈 0→720", 0, 720),
        };
        foreach (var (name, a, b) in rows)
        {
            var input = new X1FacingInput { EventId = "t-" + name, PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = a, TransitionToDeg = b };
            var (ok, _, ex) = X1FacingExecutor.TryCreate(input, 1000, 2000);
            check("[tr-interp " + name + "] 构造通过", ok && ex != null);
            if (ex == null) continue;
            var sink = new RecFacingSink();
            var (bok, _) = ex.Update(999, 123, sink, 456, 789);
            check("[tr-interp " + name + "] 开始前零输出", bok && sink.Emits.Count == 0);
            // t=0 exactly at start emits NormalizeDeg(A), ignoring tangent/observation
            sink.Emits.Clear();
            var (sok, _) = ex.Update(1000, -77, sink, 1, 2);
            var expectA = X1MovementExecutor.NormalizeDeg(a);
            check("[tr-interp " + name + "] 起点 t=0 出 NormalizeDeg(A)", sok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - expectA) < 1e-9 && sink.Emits[0].ShowTimeMs == 1000, DumpFace(sink) + " expect=" + expectA);
            // mid-span
            foreach (var t in new[] { 0.25, 0.5, 0.75 })
            {
                sink.Emits.Clear();
                var now = 1000 + (long)(1000 * t);
                var (uok, _) = ex.Update(now, null, sink);
                var expect = X1MovementExecutor.NormalizeDeg(a + (b - a) * t);
                check("[tr-interp " + name + "] t=" + t + " 出 " + expect.ToString("F3"), uok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - expect) < 1e-9 && sink.Emits[0].ShowTimeMs == now, DumpFace(sink) + " expect=" + expect);
            }
            // just before end
            sink.Emits.Clear();
            var (pok, _) = ex.Update(1999, null, sink);
            var pexpect = X1MovementExecutor.NormalizeDeg(a + (b - a) * 0.999);
            check("[tr-interp " + name + "] 结束前 1999 出公式值", pok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - pexpect) < 1e-9, DumpFace(sink) + " expect=" + pexpect);
            var ends = sink.Emits.Count;
            var (e1ok, _) = ex.Update(2000, null, sink);
            var (e2ok, _) = ex.Update(2500, null, sink);
            check("[tr-interp " + name + "] 结束时刻及之后零输出（半开，端点不发）", e1ok && e2ok && sink.Emits.Count == ends);
            check("[tr-interp " + name + "] 全部输出有限归一 [0,360)", sink.Emits.All(e => X1InputValidation.IsFiniteDouble(e.AngleDeg) && e.AngleDeg >= 0 && e.AngleDeg < 360));
        }
        // pinned falsifiable values (declared direction, never shortest-path shortcut)
        {
            var div = new X1FacingInput { EventId = "t-div", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 340 };
            var (dok, _, dex) = X1FacingExecutor.TryCreate(div, 1000, 2000);
            var s = new RecFacingSink();
            if (dex != null)
            {
                dex.Update(1250, null, s); // t=0.25 declared 85, shortest would be 355
                dex.Update(1500, null, s); // t=0.5 declared 170, shortest 350
                dex.Update(1750, null, s); // t=0.75 declared 255, shortest 345
            }
            check("[tr-interp 分歧钉死] 0→340 走 +340 经 85/170/255", dok && s.Emits.Count == 3 && Math.Abs(s.Emits[0].AngleDeg - 85) < 1e-9 && Math.Abs(s.Emits[1].AngleDeg - 170) < 1e-9 && Math.Abs(s.Emits[2].AngleDeg - 255) < 1e-9, DumpFace(s));
            check("[tr-interp 分歧钉死] 非最短 -20 捷径（355/350/345 之外）", dok && s.Emits.All(e => Math.Abs(e.AngleDeg - 355) > 1 && Math.Abs(e.AngleDeg - 350) > 1 && Math.Abs(e.AngleDeg - 345) > 1), DumpFace(s));
        }
        {
            var cross = new X1FacingInput { EventId = "t-cross", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 350, TransitionToDeg = 370 };
            var (cok2, _, cex) = X1FacingExecutor.TryCreate(cross, 1000, 2000);
            var s = new RecFacingSink();
            if (cex != null) cex.Update(1500, null, s); // t=0.5 → 360 → 0
            check("[tr-interp 跨零钉死] 350→370 中点经北为 0°", cok2 && s.Emits.Count == 1 && Math.Abs(s.Emits[0].AngleDeg - 0) < 1e-9, DumpFace(s));
        }
        {
            var rev = new X1FacingInput { EventId = "t-rev", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = -10 };
            var (rok, _, rex) = X1FacingExecutor.TryCreate(rev, 1000, 2000);
            var s = new RecFacingSink();
            if (rex != null) rex.Update(1500, null, s); // t=0.5 → 0
            check("[tr-interp 反向钉死] 10→-10 中点为 0°（另一方向）", rok && s.Emits.Count == 1 && Math.Abs(s.Emits[0].AngleDeg - 0) < 1e-9, DumpFace(s));
        }
        {
            var multi = new X1FacingInput { EventId = "t-multi", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 720 };
            var (mok, _, mex) = X1FacingExecutor.TryCreate(multi, 1000, 2000);
            var s = new RecFacingSink();
            if (mex != null)
            {
                mex.Update(1250, null, s); // 180
                mex.Update(1500, null, s); // 360 → 0
                mex.Update(1750, null, s); // 540 → 180
            }
            check("[tr-interp 多圈钉死] 0→720 经 180/0/180", mok && s.Emits.Count == 3 && Math.Abs(s.Emits[0].AngleDeg - 180) < 1e-9 && Math.Abs(s.Emits[1].AngleDeg - 0) < 1e-9 && Math.Abs(s.Emits[2].AngleDeg - 180) < 1e-9, DumpFace(s));
        }
        // zero-length window emits nothing
        {
            var z = new X1FacingInput { EventId = "t-zero", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 10, TransitionToDeg = 100 };
            var (zok, _, zex) = X1FacingExecutor.TryCreate(z, 1000, 1000);
            check("[tr-interp 零长] 构造通过（start==end 允许）", zok && zex != null);
            var s = new RecFacingSink();
            var a1 = true; var a2 = true; var a3 = true;
            if (zex != null)
            {
                (a1, _) = zex.Update(999, null, s);
                (a2, _) = zex.Update(1000, null, s);
                (a3, _) = zex.Update(1001, null, s);
            }
            check("[tr-interp 零长] 全零输出", zok && a1 && a2 && a3 && s.Emits.Count == 0, DumpFace(s));
        }
    }

    // ---- AC-3 优先级 ----
    private static void RunPrecedence(CheckFn check)
    {
        // P1 transition latest-start wins over fixed, ignores tangent + observation
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (9, 20);
            var mi = new X1MovementInput { EventId = "m-p1", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 3000, X = 3, Z = 3 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-fix", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
            disp.AddFacing(new X1FacingInput { EventId = "f-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 5000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p1", Kind = "movement", StartMs = 0, DurationMs = 3000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-fix", Kind = "facing", StartMs = 100, DurationMs = 900, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-tr", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[tr-prec] 仅固定角激活出 90°", fs.Emits.Count == 1 && LastIs(fs, "f-fix", 90), DumpFace(fs));
            t = 500; runner.Tick();
            // transition t=(500-400)/400=0.25 → 45
            check("[tr-prec] 晚起点过渡压过固定角（45°，非切向/观测）", LastIs(fs, "f-tr", 45), DumpFace(fs));
            t = 900; runner.Tick();
            check("[tr-prec] 过渡过期后回固定角 90° 无残留过渡角", LastIs(fs, "f-fix", 90) && fs.Emits.Count(e => e.EventId == "f-tr") == 1, DumpFace(fs));
        }
        // P2 movement + transition: single shared observation read per update, same snapshot for movement
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => { reads++; return (0.2, 0.1); };
            var mi = new X1MovementInput { EventId = "m-p2", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 2, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-p2", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 90 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 4000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p2", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-p2", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[tr-prec] 重叠前移动切向 45°", fs.Emits.Count == 1 && fs.Emits[0].EventId == "m-p2" && Math.Abs(fs.Emits[0].AngleDeg - 45) < 1e-9, DumpFace(fs));
            var readsBefore = reads;
            var moveBefore = ms.Emits.Count;
            t = 300; runner.Tick();
            var expect = X1MovementExecutor.NormalizeDeg(0 + 90 * ((300 - 200) / 400.0));
            check("[tr-prec] 重叠期过渡获胜（插值角）", fs.Emits.Count == 2 && fs.Emits[1].EventId == "f-p2" && Math.Abs(fs.Emits[1].AngleDeg - expect) < 1e-9, DumpFace(fs) + " expect=" + expect);
            check("[tr-prec] 本更新读取恰一次（过渡不触发额外读取）", reads - readsBefore == 1, "delta=" + (reads - readsBefore));
            check("[tr-prec] 同快照供移动修正", ms.Emits.Count == moveBefore + 1, DumpMove(ms));
        }
        // P3 tie-break: same start smallest EventId wins
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-b", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            disp.AddFacing(new X1FacingInput { EventId = "f-a", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 90, TransitionToDeg = 270 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-b", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-a", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 400; runner.Tick();
            // f-a t=(400-300)/600=1/6 → 90+180/6=120
            check("[tr-prec] 平手起点按事件序取小（f-a 的 120°）", fs.Emits.Count == 1 && fs.Emits[0].EventId == "f-a" && Math.Abs(fs.Emits[0].AngleDeg - 120) < 1e-9, DumpFace(fs));
        }
        // P4 transition vs stage-center: latest wins either way, suppressed side triggers no read
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => { reads++; return (9, 20); };
            disp.AddFacing(new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 21 });
            disp.AddFacing(new X1FacingInput { EventId = "f-tr2", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 90 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-sc", Kind = "facing", StartMs = 100, DurationMs = 900, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-tr2", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var r0 = reads;
            t = 300; runner.Tick();
            check("[tr-prec] 舞台中心激活期 45°", LastIs(fs, "f-sc", 45) && reads - r0 == 1, DumpFace(fs) + " dreads=" + (reads - r0));
            var r1 = reads;
            t = 500; runner.Tick();
            // transition t=0.25 → 22.5, suppressed stage-center triggers no extra read beyond transition's none (reads delta 0 since no movement and winner not stage-center)
            check("[tr-prec] 晚起点过渡压过舞台中心（22.5°）", LastIs(fs, "f-tr2", 22.5) && reads == r1, DumpFace(fs) + " dreads=" + (reads - r1));
        }
        // P5 after transition ends returns to movement tangent, no residual
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (9, 20);
            var mi = new X1MovementInput { EventId = "m-p5", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 3000, X = 0, Z = 3 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-p5", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 5000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p5", Kind = "movement", StartMs = 0, DurationMs = 3000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-p5", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[tr-prec] 结束前过渡 45°", LastIs(fs, "f-p5", 45), DumpFace(fs));
            t = 700; runner.Tick();
            check("[tr-prec] 结束后回移动切向 0° 无残留", LastIs(fs, "m-p5", 0), DumpFace(fs));
            check("[tr-prec] 结束后无过渡输出", fs.Emits.Count(e => e.EventId == "f-p5") == 1);
        }
    }

    // ---- AC-4 失败停与停止生命周期 ----
    private static void RunFailureStop(CheckFn check)
    {
        // F1 sink throw fails closed with event id + Chinese
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-f1", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f1", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[tr-fail] 首击成功", fs.Emits.Count == 1, DumpFace(fs));
            fs.ThrowOnEmit = true;
            t = 200; runner.Tick();
            check("[tr-fail] 槽异常 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f1") && HasChinese(runner.StopReason), runner.StopReason);
            var emits = fs.Emits.Count;
            t += 500; runner.Tick();
            check("[tr-fail] 故障后零追加输出", fs.Emits.Count == emits);
            check("[tr-fail] 释放恰一次", fs.Releases.Count == 1);
        }
        // F2 reentrant stop truncates remaining outputs
        {
            long t = 0;
            ShowRunner? holder = null;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (0, 0);
            var mi = new X1MovementInput { EventId = "m-f2", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f2", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f2", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f2", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            holder = runner;
            runner.SetGuardProvider(() => new GuardSnapshot());
            fs.OnEmit = _ => holder!.RequestStop("槽内重入停止");
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[tr-fail] 槽重入 Loaded", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            check("[tr-fail] 槽重入释放各恰一次", ms.Releases.Count == 1 && fs.Releases.Count == 1, "m=" + ms.Releases.Count + " f=" + fs.Releases.Count);
            var dc = disp.Dispatched.Count;
            var me = ms.Emits.Count;
            var fe = fs.Emits.Count;
            for (var i = 0; i < 5; i++) { t += 500; runner.Tick(); }
            runner.RequestStop("重复");
            check("[tr-fail] 槽重入后零泄漏", disp.Dispatched.Count == dc && ms.Emits.Count == me && fs.Emits.Count == fe);
        }
        // F3 guard failure preempts output
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-f3", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f3", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            var guard = new GuardSnapshot();
            runner.SetGuardProvider(() => guard);
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            guard.CharacterPresent = false;
            t = 100; runner.Tick();
            check("[tr-fail] 守卫失败 Faulted 零输出", runner.State == ShowState.Faulted && fs.Emits.Count == 0, runner.StopReason);
        }
        // F4 release-once across throwing cleanup
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink { ThrowOnRelease = true };
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (0, 0);
            var mi = new X1MovementInput { EventId = "m-f4", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 0, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f4", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 90 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f4", Kind = "movement", StartMs = 100, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f4", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 600; runner.Tick();
            runner.RequestStop("停止");
            check("[tr-fail] 释放异常仍 Loaded/Faulted", runner.State is ShowState.Loaded or ShowState.Faulted, runner.State.ToString());
            check("[tr-fail] 释放异常双释放各尝试一次", ms.Releases.Count == 1 && fs.Releases.Count == 1);
            var mr = ms.Releases.Count;
            var fr = fs.Releases.Count;
            runner.RequestStop("重复");
            t += 200; runner.Tick();
            check("[tr-fail] 释放异常不重复释放", ms.Releases.Count == mr && fs.Releases.Count == fr);
        }
        // F5 Arm+Start only replay, no stale residue, identical sequence
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-r", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = 180 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "f-r", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            t = 600; runner.Tick();
            check("[tr-fail] 首轮 0°/90° 序列", fs.Emits.Count == 2 && Math.Abs(fs.Emits[0].AngleDeg - 0) < 1e-9 && Math.Abs(fs.Emits[1].AngleDeg - 90) < 1e-9, DumpFace(fs));
            var firstSeq = fs.Emits.Select(e => e.AngleDeg).ToList();
            runner.RequestStop("停");
            var dc = disp.Dispatched.Count;
            var fe = fs.Emits.Count;
            for (var i = 0; i < 3; i++) { t += 1000; runner.Tick(); }
            check("[tr-fail] 恢复+时钟前进不自动复演", runner.State == ShowState.Loaded && disp.Dispatched.Count == dc && fs.Emits.Count == fe);
            check("[tr-fail] 显式 Arm 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
            t = 0; runner.Start(0); runner.Tick();
            var feBefore = fs.Emits.Count;
            t = 100; runner.Tick();
            check("[tr-fail] 重演首击无上轮残留（0°）", fs.Emits.Count == feBefore + 1 && Math.Abs(fs.Emits[^1].AngleDeg - 0) < 1e-9, DumpFace(fs));
            t = 600; runner.Tick();
            check("[tr-fail] 重演复现相同序列 90°", fs.Emits.Count == feBefore + 2 && Math.Abs(fs.Emits[^1].AngleDeg - 90) < 1e-9, DumpFace(fs));
            var secondSeq = fs.Emits.Skip(feBefore).Select(e => e.AngleDeg).ToList();
            check("[tr-fail] 两轮序列一致", firstSeq.Count == secondSeq.Count && firstSeq.Zip(secondSeq).All(p => Math.Abs(p.First - p.Second) < 1e-9));
        }
    }

    // ---- helpers ----
    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);
    private static bool FailChinese((bool Ok, string Error) r) => !r.Ok && HasChinese(r.Error);
    private static bool LastIs(RecFacingSink s, string eventId, double expectDeg)
        => s.Emits.Count > 0 && s.Emits[^1].EventId == eventId && Math.Abs(s.Emits[^1].AngleDeg - expectDeg) < 1e-9;
    private static string DumpFace(RecFacingSink s) => string.Join(";", s.Emits.Select(e => $"{e.EventId}:{e.AngleDeg:F3}@{e.ShowTimeMs}"));
    private static string DumpMove(RecMovementSink s) => string.Join(";", s.Emits.Select(e => $"({e.Dx:F3},{e.Dz:F3})->({e.TargetX:F3},{e.TargetZ:F3})@{e.ShowTimeMs}"));

    private sealed class RecFacingSink : IX1FacingSink
    {
        public sealed class Emit
        {
            public string EventId = ""; public double AngleDeg; public long ShowTimeMs;
        }
        public readonly List<Emit> Emits = new();
        public readonly List<string> Releases = new();
        public Action<Emit>? OnEmit;
        public bool ThrowOnEmit;
        public bool ThrowOnRelease;
        public void EmitFacing(string eventId, double angleDeg, long showTimeMs)
        {
            var e = new Emit { EventId = eventId, AngleDeg = angleDeg, ShowTimeMs = showTimeMs };
            Emits.Add(e);
            OnEmit?.Invoke(e);
            if (ThrowOnEmit) throw new InvalidOperationException("朝向槽炸了");
        }
        public void ReleaseFacing(string eventId)
        {
            Releases.Add(eventId);
            if (ThrowOnRelease) throw new InvalidOperationException("朝向释放炸了");
        }
    }

    private sealed class RecMovementSink : IX1MovementSink
    {
        public sealed class Emit
        {
            public string EventId = ""; public double Dx; public double Dz; public double TargetX; public double TargetZ; public long ShowTimeMs;
        }
        public readonly List<Emit> Emits = new();
        public readonly List<string> Releases = new();
        public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs)
        {
            Emits.Add(new Emit { EventId = eventId, Dx = dx, Dz = dz, TargetX = targetX, TargetZ = targetZ, ShowTimeMs = showTimeMs });
        }
        public void ReleaseMovement(string eventId) => Releases.Add(eventId);
    }
}
