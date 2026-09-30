// 这个文件是干嘛的：X1 舞台中心朝向命名回归（x1-stage-center）：显式中心输入、方位几何、
// 优先级与观测共用快照、失败停与停止生命周期（TASK-20260911-X1-OFFLINE-STAGE-CENTER）。
using ChoreoHelper;

internal static class X1StageCenterCases
{
    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 舞台中心朝向（{caseName}{(red ? " --red" : "")}） ==");
        RunStageCenterCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        return fails > 0 ? 1 : 0;
    }

    public static void RunStageCenterCase(CheckFn check)
    {
        RunInputs(check);
        RunGeometry(check);
        RunPrecedence(check);
        RunFailure(check);
        RunStopLifecycle(check);
    }

    // ---- AC-1 显式中心输入 ----
    private static void RunInputs(CheckFn check)
    {
        var good = new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 };
        check("[sc-inputs] 显式有限中心放行", X1InputValidation.ValidateFacing(good).Ok);
        check("[sc-inputs] 单演员捆绑放行", X1InputValidation.ValidateBundle("p1", null, null, new[] { good }).Ok);

        var noCenter = new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter };
        var onlyX = new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 1 };
        var onlyZ = new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterZ = 1 };
        var (ncOk, ncErr) = X1InputValidation.ValidateFacing(noCenter);
        check("[sc-inputs] 缺双轴中心拒绝且中文点名中心", !ncOk && HasChinese(ncErr) && ncErr.Contains("中心"), ncErr);
        check("[sc-inputs] 缺 z 拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(onlyX)));
        check("[sc-inputs] 缺 x 拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(onlyZ)));
        check("[sc-inputs] 无隐式原点（缺中心不放行）", !X1InputValidation.ValidateFacing(noCenter).Ok);
        var nanX = new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = double.NaN, StageCenterZ = 0 };
        var infZ = new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 0, StageCenterZ = double.PositiveInfinity };
        check("[sc-inputs] 中心 NaN 拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(nanX)));
        check("[sc-inputs] 中心 Infinity 拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(infZ)));

        var other = new X1FacingInput { EventId = "f-x", PerformerId = "p2", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 };
        check("[sc-inputs] 混入第二演员拒绝且中文", FailChinese(X1InputValidation.ValidateBundle("p1", null, null, new[] { good, other })));
        var undef = new X1FacingInput { EventId = "f-u", PerformerId = "p1", FacingMode = (X1FacingMode)999, StageCenterX = 1, StageCenterZ = 1 };
        check("[sc-inputs] 未定义枚举拒绝且中文", FailChinese(X1InputValidation.ValidateFacing(undef)));
        check("[sc-inputs] skip 策略拒绝且中文",
            FailChinese(X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 1, StageCenterZ = 1, FailurePolicy = X1FailurePolicy.Skip })));
        check("[sc-inputs] wait 策略拒绝且中文",
            FailChinese(X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 1, StageCenterZ = 1, FailurePolicy = X1FailurePolicy.Wait })));
        var curve = new X1MovementInput { EventId = "m-c", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5, IsCurveControlPoints = true };
        curve.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
        curve.Points.Add(new X1Waypoint { TMs = 1000, X = 1, Z = 0 });
        check("[sc-inputs] 未采样曲线仍拒绝且中文", FailChinese(X1InputValidation.ValidateMovement(curve)));

        // 拒绝先于构造且零槽调用
        var sink = new RecFacingSink();
        var (bok, berr, bexec) = X1FacingExecutor.TryCreate(noCenter, 0, 1000);
        check("[sc-inputs] 缺中心不构造执行器零槽", !bok && bexec == null && HasChinese(berr) && sink.Emits.Count == 0 && sink.Releases.Count == 0, berr);

        // 中心快照：构造后改输入不可重定向
        var mutable = new X1FacingInput { EventId = "f-snap", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 };
        var (sok, _, sexec) = X1FacingExecutor.TryCreate(mutable, 100, 1100);
        check("[sc-inputs] 构造成功且中心快照一致", sok && sexec != null && sexec!.StageCenterX == 10 && sexec.StageCenterZ == 20);
        mutable.StageCenterX = 999;
        mutable.StageCenterZ = 999;
        var (uok, uerr) = sexec!.Update(150, null, sink, 9, 20);
        check("[sc-inputs] 改输入后仍按原中心（90°）", uok && uerr == "" && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - 90) < 1e-9,
            uerr + " " + (sink.Emits.Count > 0 ? sink.Emits[0].AngleDeg.ToString() : "-"));

        // 旧模式调用方无需中心、无需新参数
        check("[sc-inputs] 固定角无需中心", X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f-fx", PerformerId = "p1", FixedAngleDeg = 90 }).Ok);
        check("[sc-inputs] 沿路径无需中心", X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f-ap", PerformerId = "p1", FacingMode = X1FacingMode.AlongPath }).Ok);

        var disp = new X1ShowDispatcher("p1");
        check("[sc-inputs] 分发器收显式中心朝向", disp.AddFacing(good).Ok);
        check("[sc-inputs] 分发器拒缺中心", !disp.AddFacing(noCenter).Ok);
        check("[sc-inputs] 分发器拒混演员", !disp.AddFacing(other).Ok);
    }

    // ---- AC-2 方位几何（执行器直测，[100,1100) 中心 (10,20)）----
    private static void RunGeometry(CheckFn check)
    {
        var input = new X1FacingInput { EventId = "g1", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 };
        var (ok, _, ex) = X1FacingExecutor.TryCreate(input, 100, 1100);
        check("[sc-geom] 构造通过", ok && ex != null);
        var sink = new RecFacingSink();
        var (before, _) = ex!.Update(99, null, sink, 10, 19);
        check("[sc-geom] 开始前零输出", before && sink.Emits.Count == 0);
        (double ox, double oz, double expect)[] sweep =
        {
            (10, 19, 0), (9, 20, 90), (10, 21, 180), (11, 20, 270), (9, 19, 45),
        };
        var t = 100;
        foreach (var (ox, oz, expect) in sweep)
        {
            sink.Emits.Clear();
            var (uok, uerr) = ex.Update(t, null, sink, ox, oz);
            check($"[sc-geom] 位置({ox},{oz})→{expect}°", uok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - expect) < 1e-9 && sink.Emits[0].ShowTimeMs == t,
                uerr + " " + DumpFace(sink));
            t += 100;
        }
        // 与中心重合：保持上次（45°），随后继续保持
        sink.Emits.Clear();
        var (c1ok, _) = ex.Update(t, null, sink, 10, 20);
        var (c2ok, _) = ex.Update(t + 100, null, sink, 10, 20);
        check("[sc-geom] 重合保持上次 45°", c1ok && c2ok && sink.Emits.Count == 2
            && Math.Abs(sink.Emits[0].AngleDeg - 45) < 1e-9 && Math.Abs(sink.Emits[1].AngleDeg - 45) < 1e-9, DumpFace(sink));
        // 归一化 [0,360)
        sink.Emits.Clear();
        ex.Update(t + 200, null, sink, 11, 19);
        check("[sc-geom] 负角归一 315°", sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - 315) < 1e-9, DumpFace(sink));
        check("[sc-geom] 全部输出角在 [0,360)", sink.Emits.All(e => e.AngleDeg >= 0 && e.AngleDeg < 360));
        var ends = sink.Emits.Count;
        var (e1ok, _) = ex.Update(1100, null, sink, 9, 20);
        var (e2ok, _) = ex.Update(1200, null, sink, 9, 20);
        check("[sc-geom] 结束时刻及之后零输出", e1ok && e2ok && sink.Emits.Count == ends);

        // 全新重合起步：首输出前零输出
        var fresh = new X1FacingInput { EventId = "g2", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 };
        var (fok, _, fex) = X1FacingExecutor.TryCreate(fresh, 100, 1100);
        var fsink = new RecFacingSink();
        var (f1ok, _) = fex!.Update(100, null, fsink, 10, 20);
        var (f2ok, _) = fex.Update(200, null, fsink, 10, 20);
        check("[sc-geom] 新执行器重合起步零输出", f1ok && f2ok && fsink.Emits.Count == 0, DumpFace(fsink));
        var (f3ok, _) = fex.Update(300, null, fsink, 9, 20);
        var (f4ok, _) = fex.Update(400, null, fsink, 10, 20);
        check("[sc-geom] 移出后首输出 90° 随后保持", f3ok && f4ok && fsink.Emits.Count == 2
            && Math.Abs(fsink.Emits[0].AngleDeg - 90) < 1e-9 && Math.Abs(fsink.Emits[1].AngleDeg - 90) < 1e-9, DumpFace(fsink));

        // 缺观测位置拒绝
        var msink = new RecFacingSink();
        var (mok, merr) = fex.Update(350, null, msink);
        check("[sc-geom] 缺观测位置拒绝且中文零输出", !mok && HasChinese(merr) && msink.Emits.Count == 0, merr);
        // 观测非有限（NaN 分量 → 方位非有限）
        var nsink = new RecFacingSink();
        var (nok, nerr) = fex.Update(360, null, nsink, double.NaN, 0);
        check("[sc-geom] 观测 NaN 拒绝且中文零输出", !nok && HasChinese(nerr) && nsink.Emits.Count == 0, nerr);
        // 有限坐标相减溢出
        var big = new X1FacingInput { EventId = "g3", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = double.MaxValue, StageCenterZ = double.MaxValue };
        var (bok, _, bex) = X1FacingExecutor.TryCreate(big, 100, 1100);
        var bsink = new RecFacingSink();
        var (ovok, overr) = bex!.Update(150, null, bsink, -double.MaxValue, -double.MaxValue);
        check("[sc-geom] 有限坐标减法溢出拒绝且中文零输出", !ovok && HasChinese(overr) && bsink.Emits.Count == 0, overr);
    }

    // ---- AC-3 优先级与观测共用 ----
    private static void RunPrecedence(CheckFn check)
    {
        // P1 纯朝向（无移动）：舞台中心可用，过期后零读取零输出
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            Func<long, (double X, double Z)> script = tt => tt == 100 ? (9, 20) : tt == 200 ? (10, 21) : (10, 20);
            disp.ObservedProvider = () => { reads++; return script(t); };
            disp.AddFacing(new X1FacingInput { EventId = "f-only", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-only", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-prec] 纯朝向读取恰一次并出 90°", reads == 1 && fs.Emits.Count == 1 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-9 && fs.Emits[0].EventId == "f-only", "reads=" + reads + " " + DumpFace(fs));
            t = 200; runner.Tick();
            check("[sc-prec] 纯朝向第二击 180°", reads == 2 && fs.Emits.Count == 2 && Math.Abs(fs.Emits[1].AngleDeg - 180) < 1e-9, DumpFace(fs));
            for (var tt = 300; tt <= 1000; tt += 100) { t = tt; runner.Tick(); }
            var readsAt1000 = reads;
            var emitsAt1000 = fs.Emits.Count;
            check("[sc-prec] 激活期内重合保持（每更新仍至多一条）", fs.Emits.Skip(2).All(e => Math.Abs(e.AngleDeg - 180) < 1e-9));
            t = 1100; runner.Tick();
            check("[sc-prec] 过期后零读取零输出", reads == readsAt1000 && fs.Emits.Count == emitsAt1000, "reads=" + reads);
            for (var i = 0; i < 12 && runner.State != ShowState.Completed; i++) { t += 200; runner.Tick(); }
            check("[sc-prec] 纯朝向至 Completed 且释放恰一次", runner.State == ShowState.Completed && fs.Releases.Count == 1 && fs.Releases[0] == "f-only",
                runner.State + " " + string.Join(",", fs.Releases));
        }
        // P2 旧模式纯朝向无需观测供给
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = null;
            disp.AddFacing(new X1FacingInput { EventId = "f-fix", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 1000 };
            pkg.Events.Add(new ShowEvent { Id = "f-fix", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 200; runner.Tick();
            check("[sc-prec] 固定角纯朝向无需观测（无供给照常出角）", runner.State == ShowState.Playing && fs.Emits.Count == 1 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-6,
                runner.State + " " + DumpFace(fs));
        }
        // P3 移动 + 舞台中心：独立优先、同快照、每更新至多一条朝向意图、每更新恰一次读取
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => { reads++; return (0.2, 0.1); };
            var mi = new X1MovementInput { EventId = "m-p3", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 2, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-p3", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 4000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p3", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-p3", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            var oracle = X1MovementExecutor.NormalizeDeg(Math.Atan2(10 - 0.2, 20 - 0.1) * 180.0 / Math.PI);
            check("[sc-prec] 重叠前移动切向 45°", fs.Emits.Count == 1 && fs.Emits[0].EventId == "m-p3" && Math.Abs(fs.Emits[0].AngleDeg - 45) < 1e-9, DumpFace(fs));
            var readsBefore = reads;
            var moveEmitsBefore = ms.Emits.Count;
            t = 300; runner.Tick();
            check("[sc-prec] 重叠期独立舞台中心获胜（观测方位）",
                fs.Emits.Count == 2 && fs.Emits[1].EventId == "f-p3" && Math.Abs(fs.Emits[1].AngleDeg - oracle) < 1e-9, DumpFace(fs) + " oracle=" + oracle);
            check("[sc-prec] 本更新读取恰一次（移动+舞台中心共用）", reads - readsBefore == 1, "delta=" + (reads - readsBefore));
            check("[sc-prec] 同快照供移动修正（目标-观测）",
                ms.Emits.Count == moveEmitsBefore + 1 && Math.Abs(ms.Emits[^1].Dx - 0.1) < 1e-9 && Math.Abs(ms.Emits[^1].Dz - 0.2) < 1e-9, DumpMove(ms));
            var perTickOk = true;
            for (var step = 400; step <= 1900; step += 100)
            {
                var before = fs.Emits.Count;
                t = step; runner.Tick();
                if (fs.Emits.Count - before > 1) perTickOk = false;
            }
            check("[sc-prec] 每更新至多一条朝向意图", perTickOk);
            var readsAt1900 = reads;
            var emitsAt1900 = fs.Emits.Count;
            t = 2000; runner.Tick();
            var readsAtEndTick = reads;
            t = 2100; runner.Tick();
            // 终点帧入场仍恰读一次做到达校验（存量移动语义），其后零读取零输出
            check("[sc-prec] 全部过期后零读取零输出", readsAtEndTick - readsAt1900 == 1 && reads == readsAtEndTick && fs.Emits.Count == emitsAt1900,
                "reads=" + reads + "/" + readsAt1900 + " emits=" + fs.Emits.Count + "/" + emitsAt1900);
        }
        // P4 不同起点独立事件互压 + 平手起点
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => { reads++; return (9, 20); };
            disp.AddFacing(new X1FacingInput { EventId = "f-fix4", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
            disp.AddFacing(new X1FacingInput { EventId = "f-sc4", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 21 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-fix4", Kind = "facing", StartMs = 100, DurationMs = 900, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-sc4", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            var r0 = reads;
            check("[sc-prec] 仅固定角激活出 90° 零读取", fs.Emits[^1].EventId == "f-fix4" && Math.Abs(fs.Emits[^1].AngleDeg - 90) < 1e-9 && reads == r0, DumpFace(fs));
            t = 500; runner.Tick();
            check("[sc-prec] 晚起点舞台中心压过固定角（45°）且恰一次读取",
                fs.Emits[^1].EventId == "f-sc4" && Math.Abs(fs.Emits[^1].AngleDeg - 45) < 1e-9 && reads - r0 == 1, DumpFace(fs) + " dreads=" + (reads - r0));
            var r1 = reads;
            t = 900; runner.Tick();
            check("[sc-prec] 舞台中心过期后回固定角 90° 零读取", fs.Emits[^1].EventId == "f-fix4" && Math.Abs(fs.Emits[^1].AngleDeg - 90) < 1e-9 && reads == r1, DumpFace(fs));
        }
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => { reads++; return (9, 20); };
            disp.AddFacing(new X1FacingInput { EventId = "f-sc5", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 21 });
            disp.AddFacing(new X1FacingInput { EventId = "f-fix5", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 270 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-sc5", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-fix5", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var r0 = reads;
            t = 300; runner.Tick();
            check("[sc-prec] 舞台中心激活期出 45° 且恰一次读取", fs.Emits.Count == 1 && fs.Emits[^1].EventId == "f-sc5" && Math.Abs(fs.Emits[^1].AngleDeg - 45) < 1e-9 && reads - r0 == 1, DumpFace(fs) + " dreads=" + (reads - r0));
            var r1 = reads;
            t = 500; runner.Tick();
            check("[sc-prec] 被压制舞台中心自身不触发读取（固定角 270°）",
                fs.Emits[^1].EventId == "f-fix5" && Math.Abs(fs.Emits[^1].AngleDeg - 270) < 1e-9 && reads == r1, DumpFace(fs) + " dreads=" + (reads - r1));
        }
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => { reads++; return (9, 20); };
            disp.AddFacing(new X1FacingInput { EventId = "f-a", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 21 });
            disp.AddFacing(new X1FacingInput { EventId = "f-b", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 21, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-b", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-a", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 400; runner.Tick();
            check("[sc-prec] 平手起点按事件序取小（f-a 的 45°，非 f-b 的 90°）",
                fs.Emits.Count == 1 && fs.Emits[0].EventId == "f-a" && Math.Abs(fs.Emits[0].AngleDeg - 45) < 1e-9 && reads == 1, DumpFace(fs));
        }
        // P5 舞台中心结束后回移动切向，无残留中心角
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
            disp.AddFacing(new X1FacingInput { EventId = "f-p5", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 5000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p5", Kind = "movement", StartMs = 0, DurationMs = 3000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-p5", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[sc-prec] 结束前舞台中心 90°", fs.Emits[^1].EventId == "f-p5" && Math.Abs(fs.Emits[^1].AngleDeg - 90) < 1e-9, DumpFace(fs));
            t = 700; runner.Tick();
            check("[sc-prec] 结束后回移动切向 0° 无残留中心角", fs.Emits[^1].EventId == "m-p5" && Math.Abs(fs.Emits[^1].AngleDeg - 0) < 1e-9, DumpFace(fs));
            check("[sc-prec] 结束后无舞台中心输出", fs.Emits.Count(e => e.EventId == "f-p5") == 1);
        }
    }

    // ---- AC-4 失败停 ----
    private static void RunFailure(CheckFn check)
    {
        // F1 观测供给缺失（纯朝向）：事件 id + 中文原因，故障停，零朝向输出
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = null;
            disp.AddFacing(new X1FacingInput { EventId = "f-f1", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f1", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-fail] 供给缺失 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f1") && HasChinese(runner.StopReason), runner.StopReason);
            check("[sc-fail] 供给缺失零朝向输出", fs.Emits.Count == 0 && fs.Releases.Count == 1, DumpFace(fs));
        }
        // F2 供给抛异常
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => throw new InvalidOperationException("观测供给炸了");
            disp.AddFacing(new X1FacingInput { EventId = "f-f2", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f2", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-fail] 供给异常 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f2") && HasChinese(runner.StopReason), runner.StopReason);
            check("[sc-fail] 供给异常零输出", fs.Emits.Count == 0);
        }
        // F3 非有限观测（含移动）：本更新零移动修正零朝向输出
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => t <= 0 ? (0, 0) : (double.NaN, 0);
            var mi = new X1MovementInput { EventId = "m-f3", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f3", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f3", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f3", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var moveEmitsAt0 = ms.Emits.Count;
            t = 100; runner.Tick();
            check("[sc-fail] 非有限观测 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f3") && HasChinese(runner.StopReason), runner.StopReason);
            check("[sc-fail] 共享观测无效时本更新零移动修正零朝向", ms.Emits.Count == moveEmitsAt0 && fs.Emits.Count == 0);
        }
        // F4 观测回调重入停止：本更新剩余移动/朝向输出全部抑制
        {
            long t = 0;
            ShowRunner? holder = null;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () =>
            {
                if (t >= 100) holder!.RequestStop("观测内重入停止");
                return (9, 20);
            };
            var mi = new X1MovementInput { EventId = "m-f4", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f4", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f4", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f4", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            holder = runner;
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var moveEmitsAt0 = ms.Emits.Count;
            t = 100; runner.Tick();
            check("[sc-fail] 观测重入停止 Loaded", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            check("[sc-fail] 观测重入后本更新零移动修正零朝向", ms.Emits.Count == moveEmitsAt0 && fs.Emits.Count == 0, DumpMove(ms) + " " + DumpFace(fs));
            check("[sc-fail] 观测重入后释放各恰一次", ms.Releases.Count == 1 && fs.Releases.Count == 1, "m=" + ms.Releases.Count + " f=" + fs.Releases.Count);
            var dc = disp.Dispatched.Count;
            for (var i = 0; i < 5; i++) { t += 500; runner.Tick(); }
            runner.RequestStop("重复");
            check("[sc-fail] 观测重入后零泄漏", disp.Dispatched.Count == dc && ms.Emits.Count == moveEmitsAt0 && fs.Emits.Count == 0);
        }
        // F5 朝向槽异常：已发移动修正不被追回，释放恰一次
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (9, 20);
            var mi = new X1MovementInput { EventId = "m-f5", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f5", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f5", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f5", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-fail] 前置成功期已出舞台中心 90°", fs.Emits.Count == 1 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-9, DumpFace(fs));
            fs.ThrowOnEmit = true;
            var moveEmitsBefore = ms.Emits.Count;
            t = 200; runner.Tick();
            check("[sc-fail] 朝向槽异常 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f5") && HasChinese(runner.StopReason), runner.StopReason);
            check("[sc-fail] 同更新已发移动修正不被追回", ms.Emits.Count == moveEmitsBefore + 1, DumpMove(ms));
            check("[sc-fail] 朝向释放恰一次", fs.Releases.Count == 1 && ms.Releases.Count == 1);
        }
        // F6 守卫先于输出
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => { reads++; return (9, 20); };
            disp.AddFacing(new X1FacingInput { EventId = "f-f6", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f6", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            var guard = new GuardSnapshot();
            runner.SetGuardProvider(() => guard);
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            guard.CharacterPresent = false;
            var reads0 = reads;
            t = 100; runner.Tick();
            check("[sc-fail] 守卫失败 Faulted 先于任何输出（零读取零朝向）",
                runner.State == ShowState.Faulted && reads == reads0 && fs.Emits.Count == 0, runner.StopReason);
        }
    }

    // ---- AC-5 停止生命周期 ----
    private static void RunStopLifecycle(CheckFn check)
    {
        BuiltStopStage Build()
        {
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (9, 20);
            var mi = new X1MovementInput { EventId = "m-e", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 0, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-e", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 9000 };
            pkg.Events.Add(new ShowEvent { Id = "m-e", Kind = "movement", StartMs = 100, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-e", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "e-post", Kind = "motion", StartMs = 5000, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
            return new BuiltStopStage { Package = pkg, Dispatcher = disp, FSink = fs, MSink = ms };
        }
        // S1 主动停止：前缀保留、零后续、释放各恰一次
        {
            long t = 0;
            var ctx = Build();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            t = 600; runner.Tick();
            check("[sc-stop] 前置 Playing 且已出舞台中心 90°", runner.State == ShowState.Playing
                && ctx.FSink.Emits.Any(e => e.EventId == "f-e" && Math.Abs(e.AngleDeg - 90) < 1e-9), runner.State + " " + DumpFace(ctx.FSink));
            runner.RequestStop("网页紧急停止");
            check("[sc-stop] 主动停止 Loaded", runner.State == ShowState.Loaded);
            var dc = ctx.Dispatcher.Dispatched.Count;
            var me = ctx.MSink.Emits.Count;
            var fe = ctx.FSink.Emits.Count;
            for (var i = 0; i < 12; i++) { t += 1000; runner.Tick(); }
            runner.RequestStop("重复");
            check("[sc-stop] 停后零后续（含待发动作）", ctx.Dispatcher.Dispatched.Count == dc && ctx.MSink.Emits.Count == me && ctx.FSink.Emits.Count == fe);
            check("[sc-stop] 释放各恰一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
        }
        // S2 守卫故障停
        {
            long t = 0;
            var ctx = Build();
            var guard = new GuardSnapshot();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => guard);
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 600; runner.Tick();
            guard.InCombat = true;
            var dc = ctx.Dispatcher.Dispatched.Count;
            var me = ctx.MSink.Emits.Count;
            var fe = ctx.FSink.Emits.Count;
            t += 500; runner.Tick();
            check("[sc-stop] 守卫故障 Faulted 零后续", runner.State == ShowState.Faulted
                && ctx.Dispatcher.Dispatched.Count == dc && ctx.MSink.Emits.Count == me && ctx.FSink.Emits.Count == fe, runner.StopReason);
        }
        // S3 朝向槽回调重入停止
        {
            long t = 0;
            var ctx = Build();
            ShowRunner? holder = null;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            holder = runner;
            runner.SetGuardProvider(() => new GuardSnapshot());
            ctx.FSink.OnEmit = _ => holder!.RequestStop("朝向槽内重入停止");
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-stop] 朝向槽重入 Loaded", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            check("[sc-stop] 朝向槽重入释放各恰一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
            var dc = ctx.Dispatcher.Dispatched.Count;
            var me = ctx.MSink.Emits.Count;
            var fe = ctx.FSink.Emits.Count;
            for (var i = 0; i < 6; i++) { t += 1000; runner.Tick(); }
            runner.RequestStop("重复");
            check("[sc-stop] 朝向槽重入后零泄漏", ctx.Dispatcher.Dispatched.Count == dc && ctx.MSink.Emits.Count == me && ctx.FSink.Emits.Count == fe);
        }
        // S4 释放抛异常：各释放仍恰尝试一次
        {
            long t = 0;
            var ctx = Build();
            ctx.FSink.ThrowOnRelease = true;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 600; runner.Tick();
            runner.RequestStop("停止");
            check("[sc-stop] 释放异常仍 Loaded/Faulted", runner.State is ShowState.Loaded or ShowState.Faulted, runner.State.ToString());
            check("[sc-stop] 释放异常双释放各尝试一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
            var mr = ctx.MSink.Releases.Count;
            var fr = ctx.FSink.Releases.Count;
            runner.RequestStop("重复");
            t += 200; runner.Tick();
            check("[sc-stop] 释放异常不重复释放", ctx.MSink.Releases.Count == mr && ctx.FSink.Releases.Count == fr);
        }
        // S5 恢复不自动复演；显式 Arm+Start 唯一重演；新舞台中心无上一轮角度残留
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            Func<long, (double X, double Z)> script = tt => tt == 100 ? (9, 20) : (10, 20);
            disp.ObservedProvider = () => script(t);
            disp.AddFacing(new X1FacingInput { EventId = "f-r", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "f-r", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-stop] 首轮已出 90°", fs.Emits.Count == 1 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-9, DumpFace(fs));
            runner.RequestStop("停");
            var dc = disp.Dispatched.Count;
            var fe = fs.Emits.Count;
            for (var i = 0; i < 3; i++) { t += 1000; runner.Tick(); }
            check("[sc-stop] 恢复+时钟前进不自动复演", runner.State == ShowState.Loaded && disp.Dispatched.Count == dc && fs.Emits.Count == fe);
            check("[sc-stop] 显式 Arm 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
            script = tt => tt <= 100 ? (10, 20) : (10, 21);
            t = 0; runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[sc-stop] 重演重合起步无上轮角度残留（零输出）", fs.Emits.Count == fe, DumpFace(fs));
            t = 200; runner.Tick();
            check("[sc-stop] 重演移出后出全新 180°", fs.Emits.Count == fe + 1 && Math.Abs(fs.Emits[^1].AngleDeg - 180) < 1e-9, DumpFace(fs));
            check("[sc-stop] 重演期间 Playing", runner.State == ShowState.Playing, runner.State + " " + runner.StopReason);
        }
        // S6 完成语义：清扫恰一次、释放恰一次
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (9, 20);
            disp.AddFacing(new X1FacingInput { EventId = "f-c", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 10, StageCenterZ = 20 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 1500 };
            pkg.Events.Add(new ShowEvent { Id = "f-c", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            for (var i = 0; i < 16 && runner.State != ShowState.Completed; i++) { t += 200; runner.Tick(); }
            var emitsAtEnd = fs.Emits.Count;
            check("[sc-stop] 完成 Completed 清扫恰一次", runner.State == ShowState.Completed && runner.StopCleanupRuns == 1, runner.State.ToString());
            check("[sc-stop] 完成后释放恰一次零追加输出", fs.Releases.Count == 1 && fs.Releases[0] == "f-c");
            t += 1000; runner.Tick();
            check("[sc-stop] 完成后零追加输出", fs.Emits.Count == emitsAtEnd);
        }
    }

    // ---- helpers ----
    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);
    private static bool FailChinese((bool Ok, string Error) r) => !r.Ok && HasChinese(r.Error);
    private static string DumpFace(RecFacingSink s) => string.Join(";", s.Emits.Select(e => $"{e.EventId}:{e.AngleDeg:F3}@{e.ShowTimeMs}"));
    private static string DumpMove(RecMovementSink s) => string.Join(";", s.Emits.Select(e => $"({e.Dx:F3},{e.Dz:F3})->({e.TargetX:F3},{e.TargetZ:F3})@{e.ShowTimeMs}"));

    private sealed class BuiltStopStage
    {
        public ShowPackage Package = new();
        public X1ShowDispatcher Dispatcher = new("p1");
        public RecFacingSink FSink = new();
        public RecMovementSink MSink = new();
    }

    // ---- recording sinks ----
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
