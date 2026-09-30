// 这个文件是干嘛的：X1 他演员朝向命名回归（x1-other-actor）：显式目标准入、逐跳方位、优先级与观测双读、失败停与停止生命周期。
using ChoreoHelper;

internal static class X1OtherActorCases
{
    private const string Sentinel = "X1_OTHER_ACTOR_ASSERTION";

    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 他演员朝向（{caseName}{(red ? " --red" : "")}） ==");
        RunOtherActorCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            Console.WriteLine(Sentinel);
            return 1;
        }
        return 0;
    }

    public static void RunOtherActorCase(CheckFn check)
    {
        RunAdmission(check);
        RunBearing(check);
        RunPrecedence(check);
        RunFailure(check);
        RunStopLifecycle(check);
    }

    // ---- AC-1 显式目标准入 ----
    private static void RunAdmission(CheckFn check)
    {
        var good = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 90 };
        check("[oa-inputs] 显式非空目标放行", X1InputValidation.ValidateFacing(good).Ok);
        check("[oa-inputs] 目标为观测键不触发单演员捆绑（p2 目标合法）", X1InputValidation.ValidateBundle("p1", null, null, new[] { good }).Ok);
        var (gok, _, gexec) = X1FacingExecutor.TryCreate(good, 1000, 2000);
        check("[oa-inputs] 执行器构造通过", gok && gexec != null);
        check("[oa-inputs] 执行器目标快照一致", gexec != null && gexec.OtherActorTargetId == "p2");
        var dispOk = new X1ShowDispatcher("p1");
        check("[oa-inputs] 分发器收他演员朝向", dispOk.AddFacing(good).Ok);
        // 自目标允许（退化按 AC-2 保持）
        var self = new X1FacingInput { EventId = "f-self", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p1", FixedAngleDeg = 0 };
        check("[oa-inputs] 自目标允许（退化保持）", X1InputValidation.ValidateFacing(self).Ok);
        check("[oa-inputs] 自目标捆绑放行", X1InputValidation.ValidateBundle("p1", null, null, new[] { self }).Ok);
        // 附带过渡/中心字段忽略（存量先例：他模式忽略外来字段）
        var withForeign = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 10, TransitionFromDeg = 999, TransitionToDeg = 999, StageCenterX = 999, StageCenterZ = 999 };
        check("[oa-inputs] 附带过渡/中心字段仍放行（忽略）", X1InputValidation.ValidateFacing(withForeign).Ok);
        {
            var s1 = new RecFacingSink();
            var s2 = new RecFacingSink();
            var (eok, _, eexec) = X1FacingExecutor.TryCreate(good, 1000, 2000);
            var (fok, _, fexec) = X1FacingExecutor.TryCreate(withForeign, 1000, 2000);
            if (eexec != null && fexec != null)
            {
                eexec.Update(1500, 999, s1, 0, 0, 1, 0);
                fexec.Update(1500, 999, s2, 0, 0, 1, 0);
            }
            check("[oa-inputs] 外来字段不影响方位输出", eok && fok && s1.Emits.Count == 1 && s2.Emits.Count == 1 && Math.Abs(s1.Emits[0].AngleDeg - s2.Emits[0].AngleDeg) < 1e-9, DumpFace(s1) + " vs " + DumpFace(s2));
        }
        // 目标快照：构造后改输入不可重定向
        {
            var mutable = new X1FacingInput { EventId = "f-snap", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
            var (sok, _, sexec) = X1FacingExecutor.TryCreate(mutable, 100, 1100);
            check("[oa-inputs] 目标快照构造成功", sok && sexec != null && sexec!.OtherActorTargetId == "p2");
            mutable.OtherActorTargetId = "p9";
            check("[oa-inputs] 改输入后快照不变", sexec != null && sexec.OtherActorTargetId == "p2");
        }
        // 无效矩阵：缺/空/空白目标、非 StopShow、混演员驱动、未知枚举、角度非有限
        var missing = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, FixedAngleDeg = 90 };
        var empty = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "", FixedAngleDeg = 90 };
        var blank = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "   ", FixedAngleDeg = 90 };
        var skip = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 90, FailurePolicy = X1FailurePolicy.Skip };
        var wait = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 90, FailurePolicy = X1FailurePolicy.Wait };
        var undef = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = (X1FacingMode)999, OtherActorTargetId = "p2", FixedAngleDeg = 90 };
        var nanAngle = new X1FacingInput { EventId = "f-oa", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = double.NaN };
        foreach (var (name, inp) in new[] { ("缺目标", missing), ("空目标", empty), ("空白目标", blank), ("skip策略", skip), ("wait策略", wait), ("未知枚举", undef), ("角度NaN", nanAngle) })
        {
            var sink = new RecFacingSink();
            var (ok, err) = X1InputValidation.ValidateFacing(inp);
            check("[oa-inputs] " + name + "拒绝且中文", !ok && HasChinese(err), err);
            var (bok, berr, bexec) = X1FacingExecutor.TryCreate(inp, 1000, 2000);
            check("[oa-inputs] " + name + "不构造执行器零槽", !bok && bexec == null && HasChinese(berr) && sink.Emits.Count == 0 && sink.Releases.Count == 0, berr);
        }
        // 混入第二演员驱动拒绝
        var mixed = new X1FacingInput { EventId = "f-oa", PerformerId = "p2", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p3", FixedAngleDeg = 90 };
        check("[oa-inputs] 混入第二演员驱动拒绝且中文", FailChinese(X1InputValidation.ValidateBundle("p1", null, null, new[] { good, mixed })));
        {
            var d = new X1ShowDispatcher("p1");
            check("[oa-inputs] 分发器拒混演员驱动", !d.AddFacing(mixed).Ok);
            check("[oa-inputs] 分发器拒缺目标", !d.AddFacing(missing).Ok);
            check("[oa-inputs] 分发器拒空目标", !d.AddFacing(empty).Ok);
        }
        // 旧模式无需目标
        check("[oa-inputs] 固定角无需目标", X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f-fx", PerformerId = "p1", FixedAngleDeg = 90 }).Ok);
        check("[oa-inputs] 沿路径无需目标", X1InputValidation.ValidateFacing(new X1FacingInput { EventId = "f-ap", PerformerId = "p1", FacingMode = X1FacingMode.AlongPath }).Ok);
    }

    // ---- AC-2 逐跳方位（执行器直测，[100,1100)）----
    private static void RunBearing(CheckFn check)
    {
        var input = new X1FacingInput { EventId = "g1", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
        var (ok, _, ex) = X1FacingExecutor.TryCreate(input, 100, 1100);
        check("[oa-geom] 构造通过", ok && ex != null);
        if (ex == null) return;
        var sink = new RecFacingSink();
        var (before, _) = ex.Update(99, null, sink, 0, 0, 0, 1);
        check("[oa-geom] 开始前零输出", before && sink.Emits.Count == 0);
        // 四象限 + 对角：O(0,0) 固定，T 变化
        (double tx, double tz, double expect)[] sweep =
        {
            (0, 1, 0), (1, 0, 90), (0, -1, 180), (-1, 0, 270), (1, 1, 45),
        };
        var t = 100;
        foreach (var (tx, tz, expect) in sweep)
        {
            sink.Emits.Clear();
            var (uok, uerr) = ex.Update(t, 999, sink, 0, 0, tx, tz);
            check($"[oa-geom] 目标({tx},{tz})→{expect}°（切向忽略）", uok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - expect) < 1e-9 && sink.Emits[0].ShowTimeMs == t,
                uerr + " " + DumpFace(sink));
            t += 100;
        }
        // 移动目标逐跳重瞄：同执行器连续两跳不同目标
        sink.Emits.Clear();
        var (m1ok, _) = ex.Update(t, null, sink, 0, 0, 1, 0);
        var (m2ok, _) = ex.Update(t + 100, null, sink, 0, 0, 0, 1);
        check("[oa-geom] 移动目标逐跳重瞄 90°→0°", m1ok && m2ok && sink.Emits.Count == 2
            && Math.Abs(sink.Emits[0].AngleDeg - 90) < 1e-9 && Math.Abs(sink.Emits[1].AngleDeg - 0) < 1e-9, DumpFace(sink));
        // 舞台中心等几何奇偶：同 dx/dz 方位一致
        sink.Emits.Clear();
        var (pok, _) = ex.Update(t + 200, null, sink, 9, 20, 10, 20);
        var oracle = X1MovementExecutor.NormalizeDeg(Math.Atan2(10 - 9, 20 - 20) * 180.0 / Math.PI);
        check("[oa-geom] 与舞台中心同几何奇偶 90°", pok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - oracle) < 1e-9 && Math.Abs(oracle - 90) < 1e-9, DumpFace(sink) + " oracle=" + oracle);
        // 退化：重合保持上次 90°
        sink.Emits.Clear();
        var (c1ok, _) = ex.Update(t + 300, null, sink, 5, 5, 5, 5);
        var (c2ok, _) = ex.Update(t + 400, null, sink, 5, 5, 5, 5);
        check("[oa-geom] 重合保持上次 90°", c1ok && c2ok && sink.Emits.Count == 2
            && Math.Abs(sink.Emits[0].AngleDeg - 90) < 1e-9 && Math.Abs(sink.Emits[1].AngleDeg - 90) < 1e-9, DumpFace(sink));
        // 1e-12 口径：双分量均低于阈值视为重合（窗口内 1050，避免半开展平端点）
        sink.Emits.Clear();
        var (n1ok, _) = ex.Update(t + 450, null, sink, 0, 0, 5e-13, 5e-13);
        check("[oa-geom] 1e-12 内重合保持（非 0/NaN）", n1ok && sink.Emits.Count == 1 && Math.Abs(sink.Emits[0].AngleDeg - 90) < 1e-9, DumpFace(sink));
        // 全新重合起步：首输出前零输出
        var fresh = new X1FacingInput { EventId = "g2", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
        var (fok, _, fex) = X1FacingExecutor.TryCreate(fresh, 100, 1100);
        var fsink = new RecFacingSink();
        var (f1ok, _) = fex!.Update(100, null, fsink, 7, 7, 7, 7);
        var (f2ok, _) = fex.Update(200, null, fsink, 7, 7, 7, 7);
        check("[oa-geom] 新执行器重合起步零输出", f1ok && f2ok && fsink.Emits.Count == 0, DumpFace(fsink));
        var (f3ok, _) = fex.Update(300, null, fsink, 7, 7, 8, 7);
        var (f4ok, _) = fex.Update(400, null, fsink, 7, 7, 7, 7);
        check("[oa-geom] 移出后首输出 90° 随后保持", f3ok && f4ok && fsink.Emits.Count == 2
            && Math.Abs(fsink.Emits[0].AngleDeg - 90) < 1e-9 && Math.Abs(fsink.Emits[1].AngleDeg - 90) < 1e-9, DumpFace(fsink));
        check("[oa-geom] 全部输出有限归一 [0,360)", fsink.Emits.All(e => X1InputValidation.IsFiniteDouble(e.AngleDeg) && e.AngleDeg >= 0 && e.AngleDeg < 360) && sink.Emits.All(e => X1InputValidation.IsFiniteDouble(e.AngleDeg) && e.AngleDeg >= 0 && e.AngleDeg < 360));
        // 半开窗口：结束时刻及之后零输出
        sink.Emits.Clear();
        ex.Update(t + 600, null, sink, 0, 0, 1, 0);
        var ends = sink.Emits.Count;
        var (e1ok, _) = ex.Update(1100, null, sink, 0, 0, 1, 0);
        var (e2ok, _) = ex.Update(1200, null, sink, 0, 0, 1, 0);
        check("[oa-geom] 结束时刻及之后零输出（半开）", e1ok && e2ok && sink.Emits.Count == ends);
        // 零长窗口永不激活
        var zero = new X1FacingInput { EventId = "g0", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
        var (zok, _, zex) = X1FacingExecutor.TryCreate(zero, 1000, 1000);
        var zsink = new RecFacingSink();
        var a1 = true; var a2 = true; var a3 = true;
        if (zex != null)
        {
            (a1, _) = zex.Update(999, null, zsink, 0, 0, 1, 0);
            (a2, _) = zex.Update(1000, null, zsink, 0, 0, 1, 0);
            (a3, _) = zex.Update(1001, null, zsink, 0, 0, 1, 0);
        }
        check("[oa-geom] 零长窗口全零输出", zok && a1 && a2 && a3 && zsink.Emits.Count == 0, DumpFace(zsink));
        // 缺观测/缺目标拒绝且中文零输出
        var msink = new RecFacingSink();
        var (mok, merr) = fex.Update(350, null, msink, null, null, 1, 0);
        check("[oa-geom] 缺自身观测拒绝且中文零输出", !mok && HasChinese(merr) && msink.Emits.Count == 0, merr);
        var tsink = new RecFacingSink();
        var (tok, terr) = fex.Update(350, null, tsink, 0, 0, null, null);
        check("[oa-geom] 缺目标观测拒绝且中文零输出", !tok && HasChinese(terr) && tsink.Emits.Count == 0, terr);
        var nsink = new RecFacingSink();
        var (nok, nerr) = fex.Update(360, null, nsink, double.NaN, 0, 1, 0);
        check("[oa-geom] 自身观测 NaN 拒绝且中文零输出", !nok && HasChinese(nerr) && nsink.Emits.Count == 0, nerr);
        var tisink = new RecFacingSink();
        var (tiok, tierr) = fex.Update(360, null, tisink, 0, 0, double.PositiveInfinity, 0);
        check("[oa-geom] 目标观测 Infinity 拒绝且中文零输出", !tiok && HasChinese(tierr) && tisink.Emits.Count == 0, tierr);
        // 有限坐标相减溢出
        var big = new X1FacingInput { EventId = "g3", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
        var (bok, _, bex) = X1FacingExecutor.TryCreate(big, 100, 1100);
        var bsink = new RecFacingSink();
        var (ovok, overr) = bex!.Update(150, null, bsink, -double.MaxValue, -double.MaxValue, double.MaxValue, double.MaxValue);
        check("[oa-geom] 有限坐标减法溢出拒绝且中文零输出", !ovok && HasChinese(overr) && bsink.Emits.Count == 0, overr);
        // 严格 [0,360) 环绕边界（REG-R2-RANGE，仅他演员分支）：共享 NormalizeDeg 在 0/360 边界
        // 可能舍入为恰好 360——dx=-4e-16,dz=1 的 atan2 度数 ≈ -2.29e-14，360 加它按 double 舍入仍是 360。
        // 该行非退化（|dz|=1 ≥ 1e-12）；修复后必须规范为恰 0。相邻行不得被波及：
        // dx=-5e-16/-8e-16/-1e-15 保持 359.99999999999994；dx=+4e-16 保持微小正值；dx=0 保持 0。
        {
            var wrapInput = new X1FacingInput { EventId = "g-wrap", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 };
            var (wok, _, wex) = X1FacingExecutor.TryCreate(wrapInput, 100, 1100);
            check("[oa-wrap] 构造通过", wok && wex != null);
            if (wex != null)
            {
                var wsink2 = new RecFacingSink();
                (double Dx, double Expect, bool ExactZero)[] rows =
                {
                    (-4e-16, 0.0, true),
                    (-5e-16, 359.99999999999994, false),
                    (-8e-16, 359.99999999999994, false),
                    (-1e-15, 359.99999999999994, false),
                };
                var wtick = 100;
                foreach (var (wdx, wexpect, wexactZero) in rows)
                {
                    wsink2.Emits.Clear();
                    var (rok, rerr) = wex.Update(wtick, null, wsink2, 0, 0, wdx, 1);
                    var emitted = wsink2.Emits.Count == 1 ? wsink2.Emits[0].AngleDeg : double.NaN;
                    var valOk = wexactZero ? emitted == 0.0 : emitted == wexpect;
                    check($"[oa-wrap] dx={wdx},dz=1 → {(wexactZero ? "恰 0" : "359.99999999999994")}",
                        rok && wsink2.Emits.Count == 1 && valOk, rerr + " emitted=" + emitted.ToString("R"));
                    wtick += 100;
                }
                wsink2.Emits.Clear();
                var (pok2, perr2) = wex.Update(wtick, null, wsink2, 0, 0, 4e-16, 1);
                var pRaw = X1MovementExecutor.NormalizeDeg(Math.Atan2(4e-16, 1) * 180.0 / Math.PI);
                check("[oa-wrap] dx=+4e-16 保持微小正值不变（原样输出）",
                    pok2 && wsink2.Emits.Count == 1 && wsink2.Emits[0].AngleDeg == pRaw && pRaw > 0 && pRaw < 1e-9,
                    perr2 + " emitted=" + (wsink2.Emits.Count == 1 ? wsink2.Emits[0].AngleDeg.ToString("R") : "none") + " raw=" + pRaw.ToString("R"));
                wtick += 100;
                wsink2.Emits.Clear();
                var (zok2, zerr2) = wex.Update(wtick, null, wsink2, 0, 0, 0, 1);
                check("[oa-wrap] dx=0 保持 0", zok2 && wsink2.Emits.Count == 1 && wsink2.Emits[0].AngleDeg == 0.0, zerr2);
                check("[oa-wrap] 环绕行全部有限且严格 [0,360)",
                    wsink2.Emits.All(e => X1InputValidation.IsFiniteDouble(e.AngleDeg) && e.AngleDeg >= 0 && e.AngleDeg < 360));
            }
        }
    }

    // ---- AC-3 优先级与双读 ----
    private static void RunPrecedence(CheckFn check)
    {
        // P1 纯他演员（无移动）：每更新自身+目标各恰读一次，过期后零读取零输出
        {
            long t = 0;
            var ownReads = 0; var targetReads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            Func<long, (double X, double Z)> ownScript = tt => tt == 100 ? (0, 0) : tt == 200 ? (0, 0) : (5, 5);
            Func<string, (double X, double Z)> targetScript = id => t == 100 ? (1, 0) : t == 200 ? (0, 1) : (5, 5);
            disp.ObservedProvider = () => { ownReads++; return ownScript(t); };
            disp.OtherActorPositionProvider = id => { targetReads++; return targetScript(id); };
            disp.AddFacing(new X1FacingInput { EventId = "f-only", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-only", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-prec] 纯他演员首击 90° 且双读各一次", ownReads == 1 && targetReads == 1 && fs.Emits.Count == 1 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-9 && fs.Emits[0].EventId == "f-only", "own=" + ownReads + " tgt=" + targetReads + " " + DumpFace(fs));
            t = 200; runner.Tick();
            check("[oa-prec] 移动目标第二击 0° 且双读各再一次", ownReads == 2 && targetReads == 2 && fs.Emits.Count == 2 && Math.Abs(fs.Emits[1].AngleDeg - 0) < 1e-9, DumpFace(fs));
            for (var tt = 300; tt <= 1000; tt += 100) { t = tt; runner.Tick(); }
            check("[oa-prec] 激活期重合保持（非 0/NaN）", fs.Emits.Skip(2).All(e => X1InputValidation.IsFiniteDouble(e.AngleDeg)));
            var readsOwnAt1000 = ownReads; var readsTgtAt1000 = targetReads; var emitsAt1000 = fs.Emits.Count;
            t = 1100; runner.Tick();
            check("[oa-prec] 过期后零读取零输出", ownReads == readsOwnAt1000 && targetReads == readsTgtAt1000 && fs.Emits.Count == emitsAt1000, "own=" + ownReads + " tgt=" + targetReads);
            for (var i = 0; i < 12 && runner.State != ShowState.Completed; i++) { t += 200; runner.Tick(); }
            check("[oa-prec] 纯他演员至 Completed 且释放恰一次", runner.State == ShowState.Completed && fs.Releases.Count == 1 && fs.Releases[0] == "f-only",
                runner.State + " " + string.Join(",", fs.Releases));
        }
        // P2 移动 + 他演员：独立优先、同快照、每更新至多一条、双读各恰一次
        {
            long t = 0;
            var ownReads = 0; var targetReads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => { ownReads++; return (0.2, 0.1); };
            disp.OtherActorPositionProvider = id => { targetReads++; return (10, 20); };
            var mi = new X1MovementInput { EventId = "m-p3", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 2, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-p3", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 4000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p3", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-p3", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-prec] 重叠前移动切向 45°", fs.Emits.Count == 1 && fs.Emits[0].EventId == "m-p3" && Math.Abs(fs.Emits[0].AngleDeg - 45) < 1e-9, DumpFace(fs));
            var oracle = X1MovementExecutor.NormalizeDeg(Math.Atan2(10 - 0.2, 20 - 0.1) * 180.0 / Math.PI);
            var ownBefore = ownReads; var tgtBefore = targetReads; var moveBefore = ms.Emits.Count;
            t = 300; runner.Tick();
            check("[oa-prec] 重叠期他演员获胜（观测方位，非切向）",
                fs.Emits.Count == 2 && fs.Emits[1].EventId == "f-p3" && Math.Abs(fs.Emits[1].AngleDeg - oracle) < 1e-9, DumpFace(fs) + " oracle=" + oracle);
            check("[oa-prec] 本更新自身恰读一次、目标恰读一次", ownReads - ownBefore == 1 && targetReads - tgtBefore == 1, "down=" + (ownReads - ownBefore) + " dtgt=" + (targetReads - tgtBefore));
            check("[oa-prec] 同快照供移动修正", ms.Emits.Count == moveBefore + 1, DumpMove(ms));
            var perTickOk = true;
            for (var step = 400; step <= 1900; step += 100)
            {
                var bef = fs.Emits.Count;
                t = step; runner.Tick();
                if (fs.Emits.Count - bef > 1) perTickOk = false;
            }
            check("[oa-prec] 每更新至多一条朝向意图", perTickOk);
        }
        // P3 不同起点互压：晚起点获胜
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => (1, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-fix4", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 270 });
            disp.AddFacing(new X1FacingInput { EventId = "f-oa4", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-fix4", Kind = "facing", StartMs = 100, DurationMs = 900, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-oa4", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[oa-prec] 仅固定角激活出 270°", LastIs(fs, "f-fix4", 270), DumpFace(fs));
            t = 500; runner.Tick();
            check("[oa-prec] 晚起点他演员压过固定角（90°）", LastIs(fs, "f-oa4", 90), DumpFace(fs));
            t = 900; runner.Tick();
            check("[oa-prec] 他演员过期后回固定角 270° 无残留", LastIs(fs, "f-fix4", 270), DumpFace(fs));
        }
        // P4 被压制他演员自身不触发双读
        {
            long t = 0;
            var ownReads = 0; var targetReads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => { ownReads++; return (0, 0); };
            disp.OtherActorPositionProvider = id => { targetReads++; return (1, 0); };
            disp.AddFacing(new X1FacingInput { EventId = "f-oa5", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            disp.AddFacing(new X1FacingInput { EventId = "f-fix5", PerformerId = "p1", FacingMode = X1FacingMode.FixedAngle, FixedAngleDeg = 270 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-oa5", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-fix5", Kind = "facing", StartMs = 400, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var r0o = ownReads; var r0t = targetReads;
            t = 300; runner.Tick();
            check("[oa-prec] 他演员激活期 90° 且双读各一次", fs.Emits.Count == 1 && fs.Emits[^1].EventId == "f-oa5" && Math.Abs(fs.Emits[^1].AngleDeg - 90) < 1e-9 && ownReads - r0o == 1 && targetReads - r0t == 1, DumpFace(fs));
            var r1o = ownReads; var r1t = targetReads;
            t = 500; runner.Tick();
            check("[oa-prec] 被压制他演员不触发双读（固定角 270°）",
                LastIs(fs, "f-fix5", 270) && ownReads == r1o && targetReads == r1t, DumpFace(fs) + $" down={ownReads - r1o} dtgt={targetReads - r1t}");
        }
        // P5 平手起点按事件序取小
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => id == "pB" ? (1, 0) : (0, 1);
            disp.AddFacing(new X1FacingInput { EventId = "f-b", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "pB", FixedAngleDeg = 0 });
            disp.AddFacing(new X1FacingInput { EventId = "f-a", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "pA", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-b", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-a", Kind = "facing", StartMs = 300, DurationMs = 600, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 400; runner.Tick();
            check("[oa-prec] 平手起点按事件序取小（f-a 的 0°，非 f-b 的 90°）",
                fs.Emits.Count == 1 && fs.Emits[0].EventId == "f-a" && Math.Abs(fs.Emits[0].AngleDeg - 0) < 1e-9, DumpFace(fs));
        }
        // P6 他演员结束后回移动切向，无残留
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => (1, 0);
            var mi = new X1MovementInput { EventId = "m-p5", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 3000, X = 0, Z = 3 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-p5", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 5000 };
            pkg.Events.Add(new ShowEvent { Id = "m-p5", Kind = "movement", StartMs = 0, DurationMs = 3000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-p5", Kind = "facing", StartMs = 200, DurationMs = 400, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 300; runner.Tick();
            check("[oa-prec] 结束前他演员 90°", LastIs(fs, "f-p5", 90), DumpFace(fs));
            t = 700; runner.Tick();
            check("[oa-prec] 结束后回移动切向 0° 无残留", LastIs(fs, "m-p5", 0), DumpFace(fs));
            check("[oa-prec] 结束后无他演员输出", fs.Emits.Count(e => e.EventId == "f-p5") == 1);
        }
    }

    // ---- AC-3/AC-4 失败停 ----
    private static void RunFailure(CheckFn check)
    {
        // F1 目标供给缺失
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = null;
            disp.AddFacing(new X1FacingInput { EventId = "f-f1", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f1", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-fail] 目标供给缺失 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f1") && HasChinese(runner.StopReason), runner.StopReason);
            check("[oa-fail] 目标供给缺失零朝向输出", fs.Emits.Count == 0 && fs.Releases.Count == 1, DumpFace(fs));
        }
        // F2 自身供给缺失（他演员获胜仍带事件前缀）
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = null;
            disp.OtherActorPositionProvider = id => (1, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-f2", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f2", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-fail] 自身供给缺失 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f2") && HasChinese(runner.StopReason), runner.StopReason);
            check("[oa-fail] 自身供给缺失零输出", fs.Emits.Count == 0);
        }
        // F3 目标供给抛异常
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => throw new InvalidOperationException("目标供给炸了");
            disp.AddFacing(new X1FacingInput { EventId = "f-f3", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f3", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-fail] 目标供给异常 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f3") && HasChinese(runner.StopReason), runner.StopReason);
            check("[oa-fail] 目标供给异常零输出", fs.Emits.Count == 0);
        }
        // F4 目标非有限
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => t <= 0 ? (0, 0) : (0, 0);
            disp.OtherActorPositionProvider = id => (double.NaN, 0);
            var mi = new X1MovementInput { EventId = "m-f4", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f4", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f4", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f4", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var moveAt0 = ms.Emits.Count;
            t = 100; runner.Tick();
            check("[oa-fail] 目标非有限 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f4") && HasChinese(runner.StopReason), runner.StopReason);
            check("[oa-fail] 目标无效时本更新零移动修正零朝向", ms.Emits.Count == moveAt0 && fs.Emits.Count == 0);
        }
        // F5 未知目标 id（供给不认识该 id 抛异常）
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => throw new KeyNotFoundException("未知目标「" + id + "」");
            disp.AddFacing(new X1FacingInput { EventId = "f-f5", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p-ghost", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f5", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-fail] 未知目标 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f5") && HasChinese(runner.StopReason), runner.StopReason);
            check("[oa-fail] 未知目标零输出", fs.Emits.Count == 0);
        }
        // F6 过期他演员不触发目标读取（供给会炸但不应被调用）
        {
            long t = 0;
            var targetReads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => { targetReads++; throw new InvalidOperationException("不应读取"); };
            disp.AddFacing(new X1FacingInput { EventId = "f-exp", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "f-exp", Kind = "facing", StartMs = 100, DurationMs = 200, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            // 首击会读一次并失败？为测过期零读，首击用可用的供给重建
            // 此处首击已失败，重置为可用并验证过期后零读：重建纯过期场景
            long t2 = 0;
            var reads2 = 0;
            var disp2 = new X1ShowDispatcher("p1");
            var fs2 = new RecFacingSink();
            disp2.FacingSink = fs2; disp2.MovementSink = new RecMovementSink();
            disp2.ObservedProvider = () => (0, 0);
            disp2.OtherActorPositionProvider = id => { reads2++; return (1, 0); };
            disp2.AddFacing(new X1FacingInput { EventId = "f-exp2", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg2 = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg2.Events.Add(new ShowEvent { Id = "f-exp2", Kind = "facing", StartMs = 100, DurationMs = 200, PerformerId = "p1" });
            var runner2 = new ShowRunner(disp2, () => t2);
            runner2.SetGuardProvider(() => new GuardSnapshot());
            runner2.Load(pkg2); runner2.Arm(); runner2.Start(0); runner2.Tick();
            t2 = 100; runner2.Tick();
            var rAtActive = reads2;
            t2 = 500; runner2.Tick();
            check("[oa-fail] 过期他演员零目标读取零输出", reads2 == rAtActive && fs2.Emits.Count == 1, $"reads={reads2}/{rAtActive} emits={fs2.Emits.Count}");
        }
        // F7 自身观测回调重入停止：本更新剩余输出全部抑制
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
                return (0, 0);
            };
            disp.OtherActorPositionProvider = id => (1, 0);
            var mi = new X1MovementInput { EventId = "m-f7", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 1, Z = 1 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-f7", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "m-f7", Kind = "movement", StartMs = 0, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-f7", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            holder = runner;
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            var moveAt0 = ms.Emits.Count;
            t = 100; runner.Tick();
            check("[oa-fail] 自身观测重入停止 Loaded", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            check("[oa-fail] 观测重入后本更新零移动修正零朝向", ms.Emits.Count == moveAt0 && fs.Emits.Count == 0, DumpMove(ms) + " " + DumpFace(fs));
            check("[oa-fail] 观测重入后释放各恰一次", ms.Releases.Count == 1 && fs.Releases.Count == 1, "m=" + ms.Releases.Count + " f=" + fs.Releases.Count);
        }
        // F8 朝向槽异常：失败闭合带事件与中文
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => (1, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-f8", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f8", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            check("[oa-fail] 前置已出 90°", fs.Emits.Count == 1 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-9, DumpFace(fs));
            fs.ThrowOnEmit = true;
            t = 200; runner.Tick();
            check("[oa-fail] 朝向槽异常 Faulted 且含事件与中文", runner.State == ShowState.Faulted && runner.StopReason.Contains("f-f8") && HasChinese(runner.StopReason), runner.StopReason);
            check("[oa-fail] 朝向释放恰一次", fs.Releases.Count == 1);
        }
        // F9 守卫先于输出（零双读零朝向）
        {
            long t = 0;
            var ownReads = 0; var targetReads = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => { ownReads++; return (0, 0); };
            disp.OtherActorPositionProvider = id => { targetReads++; return (1, 0); };
            disp.AddFacing(new X1FacingInput { EventId = "f-f9", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 2000 };
            pkg.Events.Add(new ShowEvent { Id = "f-f9", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            var guard = new GuardSnapshot();
            runner.SetGuardProvider(() => guard);
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            guard.CharacterPresent = false;
            var r0o = ownReads; var r0t = targetReads;
            t = 100; runner.Tick();
            check("[oa-fail] 守卫失败 Faulted 先于任何输出（零双读零朝向）",
                runner.State == ShowState.Faulted && ownReads == r0o && targetReads == r0t && fs.Emits.Count == 0, runner.StopReason);
        }
    }

    // ---- AC-4 停止生命周期 ----
    private static void RunStopLifecycle(CheckFn check)
    {
        BuiltStopOther Build()
        {
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            var ms = new RecMovementSink();
            disp.FacingSink = fs; disp.MovementSink = ms;
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => (1, 0);
            var mi = new X1MovementInput { EventId = "m-e", PerformerId = "p1", ArrivalToleranceM = 5, MaxCorrectionM = 1.5 };
            mi.Points.Add(new X1Waypoint { TMs = 0, X = 0, Z = 0 });
            mi.Points.Add(new X1Waypoint { TMs = 2000, X = 0, Z = 2 });
            disp.AddMovement(mi);
            disp.AddFacing(new X1FacingInput { EventId = "f-e", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 9000 };
            pkg.Events.Add(new ShowEvent { Id = "m-e", Kind = "movement", StartMs = 100, DurationMs = 2000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "f-e", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            pkg.Events.Add(new ShowEvent { Id = "e-post", Kind = "motion", StartMs = 5000, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
            return new BuiltStopOther { Package = pkg, Dispatcher = disp, FSink = fs, MSink = ms };
        }
        // S1 主动停止
        {
            long t = 0;
            var ctx = Build();
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            t = 600; runner.Tick();
            check("[oa-stop] 前置 Playing 且已出他演员 90°", runner.State == ShowState.Playing
                && ctx.FSink.Emits.Any(e => e.EventId == "f-e" && Math.Abs(e.AngleDeg - 90) < 1e-9), runner.State + " " + DumpFace(ctx.FSink));
            runner.RequestStop("网页紧急停止");
            check("[oa-stop] 主动停止 Loaded", runner.State == ShowState.Loaded);
            var dc = ctx.Dispatcher.Dispatched.Count;
            var me = ctx.MSink.Emits.Count;
            var fe = ctx.FSink.Emits.Count;
            for (var i = 0; i < 12; i++) { t += 1000; runner.Tick(); }
            runner.RequestStop("重复");
            check("[oa-stop] 停后零后续（含待发动作）", ctx.Dispatcher.Dispatched.Count == dc && ctx.MSink.Emits.Count == me && ctx.FSink.Emits.Count == fe);
            check("[oa-stop] 释放各恰一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
        }
        // S2 朝向槽回调重入停止
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
            check("[oa-stop] 朝向槽重入 Loaded", runner.State == ShowState.Loaded, runner.State + " " + runner.StopReason);
            check("[oa-stop] 朝向槽重入释放各恰一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
            var dc = ctx.Dispatcher.Dispatched.Count;
            var me = ctx.MSink.Emits.Count;
            var fe = ctx.FSink.Emits.Count;
            for (var i = 0; i < 6; i++) { t += 1000; runner.Tick(); }
            runner.RequestStop("重复");
            check("[oa-stop] 朝向槽重入后零泄漏", ctx.Dispatcher.Dispatched.Count == dc && ctx.MSink.Emits.Count == me && ctx.FSink.Emits.Count == fe);
        }
        // S3 释放抛异常仍各恰尝试一次
        {
            long t = 0;
            var ctx = Build();
            ctx.FSink.ThrowOnRelease = true;
            var runner = new ShowRunner(ctx.Dispatcher, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(ctx.Package); runner.Arm(); runner.Start(0); runner.Tick();
            t = 600; runner.Tick();
            runner.RequestStop("停止");
            check("[oa-stop] 释放异常仍 Loaded/Faulted", runner.State is ShowState.Loaded or ShowState.Faulted, runner.State.ToString());
            check("[oa-stop] 释放异常双释放各尝试一次", ctx.MSink.Releases.Count == 1 && ctx.FSink.Releases.Count == 1);
            var mr = ctx.MSink.Releases.Count;
            var fr = ctx.FSink.Releases.Count;
            runner.RequestStop("重复");
            t += 200; runner.Tick();
            check("[oa-stop] 释放异常不重复释放", ctx.MSink.Releases.Count == mr && ctx.FSink.Releases.Count == fr);
        }
        // S4 恢复不自动复演；显式 Arm+Start 唯一重演；无上轮角度残留且序列一致
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            var step = 0;
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => step == 0 ? (1, 0) : (0, 1);
            disp.AddFacing(new X1FacingInput { EventId = "f-r", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 3000 };
            pkg.Events.Add(new ShowEvent { Id = "f-r", Kind = "facing", StartMs = 100, DurationMs = 1000, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            t = 100; runner.Tick();
            step = 1;
            t = 200; runner.Tick();
            check("[oa-stop] 首轮 90°/0° 序列", fs.Emits.Count == 2 && Math.Abs(fs.Emits[0].AngleDeg - 90) < 1e-9 && Math.Abs(fs.Emits[1].AngleDeg - 0) < 1e-9, DumpFace(fs));
            var firstSeq = fs.Emits.Select(e => e.AngleDeg).ToList();
            runner.RequestStop("停");
            var dc = disp.Dispatched.Count;
            var fe = fs.Emits.Count;
            for (var i = 0; i < 3; i++) { t += 1000; runner.Tick(); }
            check("[oa-stop] 恢复+时钟前进不自动复演", runner.State == ShowState.Loaded && disp.Dispatched.Count == dc && fs.Emits.Count == fe);
            check("[oa-stop] 显式 Arm 归零", runner.Arm().Ok && runner.DispatchedCount == 0);
            step = 0; t = 0; runner.Start(0); runner.Tick();
            var feBefore = fs.Emits.Count;
            t = 100; runner.Tick();
            check("[oa-stop] 重演首击无上轮残留（90°）", fs.Emits.Count == feBefore + 1 && Math.Abs(fs.Emits[^1].AngleDeg - 90) < 1e-9, DumpFace(fs));
            step = 1; t = 200; runner.Tick();
            check("[oa-stop] 重演复现相同序列 0°", fs.Emits.Count == feBefore + 2 && Math.Abs(fs.Emits[^1].AngleDeg - 0) < 1e-9, DumpFace(fs));
            var secondSeq = fs.Emits.Skip(feBefore).Select(e => e.AngleDeg).ToList();
            check("[oa-stop] 两轮序列一致", firstSeq.Count == secondSeq.Count && firstSeq.Zip(secondSeq).All(p => Math.Abs(p.First - p.Second) < 1e-9));
        }
        // S5 完成语义
        {
            long t = 0;
            var disp = new X1ShowDispatcher("p1");
            var fs = new RecFacingSink();
            disp.FacingSink = fs; disp.MovementSink = new RecMovementSink();
            disp.ObservedProvider = () => (0, 0);
            disp.OtherActorPositionProvider = id => (1, 0);
            disp.AddFacing(new X1FacingInput { EventId = "f-c", PerformerId = "p1", FacingMode = X1FacingMode.OtherActor, OtherActorTargetId = "p2", FixedAngleDeg = 0 });
            var pkg = new ShowPackage { ProtocolVersion = 1, DurationMs = 1500 };
            pkg.Events.Add(new ShowEvent { Id = "f-c", Kind = "facing", StartMs = 100, DurationMs = 500, PerformerId = "p1" });
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.Load(pkg); runner.Arm(); runner.Start(0); runner.Tick();
            for (var i = 0; i < 16 && runner.State != ShowState.Completed; i++) { t += 200; runner.Tick(); }
            var emitsAtEnd = fs.Emits.Count;
            check("[oa-stop] 完成 Completed 清扫恰一次", runner.State == ShowState.Completed && runner.StopCleanupRuns == 1, runner.State.ToString());
            check("[oa-stop] 完成后释放恰一次零追加输出", fs.Releases.Count == 1 && fs.Releases[0] == "f-c");
            t += 1000; runner.Tick();
            check("[oa-stop] 完成后零追加输出", fs.Emits.Count == emitsAtEnd);
        }
        // S6 生产拒绝面保持（Kinds=6, SupportedExecutors=3）
        {
            ShowEvent Se(string id, string kind) => new() { Id = id, Kind = kind, StartMs = 0, DurationMs = 500, Command = kind == "motion" ? "/bow motion" : "", PerformerId = "p1" };
            ShowPackage Pkg(params ShowEvent[] evs) { var p = new ShowPackage { ProtocolVersion = 1, DurationMs = 100000 }; p.Events.AddRange(evs); return p; }
            check("[oa-stop] 生产仍拒绝 movement", !ShowValidator.Validate(Pkg(Se("e1", "movement"))).Ok);
            check("[oa-stop] 生产仍拒绝 facing", !ShowValidator.Validate(Pkg(Se("e1", "facing"))).Ok);
            check("[oa-stop] 生产仍拒绝 ability", !ShowValidator.Validate(Pkg(Se("e1", "ability"))).Ok);
            check("[oa-stop] 未广告新事件种（协议 6 种）", ShowProtocol.Kinds.Count == 6);
            check("[oa-stop] 未广告新执行器（生产 3 执行器）", ShowValidator.SupportedExecutors.Count == 3);
        }
    }

    // ---- helpers ----
    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);
    private static bool FailChinese((bool Ok, string Error) r) => !r.Ok && HasChinese(r.Error);
    private static bool LastIs(RecFacingSink s, string eventId, double expectDeg)
        => s.Emits.Count > 0 && s.Emits[^1].EventId == eventId && Math.Abs(s.Emits[^1].AngleDeg - expectDeg) < 1e-9;
    private static string DumpFace(RecFacingSink s) => string.Join(";", s.Emits.Select(e => $"{e.EventId}:{e.AngleDeg:F3}@{e.ShowTimeMs}"));
    private static string DumpMove(RecMovementSink s) => string.Join(";", s.Emits.Select(e => $"({e.Dx:F3},{e.Dz:F3})->({e.TargetX:F3},{e.TargetZ:F3})@{e.ShowTimeMs}"));

    private sealed class BuiltStopOther
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
