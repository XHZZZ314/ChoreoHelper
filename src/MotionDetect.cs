using System.Numerics;

namespace ChoreoHelper;

/// <summary>
/// MotionDetect：录制收尾"静止判据"纯函数件（v0.7.1 AUD-016）。
/// 老判据把四元数压成 x²+y²+z² 单标量再取差：对"姿势旋转大"的骨灵敏，
/// 对"接近恒等姿势"的骨有盲区——同角度不同轴的两个旋转，标量可以相等（漏检→提前掐断）。
/// 2026-08-29 用真实 264 条录制数据校准（scripts\calibrate-motion2.js，一次性工具留档）：
///   · 71 条提前 settled 的 clip 里，老判据静止窗口的旋转角峰值 0.4735 rad（joy）；
///   · 慢动作（attend/atease）真运动最小 0.21 rad，但老标量能抓住（大姿势骨）。
/// 新口径 = 老标量 OR 旋转角 OR 平移，任一超阈值即在动：严格比老判据更灵敏，
/// 历史能收尾的全部照旧收尾，恒等姿势骨上的大旋转盲区补上。
/// 不依赖 Dalamud，src\tests\datalayertest 直测数学口径（同 ChatCommandBuffer 惯例）。
/// </summary>
public static class MotionDetect
{
    /// <summary>老标量阈值（v0.6.5 实测值，2026-08-28 真实数据回放校准），不动。</summary>
    public const float StillOldMetric = 0.05f;
    /// <summary>真实旋转角阈值（弧度）：> 校准实测余波峰值 0.4735，留余量。</summary>
    public const float StillAngleRad = 0.5f;
    /// <summary>局部空间平移阈值（米）：老判据完全无视平移，补上保守下限。</summary>
    public const float StillTransM = 0.02f;

    /// <summary>两帧旋转之间的真实角距离（弧度）。q 与 -q 等价（取 dot 绝对值）；
    /// Decompose 失败或零四元数按"大幅旋转"保守处理，宁可多录不可提前掐。</summary>
    public static float RotationDeltaRad(Matrix4x4 a, Matrix4x4 b)
    {
        if (!Matrix4x4.Decompose(a, out _, out var qa, out _) ||
            !Matrix4x4.Decompose(b, out _, out var qb, out _))
            return float.MaxValue;
        var la = qa.LengthSquared();
        var lb = qb.LengthSquared();
        if (la < 1e-12f || lb < 1e-12f) return float.MaxValue;
        var d = Math.Clamp(MathF.Abs(Quaternion.Dot(qa, qb)) / MathF.Sqrt(la * lb), 0f, 1f);
        return 2f * MathF.Acos(d);
    }

    /// <summary>骨骼两帧之间是否在动（三条件判据，任一超阈值即在动）。</summary>
    public static bool IsMoving(Matrix4x4 a, Matrix4x4 b)
    {
        if (!Matrix4x4.Decompose(a, out _, out var qa, out var pa) ||
            !Matrix4x4.Decompose(b, out _, out var qb, out var pb))
            return true; // 解不开 = 保守当作在动
        var oldMetric = MathF.Abs(
            (qa.X * qa.X + qa.Y * qa.Y + qa.Z * qa.Z) -
            (qb.X * qb.X + qb.Y * qb.Y + qb.Z * qb.Z));
        if (oldMetric > StillOldMetric) return true;
        if (RotationDeltaRad(a, b) > StillAngleRad) return true;
        return Vector3.Distance(pa, pb) > StillTransM;
    }
}
