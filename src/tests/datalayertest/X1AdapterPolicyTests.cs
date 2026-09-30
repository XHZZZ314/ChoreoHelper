// 这个文件是干嘛的：X1 适配器输入策略命名回归（x1-adapter-policy）：方向映射、限幅、
// 非有限 fail-closed、释放/停止中性化恰一次、边界修正（TASK-20260912-X1-ADAPTERS-MOVEMENT-FACING）。
// 纯离线：只测 X1AdapterInputPolicy（Dalamud-free，datalayertest 编译即无依赖证明）；
// 命名模式（-- 用例名 [--red]）与全量模式共用同一批断言，--red 仅抑制 OK 输出。
// 失败打印声明哨兵行恰一次并退出 1（供 record-red 绑定 REG-ADAPTER-POLICY）。
using ChoreoHelper;

internal static class X1AdapterPolicyCases
{
    private const string Sentinel = "X1_ADAPTER_POLICY_ASSERTION";

    public static int RunNamed(string caseName, bool red)
    {
        var fails = 0;
        void CheckNamed(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== X1 适配器输入策略（{caseName}{(red ? " --red" : "")}） ==");
        RunAdapterPolicyCase(CheckNamed);
        Console.WriteLine($"结果：{caseName} {fails} 项失败");
        if (fails > 0)
        {
            Console.WriteLine(Sentinel);
            return 1;
        }
        return 0;
    }

    public static void RunAdapterPolicyCase(CheckFn check)
    {
        RunDirectionMapping(check);
        RunRateCaps(check);
        RunZeroTiny(check);
        RunNonFiniteFailClosed(check);
        RunReleaseNeutralization(check);
        RunBoundary(check);
    }

    private static bool HasChinese(string s) => !string.IsNullOrEmpty(s) && s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF);

    // ---- 方向映射：修正向量→归一化输入（除以修正界），朝向→[0,360) ----
    private static void RunDirectionMapping(CheckFn check)
    {
        var ok = X1AdapterInputPolicy.TryMapCorrection(1, 0, 1.5, out var mx, out var mz);
        check("[policy-map] +X 方向映射 0.667", ok && Math.Abs(mx - 1.0 / 1.5) < 1e-9 && Math.Abs(mz) < 1e-9, $"{mx},{mz}");
        ok = X1AdapterInputPolicy.TryMapCorrection(0, 1, 1.5, out mx, out mz);
        check("[policy-map] +Z 方向映射 0.667", ok && Math.Abs(mx) < 1e-9 && Math.Abs(mz - 1.0 / 1.5) < 1e-9, $"{mx},{mz}");
        ok = X1AdapterInputPolicy.TryMapCorrection(-1, 0, 1.5, out mx, out mz);
        check("[policy-map] -X 方向映射 -0.667", ok && Math.Abs(mx + 1.0 / 1.5) < 1e-9 && Math.Abs(mz) < 1e-9, $"{mx},{mz}");
        ok = X1AdapterInputPolicy.TryMapCorrection(0, -1, 1.5, out mx, out mz);
        check("[policy-map] -Z 方向映射 -0.667", ok && Math.Abs(mx) < 1e-9 && Math.Abs(mz + 1.0 / 1.5) < 1e-9, $"{mx},{mz}");
        ok = X1AdapterInputPolicy.TryMapCorrection(1, 1, 1.5, out mx, out mz);
        check("[policy-map] 对角线 (1,1) 双轴 0.667", ok && Math.Abs(mx - 1.0 / 1.5) < 1e-9 && Math.Abs(mz - 1.0 / 1.5) < 1e-9, $"{mx},{mz}");
        // 朝向：与 X1MovementExecutor.NormalizeDeg 同口径 [0,360)
        check("[policy-map] 朝向 90→90", X1AdapterInputPolicy.TryMapFacing(90, out var a90) && Math.Abs(a90 - 90) < 1e-9, a90.ToString());
        check("[policy-map] 朝向 -90→270", X1AdapterInputPolicy.TryMapFacing(-90, out var a270) && Math.Abs(a270 - 270) < 1e-9, a270.ToString());
        check("[policy-map] 朝向 360→0", X1AdapterInputPolicy.TryMapFacing(360, out var a360) && Math.Abs(a360) < 1e-9, a360.ToString());
        check("[policy-map] 朝向 720→0", X1AdapterInputPolicy.TryMapFacing(720, out var a720) && Math.Abs(a720) < 1e-9, a720.ToString());
        check("[policy-map] 朝向 -180→180", X1AdapterInputPolicy.TryMapFacing(-180, out var a180) && Math.Abs(a180 - 180) < 1e-9, a180.ToString());
        check("[policy-map] 输出钳位 [-1,1]", X1AdapterInputPolicy.Clamp11(2) == 1 && X1AdapterInputPolicy.Clamp11(-2) == -1 && X1AdapterInputPolicy.Clamp11(0.5) == 0.5);
    }

