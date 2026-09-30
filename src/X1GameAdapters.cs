// 这个文件是干嘛的：X1 游戏侧适配器（Dalamud 绑定层，不进 datalayertest）——观测与槽的
// 输入层绑定（绝不传送/写世界坐标，框架线程调用）。休眠接线：准入关闭期间零 X1 事件，
// 本层零输出；能力使能、校准与部署另行主人授权。本文件无 SetPosition/传送/世界坐标写
// （CH-MODULE 可 grep 证伪）；IKeyState 在橙月版实测无效（见 20260828 3dpreview 交接），
// 故输入沿用 WalkReset 同款 OS 键注入 + 前台保护；CN 实机校准状态见 DESIGN-game-executor.md §6。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Dalamud.Plugin.Services;

namespace ChoreoHelper;

/// <summary>游戏观测适配器：自机/他演员位置供给（框架线程调用）。缺失/无效/未知一律抛
/// （X1 核心 fail-closed），绝不编造坐标。</summary>
public static class X1GameObservationAdapters
{
    /// <summary>自机位置供给：LocalPlayer 缺失或无效即抛中文（核心 fail-closed）。</summary>
    public static Func<(double X, double Z)> CreateOwnPositionProvider(IObjectTable objects)
    {
        if (objects == null) throw new ArgumentNullException(nameof(objects));
        return () =>
        {
            var player = objects.LocalPlayer;
            if (player == null || !player.IsValid())
                throw new InvalidOperationException("自机位置不可用：本地角色缺失（fail-closed，绝不编造坐标）");
            var p = player.Position;
            return ((double)p.X, (double)p.Z);
        };
    }

    /// <summary>他演员目标位置供给：按名称精确匹配目标；空标识/未知目标即抛中文（fail-closed）。</summary>
    public static Func<string, (double X, double Z)> CreateOtherActorPositionProvider(IObjectTable objects)
    {
        if (objects == null) throw new ArgumentNullException(nameof(objects));
        return (targetId) =>
        {
            if (string.IsNullOrWhiteSpace(targetId))
                throw new InvalidOperationException("目标观测不可用：目标标识为空（fail-closed，绝不编造坐标）");
            foreach (var obj in objects)
            {
                try
                {
                    if (obj != null && obj.IsValid() && obj.Name.TextValue == targetId)
                    {
                        var p = obj.Position;
                        return ((double)p.X, (double)p.Z);
                    }
                }
                catch
                {
                    // 单个对象读取失败继续扫描；全表无命中按未知目标抛
                }
            }
            throw new InvalidOperationException("未知目标「" + targetId + "」：无目标观测（fail-closed，绝不编造坐标）");
        };
    }

    /// <summary>自机朝向读取（弧度）：缺失/无效回 null（转向适配器保持上次按键，不编造方向）。</summary>
    public static Func<float?> CreateRotationReader(IObjectTable objects)
    {
        if (objects == null) throw new ArgumentNullException(nameof(objects));
        return () =>
        {
            try
            {
                var player = objects.LocalPlayer;
                if (player == null || !player.IsValid()) return null;
                return player.Rotation;
            }
            catch
            {
                return null;
            }
        };
    }
}

/// <summary>按键输出口（可注入假件；生产为 OS 键）。只表达输入层状态，不含坐标。</summary>
public interface IX1KeyWriter
{
    void SyncMove(bool w, bool a, bool s, bool d);
    void SyncTurn(bool left, bool right);
    void ReleaseAll();
    bool AnyHeld { get; }
}

/// <summary>OS 键输出：WalkReset 同款 keybd_event + 共享前台护栏（X1ForegroundPolicy：每次请求
//! 即时双读游戏主窗口/前台窗口句柄，窗口重建后自动恢复，绝不授权陈旧句柄；P3-b 修复口径）。
//! 游戏不在前台不注入；已持有键由 ReleaseAll 兜底释放（每键恰一次抬起，幂等）。只按/松
//! W/A/S/D/Q/E，绝不写坐标。必须在框架线程上调用（调用链 ShowRunner.Tick → UpdateActive → 槽，
//! 同守卫采集纪律）。</summary>
public sealed class X1OsKeyWriter : IX1KeyWriter
{
    public const byte VkW = 0x57;
    public const byte VkA = 0x41;
    public const byte VkS = 0x53;
    public const byte VkD = 0x44;
    public const byte VkQ = 0x51;
    public const byte VkE = 0x45;

