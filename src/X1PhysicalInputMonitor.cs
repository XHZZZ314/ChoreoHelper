// 这个文件是干嘛的：仅本人开启后观测游戏前台物理输入；不注入、不吞输入、不记录文字。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace ChoreoHelper;

/// <summary>
/// 专用线程泵送 WH_KEYBOARD_LL/WH_MOUSE_LL，注入标志事件不计为物理接管。
/// 100ms 先装新钩再卸旧钩；所有原生失败与 250ms 心跳超时均锁住准备。
/// 续订只能限制已知失效窗口，不能证明 Windows 持续投递了每一个物理事件。
/// 不注册 Raw Input，避免覆盖 FF14/Dalamud 进程已有设备注册。
/// </summary>
public sealed class X1PhysicalInputMonitor : IDisposable
{
    private const int KeyboardHook = 13, MouseHook = 14;
    private const uint QuitMessage = 0x0012, RemoveMessage = 1, AllInput = 0x04FF, InputAvailable = 0x0004;
    private const long RenewalIntervalMs = 100;
    private readonly object _gate = new();
    private readonly X1ManualTakeoverPolicy _policy = new();
    private readonly HookProc _keyboardCallback, _mouseCallback;
    private Thread? _thread;
    private volatile bool _stop;
    private bool _disposed;
    private uint _threadId;
    private nint _gameWindow;
    private readonly List<nint> _unconfirmedHooks = new();

    public X1PhysicalInputMonitor()
    {
        _keyboardCallback = OnKeyboard;
        _mouseCallback = OnMouse;
    }