    // ---- 限幅：大误差按修正界截断，输出 magnitude 恰为界 ----
    private static void RunRateCaps(CheckFn check)
    {
        var ok = X1AdapterInputPolicy.TryMapCorrection(4, 0, 1.5, out var mx, out var mz);
        check("[policy-cap] 4m 误差限幅 MoveX=1.0", ok && Math.Abs(mx - 1.0) < 1e-9 && Math.Abs(mz) < 1e-9, $"{mx},{mz}");
        ok = X1AdapterInputPolicy.TryMapCorrection(0, -10, 2, out mx, out mz);
        check("[policy-cap] -Z 大误差限幅 MoveZ=-1.0", ok && Math.Abs(mx) < 1e-9 && Math.Abs(mz + 1.0) < 1e-9, $"{mx},{mz}");
        ok = X1AdapterInputPolicy.TryMapCorrection(3, 4, 1.5, out mx, out mz);
        var mag = Math.Sqrt(mx * mx + mz * mz);
        check("[policy-cap] (3,4) 限幅后模长 1.0 且方向保持", ok && Math.Abs(mag - 1.0) < 1e-9 && mx > 0 && mz > 0, $"{mx},{mz} mag={mag}");
        check("[policy-cap] (3,4) 方向比 3:4", Math.Abs(mx / mz - 0.75) < 1e-9, $"{mx},{mz}");
    }

    // ---- 零/微小修正→中性无输入 ----
    private static void RunZeroTiny(CheckFn check)
    {
        var ok = X1AdapterInputPolicy.TryMapCorrection(0, 0, 1.5, out var mx, out var mz);
        check("[policy-zero] 零修正映射零状态", ok && mx == 0 && mz == 0);
        ok = X1AdapterInputPolicy.TryMapCorrection(1e-13, 0, 1.5, out mx, out mz);
        check("[policy-zero] 死区下微小修正中性", ok && mx == 0 && mz == 0, $"{mx},{mz}");
        var p = new X1AdapterInputPolicy();
        check("[policy-zero] 初态中性", p.Current.IsNeutral);
        check("[policy-zero] 零修正应用后无移动输入", p.ApplyCorrection(0, 0, 1.5) && !p.Current.HasMove && p.Current.IsNeutral);
    }

    // ---- 非有限 fail-closed：返回 false 且零状态变化 ----
    private static void RunNonFiniteFailClosed(CheckFn check)
    {
        var p = new X1AdapterInputPolicy();
        p.ApplyCorrection(1, 0, 1.5);
        p.ApplyFacing(90);
        var before = p.Current;
        check("[policy-nan] 前置：移动+朝向已置", before.HasMove && before.HasTurn);
        check("[policy-nan] NaN dx 拒绝", !p.ApplyCorrection(double.NaN, 0, 1.5));
        check("[policy-nan] NaN dx 零状态变化", p.Current.MoveX == before.MoveX && p.Current.MoveZ == before.MoveZ && p.Current.TargetFacingDeg == before.TargetFacingDeg && p.Current.HasMove == before.HasMove && p.Current.HasTurn == before.HasTurn);
        check("[policy-nan] Infinity dz 拒绝零变化", !p.ApplyCorrection(0, double.PositiveInfinity, 1.5) && p.Current.MoveX == before.MoveX && p.Current.HasMove == before.HasMove);
        check("[policy-nan] NaN 修正界拒绝零变化", !p.ApplyCorrection(1, 0, double.NaN) && p.Current.HasMove == before.HasMove);
        check("[policy-nan] 零修正界拒绝零变化", !p.ApplyCorrection(1, 0, 0) && p.Current.HasMove == before.HasMove);
        check("[policy-nan] 负修正界拒绝零变化", !p.ApplyCorrection(1, 0, -1) && p.Current.HasMove == before.HasMove);
        check("[policy-nan] NaN 朝向拒绝零变化", !p.ApplyFacing(double.NaN) && p.Current.TargetFacingDeg == before.TargetFacingDeg && p.Current.HasTurn == before.HasTurn);
        check("[policy-nan] Infinity 朝向拒绝零变化", !p.ApplyFacing(double.PositiveInfinity) && p.Current.HasTurn == before.HasTurn);
        // 纯函数口径同样 fail-closed
        check("[policy-nan] 纯函数 NaN dx 拒绝且零输出", !X1AdapterInputPolicy.TryMapCorrection(double.NaN, 0, 1.5, out var nx, out var nz) && nx == 0 && nz == 0);
        check("[policy-nan] 纯函数 Infinity 界拒绝", !X1AdapterInputPolicy.TryMapCorrection(1, 0, double.PositiveInfinity, out _, out _));
        check("[policy-nan] 纯函数零界拒绝", !X1AdapterInputPolicy.TryMapCorrection(1, 0, 0, out _, out _));
        check("[policy-nan] 纯函数 NaN 朝向拒绝", !X1AdapterInputPolicy.TryMapFacing(double.NaN, out var na) && na == 0);
    }