    private const uint KeyEventKeyUp = 0x2;

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte vk, byte scan, uint flags, nint extra);

    // 判决与持态全部在共享纯策略（datalayertest 直测同一实现）；本类只留 OS 注入。
    private readonly X1ForegroundPolicy _fg;

    public X1OsKeyWriter()
        : this(ReadGameMainWindowHandle, () => GetForegroundWindow())
    {
    }

    /// <summary>注入构造（测试/特殊宿主用）：句柄读取与前台读取可替。</summary>
    public X1OsKeyWriter(Func<nint> gameHandleReader, Func<nint> foregroundHandleReader)
    {
        _fg = new X1ForegroundPolicy(gameHandleReader, foregroundHandleReader);
    }

    /// <summary>游戏主窗口句柄读取：异常按零处理（护栏零句柄 fail-closed 拒绝，不编造）。</summary>
    private static nint ReadGameMainWindowHandle()
    {
        try { return Process.GetCurrentProcess().MainWindowHandle; }
        catch { return nint.Zero; }
    }

    public bool AnyHeld => _fg.AnyHeld;
    internal static nuint InjectionMarker { get; } = CreateInjectionMarker();
    // era-reconciliation port (donor: source-witness X1GameAdapters.cs).
    internal static bool IsOwnKeyboardInjection(bool injected, nuint extraInfo)
        => injected && extraInfo == InjectionMarker;
    private static nuint CreateInjectionMarker()
    {
        Span<byte> bytes = stackalloc byte[8];
        nuint marker;
        do
        {
            System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
            marker = IntPtr.Size == 8 ? (nuint)BitConverter.ToUInt64(bytes) : (nuint)BitConverter.ToUInt32(bytes);
        } while (marker == 0);
        return marker;
    }

    private X1KeyBindings? _configuredBindings;
    // F8 restoration (lost member; called by X1InputPreparation:415 with session bindings).
    // Minimal: record the bindings. Effect on fixed-VK SyncMove/SyncTurn is unknown;
    // runtime key-remap behavior unverified (see R2 record).
    public void Configure(X1KeyBindings bindings) => _configuredBindings = bindings;

    private void SetHeld(byte vk, bool want)
    {
        if (want)
        {
            _fg.TryKeyDown(vk, b => keybd_event(b, 0, 0, nint.Zero)); // 前台不放行/注入失败：不持有不抛
            return;
        }
        _fg.TryKeyUp(vk, b => keybd_event(b, 0, KeyEventKeyUp, nint.Zero)); // 恰一次抬起，幂等
    }

    public void SyncMove(bool w, bool a, bool s, bool d)
    {
        SetHeld(VkW, w);
        SetHeld(VkA, a);
        SetHeld(VkS, s);
        SetHeld(VkD, d);
    }

    public void SyncTurn(bool left, bool right)
    {
        SetHeld(VkQ, left);
        SetHeld(VkE, right);
    }

    /// <summary>全松（幂等）：停演清扫/卸载唯一出口，重复调用零副作用。</summary>
    public void ReleaseAll()
    {
        _fg.ReleaseAll(vk => keybd_event(vk, 0, KeyEventKeyUp, nint.Zero));
    }
}