    /// <summary>由游戏框架线程明确调用；异步准备，不会因此允许 X1 写输入。</summary>
    public void Enable(IEnumerable<byte> boundKeys)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Disable();
        if (_thread?.IsAlive == true) throw new InvalidOperationException("旧输入观测尚未退出，不能重新准备");
        lock (_gate)
        {
            _policy.Enable(boundKeys, Now());
            _stop = false;
            _thread = new Thread(Run) { IsBackground = true, Name = "ChoreoHelper X1 input observer" };
            try { _thread.Start(); }
            catch { _policy.Fail("物理输入观测线程启动失败"); throw; }
        }
    }

    public X1PhysicalInputSnapshot Snapshot()
    {
        lock (_gate)
        {
            var current = _policy.Snapshot(Now());
            if (!current.Enabled) return current;
        }
        var foreground = ReadForeground();
        lock (_gate)
        {
            _policy.ObserveForeground(foreground);
            return _policy.Snapshot(Now());
        }
    }

    public bool IsBoundKeyHeld(byte key)
    {
        var foreground = ReadForeground();
        lock (_gate)
        {
            _policy.ObserveForeground(foreground);
            return _policy.IsBoundKeyHeld(key, Now());
        }
    }

    public bool IsOnlyBoundKeyHeld(byte key)
    {
        var foreground = ReadForeground();
        lock (_gate)
        {
            _policy.ObserveForeground(foreground);
            return _policy.IsOnlyBoundKeyHeld(key, Now());
        }
    }

    /// <summary>一次锁内读取健康、计数及目标持态，防止校准两次读取之间收到按键松开。</summary>
    public (X1PhysicalInputSnapshot Snapshot, bool Held, bool OnlyHeld) ReadBoundKey(byte key)
    {
        var foreground = ReadForeground();
        lock (_gate)
        {
            _policy.ObserveForeground(foreground);
            return _policy.ReadBoundKey(key, Now());
        }
    }

    public bool TryArm(out string error)
    {
        var foreground = ReadForeground();
        // 按住状态只用于保守拒绝；不能从 GetAsyncKeyState 推断物理/注入来源。
        var allReleased = foreground && AllInputReleased();
        lock (_gate)
        {
            _policy.ObserveForeground(foreground);
            if (!allReleased) { error = "请让游戏在前台并先松开全部按键和鼠标按钮"; return false; }
            return _policy.TryArm(Now(), out error);
        }
    }

    public void Disarm() { lock (_gate) _policy.Disarm(); }
    // era-reconciliation micro-adds (no donor; stored for future wiring, behavior unverified).
    public void SetCooperativeKeys(byte[] keys) { lock (_gate) _policy.SetCooperativeKeys(keys ?? Array.Empty<byte>()); }
    public void ActivateCooperation() { lock (_gate) _policy.ActivateCooperation(); }

    public void RequireNeutral() { lock (_gate) _policy.RequireNeutral(); }
    /// <summary>证据用原子请求快照；后台心跳不能在请求和返回之间提前替换 neutral=false。</summary>
    public X1PhysicalInputSnapshot RequireNeutralSnapshot()
    {
        var foreground = ReadForeground();
        lock (_gate)
        {
            _policy.ObserveForeground(foreground);
            _policy.RequireNeutral();
            return _policy.Snapshot(Now());
        }
    }

    public void Disable()
    {
        Thread? thread;
        lock (_gate)
        {
            _stop = true;
            _policy.Disarm();
            _policy.Fail("物理输入观测正在关闭");
            thread = _thread;
        }
        if (thread != null)
        {
            var id = Volatile.Read(ref _threadId);
            if (id != 0) PostThreadMessageW(id, QuitMessage, 0, 0);
            // 不拿策略锁等待；回调始终可以返回 CallNextHookEx。
            if (thread.IsAlive && !thread.Join(1000))
                throw new InvalidOperationException("物理输入观测未确认退出，请勿继续输入准备");
        }
        // 续订时旧钩子卸载失败不能丢弃句柄并伪造清理成功；允许明确关闭重试。
        for (var index = _unconfirmedHooks.Count - 1; index >= 0; index--)
        {
            var hook = _unconfirmedHooks[index];
            if (TryCleanup(ref hook)) _unconfirmedHooks.RemoveAt(index);
        }
        if (_unconfirmedHooks.Count != 0)
            throw new InvalidOperationException("物理输入观测钩子清理未确认，请勿继续输入准备");
        lock (_gate)
        {
            if (ReferenceEquals(_thread, thread)) _thread = null;
            _policy.Disable();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        Disable();
        _disposed = true;
    }

    private void Run()
    {
        nint keyboard = 0, mouse = 0;
        try
        {
            Volatile.Write(ref _threadId, GetCurrentThreadId());
            // 先建立线程消息队列，随后才能可靠收到关闭消息。
            PeekMessageW(out _, 0, 0, 0, 0);
            var module = GetModuleHandleW(null);
            if (module == 0) throw new InvalidOperationException();
            if (!RenewHooks(module, ref keyboard, ref mouse)) return;
            var renewedAt = Now();
            while (!_stop)
            {
                // PeekMessage 会派发发往本线程的低级钩子回调；不需要窗口或用户可见 UI。
                while (PeekMessageW(out var message, 0, 0, 0, RemoveMessage))
                    if (message.Message == QuitMessage) _stop = true;
                if (_stop) break;
                var now = Now();
                if (now - renewedAt >= RenewalIntervalMs)
                {
                    if (!RenewHooks(module, ref keyboard, ref mouse)) return;
                    renewedAt = Now();
                }
                var foreground = ReadForeground();
                long neutralRequest;
                lock (_gate) neutralRequest = _policy.NeutralRequestVersion;
                var allReleased = foreground && AllInputReleased();
                lock (_gate) _policy.Heartbeat(Now(), foreground, keyboard != 0 && mouse != 0, allReleased, neutralRequest);
                if (MsgWaitForMultipleObjectsEx(0, 0, 20, AllInput, InputAvailable) == uint.MaxValue)
                {
                    Fail("物理输入消息循环失败，请关闭后重新准备");
                    return;
                }
            }
        }
        catch { Fail("物理输入观测失败，请关闭后重新准备"); }
        finally
        {
            // 句柄和委托归本线程持有，退出后才允许重新 Enable。
            if (!TryCleanup(ref keyboard)) { RememberUnconfirmedHook(keyboard); Fail("键盘观测清理未确认"); }
            if (!TryCleanup(ref mouse)) { RememberUnconfirmedHook(mouse); Fail("鼠标观测清理未确认"); }
            Volatile.Write(ref _threadId, 0);
            if (!_stop) Fail("物理输入观测已退出，请关闭后重新准备");
        }
    }

    private bool RenewHooks(nint module, ref nint keyboard, ref nint mouse)
    {
        var nextKeyboard = SetWindowsHookExW(KeyboardHook, _keyboardCallback, module, 0);
        var nextMouse = SetWindowsHookExW(MouseHook, _mouseCallback, module, 0);
        if (nextKeyboard == 0 || nextMouse == 0)
        {
            if (!TryCleanup(ref nextKeyboard)) RememberUnconfirmedHook(nextKeyboard);
            if (!TryCleanup(ref nextMouse)) RememberUnconfirmedHook(nextMouse);
            Fail("物理输入观测安装或续订失败，请关闭后重新准备");
            return false;
        }
        var keyboardRemoved = keyboard == 0 || UnhookWindowsHookEx(keyboard);
        var mouseRemoved = mouse == 0 || UnhookWindowsHookEx(mouse);
        if (!keyboardRemoved) RememberUnconfirmedHook(keyboard);
        if (!mouseRemoved) RememberUnconfirmedHook(mouse);
        keyboard = nextKeyboard;
        mouse = nextMouse;
        if (keyboardRemoved && mouseRemoved) return true;
        Fail("物理输入观测旧钩子状态无法确认，请关闭后重新准备");
        return false;
    }

    private nint OnKeyboard(int code, nuint wParam, nint lParam)
    {
        try
        {
            if (code >= 0 && !_stop)
            {
                var foreground = IsCachedGameForeground();
                if (!foreground) { lock (_gate) _policy.ObserveForeground(false); }
                else if (wParam is 0x0100 or 0x0101 or 0x0104 or 0x0105)
                {
                    var data = Marshal.PtrToStructure<KeyboardData>(lParam);
                    if (data.VirtualKey is > 0 and < 255)
                    {
                        var injected = (data.Flags & 0x12) != 0;
                        var ownInjected = X1OsKeyWriter.IsOwnKeyboardInjection(injected, data.ExtraInfo);
                        lock (_gate) _policy.ObserveKey((byte)data.VirtualKey,
                            wParam is 0x0100 or 0x0104, injected, true, ownInjected);
                    }
                }
            }
        }
        catch { Fail("键盘物理输入回调失败，请关闭后重新准备"); }
        return CallNextHookEx(0, code, wParam, lParam);
    }

    private nint OnMouse(int code, nuint wParam, nint lParam)
    {
        try
        {
            if (code >= 0 && !_stop)
            {
                var foreground = IsCachedGameForeground();
                if (!foreground) { lock (_gate) _policy.ObserveForeground(false); }
                else
                {
                    var data = Marshal.PtrToStructure<MouseData>(lParam);
                    var injected = (data.Flags & 0x3) != 0;
                    byte key = wParam switch
                    {
                        0x0201 or 0x0202 => 1, 0x0204 or 0x0205 => 2,
                        0x0207 or 0x0208 => 4,
                        0x020B or 0x020C => (byte)((data.ButtonData >> 16) == 1 ? 5 : 6),
                        _ => 0,
                    };
                    lock (_gate)
                    {
                        // 游标坐标从不保存或输出；本插件只注入键盘，鼠标注入均计为外来污染。
                        if (wParam == 0x0200 && injected) _policy.ObserveInjectedPointer(true);
                        else if (key != 0) _policy.ObserveKey(key, wParam is 0x0201 or 0x0204 or 0x0207 or 0x020B, injected, true);
                        else if (wParam is 0x020A or 0x020E) _policy.ObserveWheel(injected, true);
                    }
                }
            }
        }
        catch { Fail("鼠标物理输入回调失败，请关闭后重新准备"); }
        return CallNextHookEx(0, code, wParam, lParam);
    }

    private bool ReadForeground()
    {
        try
        {
            using var process = Process.GetCurrentProcess();
            var gameWindow = process.MainWindowHandle;
            Interlocked.Exchange(ref _gameWindow, gameWindow);
            return gameWindow != 0 && gameWindow == GetForegroundWindow();
        }
        catch { Interlocked.Exchange(ref _gameWindow, 0); return false; }
    }

    private bool IsCachedGameForeground()
    {
        var gameWindow = Interlocked.CompareExchange(ref _gameWindow, 0, 0);
        var foreground = GetForegroundWindow();
        if (gameWindow == 0 || gameWindow != foreground) return false;
        GetWindowThreadProcessId(foreground, out var processId);
        return processId == (uint)Environment.ProcessId;
    }

    private static bool AllInputReleased()
    {
        // 仅归约一个“有键按住”的布尔值；不复制/返回键码或状态数组。
        for (var key = 1; key < 255; key++)
            if ((GetAsyncKeyState(key) & 0x8000) != 0) return false;
        return true;
    }

    private void Fail(string reason) { lock (_gate) _policy.Fail(reason); }
    private void RememberUnconfirmedHook(nint hook)
    {
        if (!_unconfirmedHooks.Contains(hook)) _unconfirmedHooks.Add(hook);
    }
    private static bool TryCleanup(ref nint hook)
    {
        if (hook == 0) return true;
        // 1404 是原生确认无效句柄；只允许清理收尾，不会恢复本次失效观测的健康状态。
        if (!UnhookWindowsHookEx(hook) && Marshal.GetLastWin32Error() != 1404) return false;
        hook = 0;
        return true;
    }
    private static long Now() => Environment.TickCount64;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate nint HookProc(int code, nuint wParam, nint lParam);
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardData { public uint VirtualKey, ScanCode, Flags, Time; public nuint ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseData { public Point Point; public uint ButtonData, Flags, Time; public nuint ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MessageData { public nint Window; public uint Message; public nuint WParam; public nint LParam; public uint Time; public Point Point; public uint Private; }

    [DllImport("user32.dll", SetLastError = true)] private static extern nint SetWindowsHookExW(int idHook, HookProc callback, nint module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] private static extern nint CallNextHookEx(nint hook, int code, nuint wParam, nint lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PeekMessageW(out MessageData message, nint window, uint min, uint max, uint remove);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostThreadMessageW(uint threadId, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint MsgWaitForMultipleObjectsEx(uint count, nint handles, uint milliseconds, uint wakeMask, uint flags);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint processId);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern nint GetModuleHandleW(string? moduleName);
}
