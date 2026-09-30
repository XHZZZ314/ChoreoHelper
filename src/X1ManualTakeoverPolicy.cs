// 这个文件是干嘛的：X1 物理输入观测的纯策略；只保存瞬时按住位，不记录按键顺序或文字。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public readonly record struct X1PhysicalInputSnapshot(
    bool Enabled, bool Healthy, bool Foreground, bool Armed, bool ManualTakeover,
    bool AnyPhysicalHeld, bool NeutralEstablished, string Failure, long PhysicalChangeSequence,
    long FocusLossSequence, long InjectedChangeSequence, long ForeignInjectedChangeSequence = 0,
    bool CooperativeHeld = false);

/// <summary>调用方串行化访问；时间为单调毫秒。原生观测失效锁定到明确重新开启。</summary>
public sealed class X1ManualTakeoverPolicy
{
    public const long HeartbeatLeaseMs = 250;
    private readonly bool[] _bindings = new bool[256];
    private readonly bool[] _physicalHeld = new bool[256];
    private readonly HashSet<byte> _cooperativeKeys=new();
    private bool _cooperationActive;
    public void SetCooperativeKeys(IEnumerable<byte> keys){_cooperativeKeys.Clear();foreach(var key in keys)_cooperativeKeys.Add(key);_cooperationActive=false;}
    public void ActivateCooperation()=>_cooperationActive=true;
    private bool _enabled, _foreground, _armed, _takeover, _neutral, _haveHeartbeat;
    private int _heldCount;
    private long _lastHeartbeatMs;
    private long _physicalChangeSequence;
    private long _focusLossSequence;
    private long _injectedChangeSequence;
    private long _foreignInjectedChangeSequence;
    private long _neutralRequestVersion;
    private string _failure = "";
    public long NeutralRequestVersion => _neutralRequestVersion;

    public void Enable(IEnumerable<byte> boundKeys, long nowMs)
    {
        if (boundKeys == null) throw new ArgumentNullException(nameof(boundKeys));
        var bindings = new bool[256];
        var count = 0;
        foreach (var key in boundKeys)
        {
            // 鼠标虚拟键和未分配值不能登记为移动键。
            if (key < 8 || key == 255) throw new ArgumentOutOfRangeException(nameof(boundKeys));
            if (!bindings[key]) { bindings[key] = true; count++; }
        }
        if (count == 0 || count > 32) throw new ArgumentException("请登记 1 至 32 个键", nameof(boundKeys));
        Disable();
        Array.Copy(bindings, _bindings, bindings.Length);
        _enabled = true;
        _lastHeartbeatMs = nowMs;
    }

    public void Disable()
    {
        _enabled = _foreground = _armed = _takeover = _neutral = _haveHeartbeat = false;
        _failure = "";
        _physicalChangeSequence = 0;
        _focusLossSequence = 0;
        _injectedChangeSequence = 0;
        _foreignInjectedChangeSequence = 0;
        _neutralRequestVersion = 0;
        ClearHeld();
        Array.Clear(_bindings, 0, _bindings.Length);
    }

    public void ObserveForeground(bool foreground)
    {
        if (!_enabled) return;
        if (_foreground && !foreground) _focusLossSequence++;
        _foreground = foreground;
        if (foreground) return;
        if (_armed) _takeover = true;
        _neutral = false;
        ClearHeld();
    }

    /// <summary>allInputReleased 仅是初始化/失焦恢复的保守全松门槛，不能分类注入输入。</summary>
    public void Heartbeat(long nowMs, bool foreground, bool hooksAvailable, bool allInputReleased,
        long? observedNeutralRequestVersion = null)
    {
        if (!_enabled) return;
        CheckLease(nowMs);
        ObserveForeground(foreground);
        if (!hooksAvailable) Fail("物理输入观测不可用，请关闭后重新准备");
        _lastHeartbeatMs = nowMs;
        _haveHeartbeat = true;
        if (_failure.Length == 0 && _foreground && !_neutral && allInputReleased
            && (!observedNeutralRequestVersion.HasValue || observedNeutralRequestVersion.Value == _neutralRequestVersion))
        {
            ClearHeld();
            _neutral = true;
        }
    }

