// 这个文件是干嘛的：X1 离线共享角度严格区间命名回归（x1-angle-range）：NormalizeDeg 恰 360 归零与全消费者一致性。
using ChoreoHelper;

internal static class X1AngleRangeCases
{
    private const string Sentinel = "X1_ANGLE_RANGE_ASSERTION";

    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 角度严格区间（{caseName}{(red ? " --red" : "")}） ==");
        RunAngleRangeCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            Console.WriteLine(Sentinel);
            return 1;
        }
        return 0;
    }

    public static void RunAngleRangeCase(CheckFn check)
    {
        RunHelperMatrix(check);
        RunConsumers(check);
        RunLifecycle(check);
        RunStopReplay(check);
    }

    private static long Bits(double v) => BitConverter.DoubleToInt64Bits(v);
    private static bool IsPosZero(double v) => Bits(v) == 0L;
    private static bool IsNegZero(double v) => Bits(v) == unchecked((long)0x8000000000000000UL);
    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);
    private static string R(double v) => v.ToString("R");

    // ---- AC-1 共享助手直接矩阵：独立精确字面期望，逐位锁定 ----
    private static void RunHelperMatrix(CheckFn check)
    {
        // 恰 360 行：修复后必须为正零（修复前为恰好 360，红基线）。
        // -2.2918311805232927e-14 = atan2(-4e-16,1) 度数；-1e-14/-2.8e-14 在 360 处 ulp/2 内同样舍入为 360。
        (string Name, double Input)[] zeroRows =
        {
            ("raw-atan2-tiny-neg", -2.2918311805232927e-14),
            ("neg-epsilon", -double.Epsilon),
            ("neg-1e-14", -1e-14),
            ("neg-2.8e-14", -2.8e-14),
        };
        foreach (var (name, inp) in zeroRows)
        {
            var got = X1MovementExecutor.NormalizeDeg(inp);
            check("[ar-helper] " + name + " → 恰正零",
                IsPosZero(got) && got >= 0 && got < 360,
                "in=" + R(inp) + " got=" + R(got) + " bits=" + Bits(got).ToString("X16"));
        }
        // 相邻保持行：幅度刚好超过舍入阈值，必须保持 359.99999999999994（epsilon 快照突变会被杀死）。
        (string Name, double Input)[] keepRows =
        {
            ("adj-from-minus5e-16", -2.8647889756541165e-14),
            ("adj-from-minus8e-16", -4.5836623610465855e-14),
            ("adj-from-minus1e-15", -5.729577951308233e-14),
            ("neg-2.9e-14", -2.9e-14),
            ("neg-5e-14", -5e-14),
        };
        const double Keep = 359.99999999999994;
        foreach (var (name, inp) in keepRows)
        {
            var got = X1MovementExecutor.NormalizeDeg(inp);
            check("[ar-helper] " + name + " → 359.99999999999994 逐位保持",
                got == Keep && Bits(got) == Bits(Keep) && got >= 0 && got < 360,
                "in=" + R(inp) + " got=" + R(got) + " bits=" + Bits(got).ToString("X16"));
        }
        // 微小正值与零：原样保持（含符号零区分）。
        {
            const double TinyPos = 2.2918311805232927e-14;
            var got = X1MovementExecutor.NormalizeDeg(TinyPos);
            check("[ar-helper] 微小正值原样保持", got == TinyPos && Bits(got) == Bits(TinyPos) && got > 0 && got < 1e-9, "got=" + R(got));
        }
        {
            var zp = X1MovementExecutor.NormalizeDeg(0.0);
            check("[ar-helper] +0 保持正零", IsPosZero(zp), "got=" + R(zp) + " bits=" + Bits(zp).ToString("X16"));
            var zn = X1MovementExecutor.NormalizeDeg(-0.0);
            check("[ar-helper] -0 逐位保持负零（非清理目标）", IsNegZero(zn), "got=" + R(zn) + " bits=" + Bits(zn).ToString("X16"));
        }
        // 普通负角与倍数：独立精确期望。
        check("[ar-helper] -90 → 270", X1MovementExecutor.NormalizeDeg(-90.0) == 270.0, R(X1MovementExecutor.NormalizeDeg(-90.0)));
        check("[ar-helper] -180 → 180", X1MovementExecutor.NormalizeDeg(-180.0) == 180.0, R(X1MovementExecutor.NormalizeDeg(-180.0)));
        check("[ar-helper] -270 → 90", X1MovementExecutor.NormalizeDeg(-270.0) == 90.0, R(X1MovementExecutor.NormalizeDeg(-270.0)));
        check("[ar-helper] -0.5 → 359.5", X1MovementExecutor.NormalizeDeg(-0.5) == 359.5, R(X1MovementExecutor.NormalizeDeg(-0.5)));
        check("[ar-helper] 90 → 90", X1MovementExecutor.NormalizeDeg(90.0) == 90.0, R(X1MovementExecutor.NormalizeDeg(90.0)));
        check("[ar-helper] 360 → 正零", IsPosZero(X1MovementExecutor.NormalizeDeg(360.0)), R(X1MovementExecutor.NormalizeDeg(360.0)));
        check("[ar-helper] 720 → 正零", IsPosZero(X1MovementExecutor.NormalizeDeg(720.0)), R(X1MovementExecutor.NormalizeDeg(720.0)));
        {
            var n360 = X1MovementExecutor.NormalizeDeg(-360.0);
            check("[ar-helper] -360 → 负零逐位保持", IsNegZero(n360), "got=" + R(n360) + " bits=" + Bits(n360).ToString("X16"));
            var n720 = X1MovementExecutor.NormalizeDeg(-720.0);
            check("[ar-helper] -720 → 负零逐位保持", IsNegZero(n720), "got=" + R(n720) + " bits=" + Bits(n720).ToString("X16"));
        }
        // 极端有限值：独立 fmod 期望（C# % 为截断余数，与 fmod 同口径）。
        check("[ar-helper] 1e308 → 296", X1MovementExecutor.NormalizeDeg(1e308) == 296.0, R(X1MovementExecutor.NormalizeDeg(1e308)));
        check("[ar-helper] -1e308 → 64", X1MovementExecutor.NormalizeDeg(-1e308) == 64.0, R(X1MovementExecutor.NormalizeDeg(-1e308)));
        check("[ar-helper] 1e16 → 280", X1MovementExecutor.NormalizeDeg(1e16) == 280.0, R(X1MovementExecutor.NormalizeDeg(1e16)));
        // 非有限传播：与修复前一致为 NaN（非新准入执行输入）。
        check("[ar-helper] NaN → NaN", double.IsNaN(X1MovementExecutor.NormalizeDeg(double.NaN)), R(X1MovementExecutor.NormalizeDeg(double.NaN)));
        check("[ar-helper] +Inf → NaN", double.IsNaN(X1MovementExecutor.NormalizeDeg(double.PositiveInfinity)), R(X1MovementExecutor.NormalizeDeg(double.PositiveInfinity)));
        check("[ar-helper] -Inf → NaN", double.IsNaN(X1MovementExecutor.NormalizeDeg(double.NegativeInfinity)), R(X1MovementExecutor.NormalizeDeg(double.NegativeInfinity)));
        // 全有限行严格区间抽查。
        foreach (var v in new double[] { -2.2918311805232927e-14, -1e-14, -2.9e-14, -90.0, 0.0, 359.5, 1e308 })
        {
            var g = X1MovementExecutor.NormalizeDeg(v);
            check("[ar-helper] 有限 " + R(v) + " 严格 [0,360)",
                !double.IsNaN(g) && X1InputValidation.IsFiniteDouble(g) && g >= 0 && g < 360, "got=" + R(g));
        }
    }

    // ---- AC-2 全消费者：固定角/沿路径/过渡/舞台中心/他演员/移动切向与分发 movement-only ----
    private static void RunConsumers(CheckFn check)
    {
        const double TinyNeg = -2.2918311805232927e-14;
        const double TinyPos = 2.2918311805232927e-14;
        const double Keep = 359.99999999999994;
        const double AdjNeg = -2.8647889756541165e-14;

        // 固定角直测。
        {
            var (ok, _, ex) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-fix", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = TinyNeg }, 100, 1100);
            var sink = new RecFacingSink();
            check("[ar-fixed] 构造通过", ok && ex != null);
            if (ex != null)
            {
                ex.Update(100, null, sink);
                check("[ar-fixed] 微小负角 → 恰正零", sink.Emits.Count == 1 && IsPosZero(sink.Emits[0].AngleDeg) && sink.Emits[0].EventId == "ar-fix" && sink.Emits[0].ShowTimeMs == 100,
                    DumpFace(sink));
                sink.Emits.Clear();
                var (ok2, _, ex2) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-fix2", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = AdjNeg }, 100, 1100);
                ex2!.Update(100, null, sink);
                check("[ar-fixed] 相邻负角保持 359.99999999999994", ok2 && sink.Emits.Count == 1 && sink.Emits[0].AngleDeg == Keep && Bits(sink.Emits[0].AngleDeg) == Bits(Keep), DumpFace(sink));
                sink.Emits.Clear();
                var (ok3, _, ex3) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-fix3", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = TinyPos }, 100, 1100);
                ex3!.Update(100, null, sink);
                check("[ar-fixed] 微小正值原样保持", ok3 && sink.Emits.Count == 1 && sink.Emits[0].AngleDeg == TinyPos, DumpFace(sink));
                sink.Emits.Clear();
                var (ok4, _, ex4) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-fix4", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = -0.0 }, 100, 1100);
                ex4!.Update(100, null, sink);
                check("[ar-fixed] -0 保持负零", ok4 && sink.Emits.Count == 1 && IsNegZero(sink.Emits[0].AngleDeg), DumpFace(sink) + " bits=" + (sink.Emits.Count == 1 ? Bits(sink.Emits[0].AngleDeg).ToString("X16") : "-"));
            }
        }
        // 沿路径直接切向供给 + 保持。
        {
            var (ok, _, ex) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-ap", PerformerId = "p1", FacingMode = X1FacingMode.AlongPath }, 100, 1100);
            var sink = new RecFacingSink();
            check("[ar-along] 构造通过", ok && ex != null);
            if (ex != null)
            {
                ex.Update(100, TinyNeg, sink);
                check("[ar-along] 直接微小负切向 → 恰正零", sink.Emits.Count == 1 && IsPosZero(sink.Emits[0].AngleDeg), DumpFace(sink));
                ex.Update(200, null, sink);
                check("[ar-along] 无切向保持正零（非 360/NaN）", sink.Emits.Count == 2 && IsPosZero(sink.Emits[1].AngleDeg), DumpFace(sink));
                var fresh = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-ap0", PerformerId = "p1", FacingMode = X1FacingMode.AlongPath }, 100, 1100).Exec;
                var fsink = new RecFacingSink();
                fresh!.Update(100, null, fsink);
                check("[ar-along] 首输出前零输出", fsink.Emits.Count == 0, DumpFace(fsink));
                var sink2 = new RecFacingSink();
                var (ok2, _, ex2) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-ap2", PerformerId = "p1", FacingMode = X1FacingMode.AlongPath }, 100, 1100);
                ex2!.Update(100, AdjNeg, sink2);
                check("[ar-along] 相邻负切向保持 359.99999999999994", ok2 && sink2.Emits.Count == 1 && sink2.Emits[0].AngleDeg == Keep, DumpFace(sink2));
            }
        }
        // 移动切向双分支（TryGetTangentDeg 两段选择分支）。
        {
            var mi = new X1MovementInput { EventId = "ar-mtan", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 1000, X = -4e-16, Z = 1 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = -8e-16, Z = 2 });
            var (ok, _, ex) = X1MovementExecutor.TryCreate(mi, 0);
            check("[ar-tangent] 构造通过", ok && ex != null);
            if (ex != null)
            {
                var b1 = ex.TryGetTangentDeg(500, out var a1);
                check("[ar-tangent] 分支一（段内）→ 恰正零", b1 && IsPosZero(a1), "a1=" + R(a1));
                var b2 = ex.TryGetTangentDeg(1000, out var a2);
                check("[ar-tangent] 分支二（整点取后段）→ 恰正零", b2 && IsPosZero(a2), "a2=" + R(a2));
                var b3 = ex.TryGetTangentDeg(1500, out var a3);
                check("[ar-tangent] 第二段段内 → 恰正零", b3 && IsPosZero(a3), "a3=" + R(a3));
            }
            var mn = new X1MovementInput { EventId = "ar-mtan-n", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mn.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mn.Points.Add(new X1Waypoint { TMs = 1000, X = -5e-16, Z = 1 });
            var (nok, _, nex) = X1MovementExecutor.TryCreate(mn, 0);
            var nb = nex!.TryGetTangentDeg(500, out var na);
            check("[ar-tangent] 相邻几何保持 359.99999999999994", nok && nb && na == Keep, "na=" + R(na));
        }
        // 过渡：t=0 与中段，调用方声明方向（常数 0 行 + 插值保持行）。
        {
            var (ok, _, ex) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-tr", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = TinyNeg, TransitionToDeg = TinyNeg }, 1000, 2000);
            var sink = new RecFacingSink();
            check("[ar-transition] 常数行构造通过", ok && ex != null);
            if (ex != null)
            {
                ex.Update(1000, null, sink);
                check("[ar-transition] t=0 → 恰正零", sink.Emits.Count == 1 && IsPosZero(sink.Emits[0].AngleDeg), DumpFace(sink));
                sink.Emits.Clear();
                ex.Update(1500, null, sink);
                check("[ar-transition] 中段 → 恰正零", sink.Emits.Count == 1 && IsPosZero(sink.Emits[0].AngleDeg), DumpFace(sink));
            }
            var (ok2, _, ex2) = X1FacingExecutor.TryCreate(new X1FacingInput { EventId = "ar-tr2", PerformerId = "p1", FacingMode = X1FacingMode.Transition, TransitionFromDeg = 0, TransitionToDeg = -5.729577951308233e-14 }, 1000, 2000);
            var sink2 = new RecFacingSink();
            ex2!.Update(1000, null, sink2);
            check("[ar-transition] 插值起点 0 保持", ok2 && sink2.Emits.Count == 1 && IsPosZero(sink2.Emits[0].AngleDeg), DumpFace(sink2));
            sink2.Emits.Clear();
            ex2.Update(1500, null, sink2);
            check("[ar-transition] 插值中段相邻值保持 359.99999999999994（无 epsilon 快照）", sink2.Emits.Count == 1 && sink2.Emits[0].AngleDeg == Keep, DumpFace(sink2));
        }
        // 舞台中心边界几何（中心 (0,1)，观测微调）。
        {
            var input = new X1FacingInput { EventId = "ar-sc", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 0, StageCenterZ = 1 };
            var (ok, _, ex) = X1FacingExecutor.TryCreate(input, 100, 1100);
            check("[ar-stage] 构造通过", ok && ex != null);
            if (ex != null)
            {
                (double Ox, string Tag, bool ExactZero, double Expect)[] rows =
                {
                    (4e-16, "dx=-4e-16", true, 0.0),
                    (5e-16, "dx=-5e-16", false, Keep),
                    (8e-16, "dx=-8e-16", false, Keep),
                    (1e-15, "dx=-1e-15", false, Keep),
                };
                var tick = 100;
                foreach (var (ox, tag, exactZero, expect) in rows)
                {
                    var sink = new RecFacingSink();
                    var (uok, uerr) = ex.Update(tick, null, sink, ox, 0);
                    var emitted = sink.Emits.Count == 1 ? sink.Emits[0].AngleDeg : double.NaN;
                    var valOk = exactZero ? IsPosZero(emitted) : emitted == expect;
                    check("[ar-stage] " + tag + (exactZero ? " → 恰正零" : " → 359.99999999999994"), uok && sink.Emits.Count == 1 && valOk, uerr + " emitted=" + R(emitted));
                    tick += 100;
                }
                var psink = new RecFacingSink();
                var (pok, _) = ex.Update(tick, null, psink, -4e-16, 0);
                check("[ar-stage] dx=+4e-16 保持微小正值", pok && psink.Emits.Count == 1 && psink.Emits[0].AngleDeg == TinyPos, DumpFace(psink));
                tick += 100;
                var zsink = new RecFacingSink();
                var (zok, _) = ex.Update(tick, null, zsink, 0, 0);
                check("[ar-stage] dx=0 保持正零", zok && zsink.Emits.Count == 1 && IsPosZero(zsink.Emits[0].AngleDeg), DumpFace(zsink));
            }
        }
        // 他演员奇偶：共享修复后输出必须与既有 [oa-wrap] 一致（未变）。
        {
            var input = new X1FacingInput { EventId = "ar-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
            var (ok, _, ex) = X1FacingExecutor.TryCreate(input, 100, 1100);
            check("[ar-other] 构造通过", ok && ex != null);
            if (ex != null)
            {
                (double Tx, string Tag, bool ExactZero, double Expect)[] rows =
                {
                    (-4e-16, "dx=-4e-16", true, 0.0),
                    (-5e-16, "dx=-5e-16", false, Keep),
                    (-8e-16, "dx=-8e-16", false, Keep),
                    (-1e-15, "dx=-1e-15", false, Keep),
                };
                var tick = 100;
                foreach (var (tx, tag, exactZero, expect) in rows)
                {
                    var sink = new RecFacingSink();
                    var (uok, uerr) = ex.Update(tick, null, sink, 0, 0, tx, 1);
                    var emitted = sink.Emits.Count == 1 ? sink.Emits[0].AngleDeg : double.NaN;
                    var valOk = exactZero ? IsPosZero(emitted) : emitted == expect;
                    check("[ar-other] " + tag + (exactZero ? " → 恰正零（与既有分支一致）" : " → 359.99999999999994（未变）"), uok && sink.Emits.Count == 1 && valOk, uerr + " emitted=" + R(emitted));
                    tick += 100;
                }
                var psink = new RecFacingSink();
                var (pok, _) = ex.Update(tick, null, psink, 0, 0, 4e-16, 1);
                check("[ar-other] dx=+4e-16 保持微小正值（未变）", pok && psink.Emits.Count == 1 && psink.Emits[0].AngleDeg == TinyPos, DumpFace(psink));
            }
        }
        // 分发器 movement-only 路径：移动切向归一后发射。
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (0, 0);
            var mi = new X1MovementInput { EventId = "ar-dm", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = -4e-16, Z = 1 });
            disp.AddMovement(mi);
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 4000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-dm", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[ar-dispatch] movement-only 边界切向 → 恰正零（事件/时刻一致）",
                fs.Emits.Count == 1 && fs.Emits[0].EventId == "ar-dm" && fs.Emits[0].ShowTimeMs == 100 && IsPosZero(fs.Emits[0].AngleDeg),
                DumpFace(fs));
            check("[ar-dispatch] 输出有限严格 [0,360)", fs.Emits.All(e => X1InputValidation.IsFiniteDouble(e.AngleDeg) && e.AngleDeg >= 0 && e.AngleDeg < 360));
        }
        // 移动派生沿路径独立事件：dispatcher 独立 AlongPath 获胜时同样归零。
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            var mi = new X1MovementInput { EventId = "ar-mm", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 3000, X = -4e-16, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "ar-ma", PerformerId = "p1", FacingMode = X1FacingMode.AlongPath });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 5000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-mm", Kind = "movement", StartMs = 0, DurationMs = 3000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-ma", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[ar-dispatch] 沿路径独立边界 → 恰正零", fs.Emits.Count >= 1 && IsPosZero(fs.Emits[^1].AngleDeg) && fs.Emits[^1].EventId == "ar-ma", DumpFace(fs));
        }
    }

    // ---- AC-3 边界生命周期：优先级/半开/保持/单读 ----
    private static void RunLifecycle(CheckFn check)
    {
        // 最新起点获胜 + 事件 id 平局 + 每更新至多一条 + [start,end) 排除。
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            var mi = new X1MovementInput { EventId = "ar-lm", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 1000, X = 0, Z = 1 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 0, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "ar-lf1", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = -2.2918311805232927e-14 });
            disp.AddFacing(new X1FacingInput { EventId = "ar-lf2", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 4000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-lm", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-lf1", Kind = "facing", StartMs = 100, DurationMs = 900, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-lf2", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[ar-life] 仅首独立激活出恰正零", fs.Emits.Count == 1 && fs.Emits[^1].EventId == "ar-lf1" && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
            var before = fs.Emits.Count;
            t = 500; runner.Tick();
            check("[ar-life] 晚起点压过边界角（90°）", fs.Emits.Count == before + 1 && fs.Emits[^1].EventId == "ar-lf2" && fs.Emits[^1].AngleDeg == 90.0, DumpFace(fs));
            t = 900; runner.Tick();
            check("[ar-life] 晚事件过期回首事件正零无残留", fs.Emits[^1].EventId == "ar-lf1" && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
            t = 1100; runner.Tick();
            check("[ar-life] 独立全过期回移动切向 0°", fs.Emits[^1].EventId == "ar-lm" && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
            // 静止段保持：1500 处于第二段静止（0,1)->(0,1)，保持上次 0。
            t = 1500; runner.Tick();
            check("[ar-life] 静止段保持正零（非 0/NaN 跳变）", fs.Emits[^1].AngleDeg == 0.0 && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
            // 每更新至多一条。
            var okOnce = true;
            for (var step = 1200; step <= 1900; step += 100)
            {
                var b = fs.Emits.Count;
                t = step; runner.Tick();
                if (fs.Emits.Count - b > 1) okOnce = false;
            }
            check("[ar-life] 每更新至多一条朝向意图", okOnce);
        }
        // 平手起点按事件序取小 + 零长窗口永不激活 + 首输出前零输出。
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.AddFacing(new X1FacingInput { EventId = "ar-lb", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 90 });
            disp.AddFacing(new X1FacingInput { EventId = "ar-la", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = -2.2918311805232927e-14 });
            disp.AddFacing(new X1FacingInput { EventId = "ar-lz", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 45 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-lb", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-la", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-lz", Kind = "facing", StartMs = 500, DurationMs = 0, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 400; runner.Tick();
            check("[ar-life] 平手起点按事件序取小（ar-la 正零）", fs.Emits.Count == 1 && fs.Emits[0].EventId == "ar-la" && IsPosZero(fs.Emits[0].AngleDeg), DumpFace(fs));
            t = 500; runner.Tick();
            check("[ar-life] 零长窗口不抢占（仍 ar-la）", fs.Emits[^1].EventId == "ar-la" && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
        }
        // 单次共享观测读：移动 + 舞台中心边界同快照。
        {
            long t = 0;
            var reads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => { reads++; return (4e-16, 0); };
            var mi = new X1MovementInput { EventId = "ar-ls-m", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 2, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "ar-ls-f", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 0, StageCenterZ = 1 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 4000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-ls-m", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-ls-f", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var r0 = reads;
            t = 300; runner.Tick();
            check("[ar-life] 边界舞台中心获胜正零", fs.Emits[^1].EventId == "ar-ls-f" && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
            check("[ar-life] 本更新自身恰读一次（共用快照）", reads - r0 == 1, "delta=" + (reads - r0));
        }
    }

    // ---- AC-4 停止/复演特性化：边界角演出上的既有生命周期 ----
    private static void RunStopReplay(CheckFn check)
    {
        BuiltStopRange Build()
        {
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (0, 0);
            var mi = new X1MovementInput { EventId = "ar-e-m", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 0, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "ar-e-f", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = -2.2918311805232927e-14 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 9000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-e-m", Kind = "movement", StartMs = 100, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-e-f", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "ar-e-post", Kind = "motion", StartMs = 5000, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
            return new BuiltStopRange { Package = pkg, Dispatcher = disp, FSink = fs, MSink = ms };
        }
        // S1 主动停止：前缀保留、零后续、释放各恰一次。
        {
            long t = 0;
            var ctx = Build();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            t = 600; runner.Tick();
            check("[ar-stop] 前置 Playing 且边界角正零", runner.State == ShowState.Playing
                && ctx.FSink.Emits.Any(e => e.EventId == "ar-e-f" && IsPosZero(e.AngleDeg)), runner.State + " " + DumpFace(ctx.FSink));
            runner.RequestStop("网页紧急停止");
            check("[ar-stop] 主动停止 Loaded", runner.State == ShowState.Loaded);
            var dc = ctx.Dispatcher.Dispatched.Count;
            var me = ctx.MSink.Emits.Count;
            var fe = ctx.FSink.Emits.Count;
            for (var i = 0; i < 12; i++) { t += 1000; runner.Tick(); }
            runner.RequestStop("重复");
            check("[ar-stop] 停后零后续（含待发动作）", ctx.Dispatcher.Dispatched.Count == dc && ctx.MSink.Emits.Count == me && ctx.FSink.Emits.Count == fe);
            check("[ar-stop] 释放各恰一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
        }
        // S2 守卫故障停先于输出。
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
            var fe = ctx.FSink.Emits.Count;
            t += 500; runner.Tick();
            check("[ar-stop] 守卫故障 Faulted 中文零后续", runner.State == ShowState.Faulted && HasChinese(runner.StopReason)
                && ctx.Dispatcher.Dispatched.Count == dc && ctx.FSink.Emits.Count == fe, runner.StopReason);
        }
        // S3 朝向槽异常与重入：带事件中文，零泄漏。
        {
            long t = 0;
            var ctx = Build();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[ar-stop] 前置边界角正零", ctx.FSink.Emits.Count >= 1 && IsPosZero(ctx.FSink.Emits[^1].AngleDeg), DumpFace(ctx.FSink));
            ctx.FSink.ThrowOnEmit = true;
            t = 200; runner.Tick();
            check("[ar-stop] 朝向槽异常 Faulted 含事件中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("ar-e-f") && HasChinese(runner.StopReason), runner.StopReason);
            check("[ar-stop] 朝向释放恰一次", ctx.FSink.Releases.Count == 1);
        }
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
            check("[ar-stop] 朝向槽重入 Loaded", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            check("[ar-stop] 朝向槽重入释放各恰一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
            var dc = ctx.Dispatcher.Dispatched.Count;
            var fe = ctx.FSink.Emits.Count;
            for (var i = 0; i < 6; i++) { t += 1000; runner.Tick(); }
            runner.RequestStop("重复");
            check("[ar-stop] 朝向槽重入后零泄漏", ctx.Dispatcher.Dispatched.Count == dc && ctx.FSink.Emits.Count == fe);
        }
        // S4 释放异常仍各恰尝试一次，不重复。
        {
            long t = 0;
            var ctx = Build();
            ctx.FSink.ThrowOnRelease = true;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 600; runner.Tick();
            runner.RequestStop("停止");
            check("[ar-stop] 释放异常仍 Loaded/Faulted", runner.State is ShowState.Loaded or ShowState.Faulted, runner.State.ToString());
            check("[ar-stop] 释放异常双释放各尝试一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
            var mr = ctx.MSink.Releases.Count;
            var fr = ctx.FSink.Releases.Count;
            runner.RequestStop("重复");
            t += 200; runner.Tick();
            check("[ar-stop] 释放异常不重复释放", ctx.MSink.Releases.Count == mr && ctx.FSink.Releases.Count == fr);
        }
        // S5 显式 Arm+Start 唯一重演，无 stale 残留且序列一致。
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.AddFacing(new X1FacingInput { EventId = "ar-r", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = -2.2918311805232927e-14 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "ar-r", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[ar-stop] 首轮边界角正零", fs.Emits.Count == 1 && IsPosZero(fs.Emits[0].AngleDeg), DumpFace(fs));
            runner.RequestStop("停");
            var dc = disp.Dispatched.Count;
            var fe = fs.Emits.Count;
            for (var i = 0; i < 3; i++) { t += 1000; runner.Tick(); }
            check("[ar-stop] 恢复+时钟前进不自动复演", runner.State == ShowState.Loaded && disp.Dispatched.Count == dc && fs.Emits.Count == fe);
            check("[ar-stop] 显式 Arm 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
            t = 0; runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[ar-stop] 重演首击仍正零无残留", fs.Emits.Count == fe + 1 && IsPosZero(fs.Emits[^1].AngleDeg), DumpFace(fs));
            check("[ar-stop] 重演期间 Playing", runner.State == ShowState.Playing, runner.State + " " + runner.StopReason);
        }
        // S6 非法输入与非有限观测拒绝面不变。
        {
            var badAngle = new X1FacingInput { EventId = "ar-bad", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = double.NaN };
            var (bok, berr, bexec) = X1FacingExecutor.TryCreate(badAngle, 0, 1000);
            check("[ar-stop] 非法角度拒绝中文零构造", !bok && bexec == null && HasChinese(berr), berr);
            var badMove = new X1MovementInput { EventId = "ar-badm", PerformerId = "p1", ArrivalToleranceM = 0.25, MaxCorrectionM = 1.5 };
            var (mok, merr, mexec) = X1MovementExecutor.TryCreate(badMove, 0);
            check("[ar-stop] 空路点拒绝中文零构造", !mok && mexec == null && HasChinese(merr), merr);
            var sc = new X1FacingInput { EventId = "ar-sc-nan", PerformerId = "p1", FacingMode = X1FacingMode.StageCenter, StageCenterX = 0, StageCenterZ = 1 };
            var (sok, _, sexec) = X1FacingExecutor.TryCreate(sc, 100, 1100);
            var ssink = new RecFacingSink();
            var (uok, uerr) = sexec!.Update(150, null, ssink, double.NaN, 0);
            check("[ar-stop] 非有限观测拒绝中文零输出", sok && !uok && HasChinese(uerr) && ssink.Emits.Count == 0, uerr);
            check("[ar-stop] 生产仍拒绝 movement/facing/ability",
                !ShowValidator.Validate(Pkg(Se("e1", "movement"))).Ok
                && !ShowValidator.Validate(Pkg(Se("e1", "facing"))).Ok
                && !ShowValidator.Validate(Pkg(Se("e1", "ability"))).Ok);
            var capMove = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
            capMove.Events.Add(Se("e1", "cue"));
            capMove.Capabilities.Add(new ShowCapability { Name = "movement-control" });
            var capAb = new ShowPackage { ProtocolVersion = 1, DurationMs = 10000 };
            capAb.Events.Add(Se("e1", "cue"));
            capAb.Capabilities.Add(new ShowCapability { Name = "ability-execution" });
            check("[ar-stop] 生产仍拒绝两能力名",
                !ShowValidator.Validate(capMove).Ok && !ShowValidator.Validate(capAb).Ok);
        }
    }

    private static ShowEvent Se(string id, string kind) => new() { Id = id, Kind = kind, StartMs = 0, DurationMs = 500, Command = kind == "motion" ? "/bow motion" : "", PerformerId = "p1" };
    private static ShowPackage Pkg(params ShowEvent[] evs) { var p = new ShowPackage { ProtocolVersion = 1, DurationMs = 100000 }; p.Events.AddRange(evs); return p; }

    private static string DumpFace(RecFacingSink s) => string.Join(";", s.Emits.Select(e => $"{e.EventId}:{e.AngleDeg:R}@{e.ShowTimeMs}"));

    private sealed class BuiltStopRange
    {
        public ShowPackage Package = new();
        public X1ShowDispatcher Dispatcher = new("p1");
        public RecFacingSink FSink = new();
        public RecMovementSink MSink = new();
    }

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