    // ---- 释放/停止中性化恰一次 ----
    private static void RunReleaseNeutralization(CheckFn check)
    {
        var p = new X1AdapterInputPolicy();
        p.ApplyCorrection(1, 0, 1.5);
        p.ApplyFacing(90);
        check("[policy-rel] 释放移动恰一次", p.ReleaseMovement() && !p.Current.HasMove && p.Current.HasTurn);
        check("[policy-rel] 重复释放移动抑制", !p.ReleaseMovement() && !p.Current.HasMove);
        check("[policy-rel] 释放朝向恰一次", p.ReleaseFacing() && !p.Current.HasTurn && p.Current.IsNeutral);
        check("[policy-rel] 重复释放朝向抑制", !p.ReleaseFacing() && p.Current.IsNeutral);
        check("[policy-rel] 中性时全清抑制", !p.ClearAll());
        p.ApplyCorrection(0, 1, 1.5);
        p.ApplyFacing(180);
        check("[policy-rel] 全清一次到中性", p.ClearAll() && p.Current.IsNeutral);
        check("[policy-rel] 全清重复抑制", !p.ClearAll());
        // 未置位释放同样抑制（恰一次语义的另一侧）
        var q = new X1AdapterInputPolicy();
        check("[policy-rel] 从未应用时释放移动抑制", !q.ReleaseMovement());
        check("[policy-rel] 从未应用时释放朝向抑制", !q.ReleaseFacing());
    }

    // ---- 边界：界上精确满幅、死区上下、归一化边界 ----
    private static void RunBoundary(CheckFn check)
    {
        // dist 恰为界：满幅 1.0（无截断误差）
        var ok = X1AdapterInputPolicy.TryMapCorrection(1.5, 0, 1.5, out var mx, out var mz);
        check("[policy-edge] 界上精确满幅", ok && Math.Abs(mx - 1.0) < 1e-9 && Math.Abs(mz) < 1e-9, $"{mx},{mz}");
        // 死区上：1e-11 > 1e-12 → 有输入（虽微小但非零）
        ok = X1AdapterInputPolicy.TryMapCorrection(1e-11, 0, 1.5, out mx, out mz);
        check("[policy-edge] 死区上微小输入非零", ok && mx != 0, $"{mx}");
        // 死区下：5e-13 < 1e-12 → 中性
        ok = X1AdapterInputPolicy.TryMapCorrection(5e-13, 0, 1.5, out mx, out mz);
        check("[policy-edge] 死区下中性", ok && mx == 0 && mz == 0, $"{mx}");
        // 朝向边界：-0.0 → 0；大角度归一
        check("[policy-edge] 朝向 -0.0→0", X1AdapterInputPolicy.TryMapFacing(-0.0, out var az) && Math.Abs(az) < 1e-9, az.ToString());
        check("[policy-edge] 朝向 1080→0", X1AdapterInputPolicy.TryMapFacing(1080, out var a1080) && Math.Abs(a1080) < 1e-9, a1080.ToString());
    }
}