    public void ObserveKey(byte virtualKey, bool down, bool injected, bool foreground, bool ownInjected = false)
    {
        if (!_enabled) return;
        ObserveForeground(foreground);
        if (!_foreground) return;
        if (injected) { CountInjection(ownInjected); return; }
        if (virtualKey == 0 || virtualKey == 255) return;
        if (_armed && !(_cooperationActive && _cooperativeKeys.Contains(virtualKey))) _takeover = true;
        if (!_neutral || _failure.Length != 0) return;
        if (_physicalHeld[virtualKey] == down) return;
        _physicalHeld[virtualKey] = down;
        _heldCount += down ? 1 : -1;
        _physicalChangeSequence++;
    }

    public void ObserveWheel(bool injected, bool foreground)
    {
        if (!_enabled) return;
        ObserveForeground(foreground);
        if (!_foreground) return;
        if (injected) { CountInjection(false); return; }
        if (_armed) _takeover = true;
        _physicalChangeSequence++;
    }

    public void ObserveInjectedPointer(bool foreground)
    {
        if (!_enabled) return;
        ObserveForeground(foreground);
        if (_foreground) CountInjection(false);
    }

    public (X1PhysicalInputSnapshot Snapshot, bool Held, bool OnlyHeld) ReadBoundKey(byte virtualKey, long nowMs)
    {
        var snapshot = Snapshot(nowMs);
        var held = snapshot.Healthy && snapshot.Foreground && snapshot.NeutralEstablished
            && _bindings[virtualKey] && _physicalHeld[virtualKey];
        return (snapshot, held, held && _heldCount == 1);
    }

    public bool IsBoundKeyHeld(byte virtualKey, long nowMs) => ReadBoundKey(virtualKey, nowMs).Held;

    public bool IsOnlyBoundKeyHeld(byte virtualKey, long nowMs)
        => ReadBoundKey(virtualKey, nowMs).OnlyHeld;

    public bool TryArm(long nowMs, out string error)
    {
        var snapshot = Snapshot(nowMs);
        error = !snapshot.Healthy ? snapshot.Failure
            : !snapshot.Foreground ? "游戏须在前台"
            : !snapshot.NeutralEstablished || snapshot.AnyPhysicalHeld ? "请先松开全部按键和鼠标按钮"
            : "";
        if (error.Length != 0) return false;
        // 已 armed 不能借重复请求清除尚未处理的接管锁。
        if (_armed)
        {
            if (_takeover) { error = "已发生手动接管，请先停止本次演出"; return false; }
            return true;
        }
        _takeover = false;
        _armed = true;
        return true;
    }

    public void Disarm() { _armed = false; _cooperationActive=false; }

    /// <summary>每次被动校准/接管检查都要求一次新的全松证明；旧帧扫描不能满足新请求。</summary>
    public void RequireNeutral()
    {
        if (!_enabled) throw new InvalidOperationException("请先开启物理输入观测");
        if (_armed) throw new InvalidOperationException("请先结束当前接管检查或演出");
        _neutral = false;
        _neutralRequestVersion++;
        ClearHeld();
    }

    public void Fail(string reason)
    {
        if (!_enabled || _failure.Length != 0) return;
        _failure = string.IsNullOrWhiteSpace(reason) ? "物理输入观测失败" : reason;
        _neutral = false;
        ClearHeld();
    }

    public X1PhysicalInputSnapshot Snapshot(long nowMs)
    {
        CheckLease(nowMs);
        var healthy = _enabled && _haveHeartbeat && _failure.Length == 0;
        var reason = !_enabled ? "尚未开启物理输入观测" : _failure.Length != 0 ? _failure
            : !_haveHeartbeat ? "物理输入观测正在准备" : "";
        return new(_enabled, healthy, _foreground, _armed, _takeover, _heldCount != 0, _neutral,
            reason, _physicalChangeSequence, _focusLossSequence, _injectedChangeSequence, _foreignInjectedChangeSequence,
            _cooperationActive && !_takeover && _heldCount>0);
    }

    private void CountInjection(bool ownInjected)
    {
        // 旧被动校准仍检查全部注入；自动探测另外要求外来注入计数不变。
        _injectedChangeSequence++;
        if (!ownInjected) _foreignInjectedChangeSequence++;
    }

    private void CheckLease(long nowMs)
    {
        if (_enabled && (nowMs < _lastHeartbeatMs || nowMs - _lastHeartbeatMs > HeartbeatLeaseMs))
            Fail("物理输入观测超时，请关闭后重新准备");
    }

    private void ClearHeld()
    {
        Array.Clear(_physicalHeld, 0, _physicalHeld.Length);
        _heldCount = 0;
    }
}