/// <summary>游戏槽适配器：X1 意图 → 纯策略状态 → OS 输入键（输入层 only）。移动按方向映射
/// 八向 WASD；朝向按目标角与当前弧度差选 Q/E（容差内松开）。Release/OnStop 全松恰一次。
/// 键位与转向约定均为暂定（STANDARD 布局假设、E=角度增大假设），CN 实机校准确认或整体替换，
/// 见 DESIGN-game-executor.md §6；校准前准入保持关闭，本层生产零输出。</summary>
public sealed class X1GameSinkAdapters : IX1MovementSink, IX1FacingSink
{
    /// <summary>满幅标尺（米）：修正向量归一化分母；单事件 MaxCorrectionM 在槽口不可见，
    /// 暂用设计 §6 常用界 1.5m，校准/使能包按事件接入真实界。</summary>
    public const double DefaultMoveFullScaleM = 1.5;

    /// <summary>按键死区（归一化）：分量绝对值低于此不按键（防抖）。</summary>
    public const double KeyDeadzone = 0.05;

    /// <summary>转向容差（度）：目标差低于此视为到达，松开转向键。</summary>
    public const double TurnToleranceDeg = 5.0;

    private readonly X1AdapterInputPolicy _policy = new();
    private readonly IX1KeyWriter _keys;
    private readonly Func<float?>? _rotationReader;
    private readonly double _moveFullScaleM;

    public X1GameSinkAdapters(Func<float?>? rotationReader = null, IX1KeyWriter? keys = null, double moveFullScaleM = DefaultMoveFullScaleM)
    {
        _rotationReader = rotationReader;
        _keys = keys ?? new X1OsKeyWriter();
        _moveFullScaleM = moveFullScaleM > 0 ? moveFullScaleM : DefaultMoveFullScaleM;
    }

    public X1AdapterInputState Current => _policy.Current;

    public void EmitCorrection(string eventId, double dx, double dz, double targetX, double targetZ, long showTimeMs)
    {
        if (!_policy.ApplyCorrection(dx, dz, _moveFullScaleM)) return;
        SyncMoveKeys();
    }

    public void ReleaseMovement(string eventId)
    {
        if (!_policy.ReleaseMovement()) return;
        SyncMoveKeys();
        if (_policy.Current.IsNeutral) _keys.ReleaseAll();
    }

    public void EmitFacing(string eventId, double angleDeg, long showTimeMs)
    {
        if (!_policy.ApplyFacing(angleDeg)) return;
        SyncTurnKeys();
    }

    public void ReleaseFacing(string eventId)
    {
        if (!_policy.ReleaseFacing()) return;
        SyncTurnKeys();
        if (_policy.Current.IsNeutral) _keys.ReleaseAll();
    }

    /// <summary>停演清扫：策略全清 + 按键全松（幂等）。</summary>
    public void ClearAll()
    {
        _policy.ClearAll();
        _keys.ReleaseAll();
    }

    private void SyncMoveKeys()
    {
        var s = _policy.Current;
        if (!s.HasMove)
        {
            _keys.SyncMove(false, false, false, false);
            return;
        }
        _keys.SyncMove(
            s.MoveZ > KeyDeadzone,
            s.MoveX < -KeyDeadzone,
            s.MoveZ < -KeyDeadzone,
            s.MoveX > KeyDeadzone);
    }

    private void SyncTurnKeys()
    {
        var s = _policy.Current;
        if (!s.HasTurn)
        {
            _keys.SyncTurn(false, false);
            return;
        }
        float? rot = null;
        try { rot = _rotationReader?.Invoke(); }
        catch { rot = null; }
        if (!rot.HasValue || float.IsNaN(rot.Value) || float.IsInfinity(rot.Value))
            throw new InvalidOperationException("当前朝向不可读，停止本场并释放输入");
        var currentDeg = X1MovementExecutor.NormalizeDeg(rot.Value * 180.0 / Math.PI);
        var delta = X1MovementExecutor.NormalizeDeg(s.TargetFacingDeg - currentDeg);
        if (delta < TurnToleranceDeg || delta > 360.0 - TurnToleranceDeg)
        {
            _keys.SyncTurn(false, false);
            return;
        }
        // 暂定：E=角度增大方向（0→90 经 +X/右侧），Q=反之；CN 校准确认或整体替换。
        if (delta <= 180.0) _keys.SyncTurn(false, true);
        else _keys.SyncTurn(true, false);
    }
}
