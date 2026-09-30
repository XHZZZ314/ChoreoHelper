// 这个文件是干嘛的：X1 移动/朝向意图到输入层状态的纯策略（无 Dalamud 依赖，进 datalayertest）。
// 设计文档 §6 输入层约束：只产出归一化移动/转向输入状态（绝不写世界坐标）；修正限幅、
// 非有限 fail-closed 零状态变化；释放幂等恰一次。调用方（游戏槽适配器）在框架线程上把
// 本状态刷进 OS 键位；本文件不碰任何游戏/Dalamud 对象。
using System;

namespace ChoreoHelper;

/// <summary>输入层状态：移动分量归一化到 [-1,1]（中性=0），目标朝向归一化到 [0,360)。中性=无输入。</summary>
public struct X1AdapterInputState
{
    public double MoveX;
    public double MoveZ;
    public double TargetFacingDeg;
    public bool HasMove;
    public bool HasTurn;
    public readonly bool IsNeutral => !HasMove && !HasTurn;
}

/// <summary>纯意图到输入策略：方向映射确定、修正限幅、非有限 fail-closed 零状态变化；释放幂等恰一次。</summary>
public sealed class X1AdapterInputPolicy
{
    /// <summary>零/微小修正死区（米）：与移动切向退化口径同量级，低于此视为中性无输入。</summary>
    public const double DeadzoneM = 1e-12;

    public X1AdapterInputState Current { get; private set; }

    public static double Clamp11(double v) => v < -1 ? -1 : v > 1 ? 1 : v;

    /// <summary>修正向量映射：方向保持、模长按修正界截断后归一化到 [-1,1]；死区下零输出；
    /// 非有限输入/非正修正界一律 false 且零输出。</summary>
    public static bool TryMapCorrection(double dx, double dz, double maxCorrectionM, out double moveX, out double moveZ)
    {
        moveX = 0;
        moveZ = 0;
        if (!X1InputValidation.IsFiniteDouble(dx) || !X1InputValidation.IsFiniteDouble(dz)) return false;
        if (!X1InputValidation.IsFiniteDouble(maxCorrectionM) || !(maxCorrectionM > 0)) return false;
        var dist = Math.Sqrt(dx * dx + dz * dz);
        if (!X1InputValidation.IsFiniteDouble(dist)) return false;
        if (dist < DeadzoneM) return true;
        var bound = Math.Min(dist, maxCorrectionM);
        var ox = dx / dist * bound;
        var oz = dz / dist * bound;
        moveX = Clamp11(ox / maxCorrectionM);
        moveZ = Clamp11(oz / maxCorrectionM);
        return true;
    }

    /// <summary>朝向映射：归一化到 [0,360)；非有限一律 false 且零输出。</summary>
    public static bool TryMapFacing(double angleDeg, out double normalized)
    {
        normalized = 0;
        if (!X1InputValidation.IsFiniteDouble(angleDeg)) return false;
        normalized = X1MovementExecutor.NormalizeDeg(angleDeg);
        return true;
    }

    /// <summary>应用移动修正：fail-closed 时零状态变化；零/死区修正清移动输入（中性）。</summary>
    public bool ApplyCorrection(double dx, double dz, double maxCorrectionM)
    {
        if (!TryMapCorrection(dx, dz, maxCorrectionM, out var mx, out var mz)) return false;
        var s = Current;
        if (mx == 0 && mz == 0)
        {
            s.MoveX = 0;
            s.MoveZ = 0;
            s.HasMove = false;
        }
        else
        {
            s.MoveX = mx;
            s.MoveZ = mz;
            s.HasMove = true;
        }
        Current = s;
        return true;
    }

    /// <summary>应用朝向：fail-closed 时零状态变化。</summary>
    public bool ApplyFacing(double angleDeg)
    {
        if (!TryMapFacing(angleDeg, out var a)) return false;
        var s = Current;
        s.TargetFacingDeg = a;
        s.HasTurn = true;
        Current = s;
        return true;
    }

    /// <summary>释放移动：已中性时抑制（返回 false），否则清零恰一次。</summary>
    public bool ReleaseMovement()
    {
        if (!Current.HasMove) return false;
        var s = Current;
        s.MoveX = 0;
        s.MoveZ = 0;
        s.HasMove = false;
        Current = s;
        return true;
    }

    /// <summary>释放朝向：已中性时抑制（返回 false），否则清零恰一次。</summary>
    public bool ReleaseFacing()
    {
        if (!Current.HasTurn) return false;
        var s = Current;
        s.TargetFacingDeg = 0;
        s.HasTurn = false;
        Current = s;
        return true;
    }

    /// <summary>全清：已中性时抑制（返回 false），否则回到中性恰一次。</summary>
    public bool ClearAll()
    {
        if (Current.IsNeutral) return false;
        Current = new X1AdapterInputState();
        return true;
    }
}
