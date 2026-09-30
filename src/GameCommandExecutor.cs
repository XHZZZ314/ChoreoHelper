// 这个文件是干嘛的：同一输出租约下排队和同步执行本机命令，撤销后旧命令不能复活。
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.System.Framework;
using FFXIVClientStructs.FFXIV.Client.System.String;
using FFXIVClientStructs.FFXIV.Client.UI;

namespace ChoreoHelper;

public sealed class GameCommandExecutor : IDisposable
{
    private readonly IPluginLog _log;
    private readonly IGameGui _gameGui;
    private readonly ISigScanner _sigScanner;
    private readonly IFramework _framework;
    // 队列条目带入队时间戳：出队时超时丢弃，防止积压命令无限滞后
    public GameOutputOwnership OutputOwnership { get; } = new();
    // 执行证据链 P1（TASK-20260916-EXEC-EVIDENCE-P1-MOTION）：纯证据板只记录，绝不改变
    // 队列判定的控制流；与队列共用同一把锁（ShowRunner 的门也是它，板操作全部可重入）
    public MotionEvidenceBoard Evidence { get; }
    private readonly Queue<(string Cmd, long EnqueuedTick, GameOutputLease Lease, GameOutputLease? Origin, Func<bool>? Guard, CommandTicket Ticket)> _commandQueue = new();
    private object _queueLock => OutputOwnership.SyncRoot;
    private const int MaxQueueSize = 64;      // 上限：防止密集 clip 无限积压
    private const long MaxQueueAgeMs = 5000;  // 出队时超过 5s 的命令视为过期丢弃

    // Delegate for ProcessChatBoxEntry (member function: thiscall in C++ terms)
    // In x64, 'this' goes in rcx, so: rcx=this(uiModule), rdx=message, r8=unused, r9b=saveToHistory
    private delegate void ProcessChatBoxEntryDelegate(nint uiModule, nint message, nint unused, byte saveToHistory);

    private ProcessChatBoxEntryDelegate? _processChatBoxEntry;
    private nint _processChatBoxEntryAddr = 0;

    public bool IsAvailable => _processChatBoxEntryAddr != 0;

    // 明确短演出即时提交：复用原生命令与节流，独占租约有效才发送，不入队、不重试。
    internal bool SubmitBoundedPlayback(string command, GameOutputLease lease)
    {
        if (!lease.Exclusive || !lease.BelongsTo(OutputOwnership)) return false;
        return lease.TryRun(() =>
        {
            if (!IsAvailable || !ChatCommandPolicy.TryValidate(command, out _) || PendingCount != 0) return false;
            var now = Environment.TickCount64;
            if (!_throttle.AllowNow(now)) return false;
            _throttle.OnExecuted(now);
            ExecuteNative(command);
            return true; // 仅原生提交；职业确认由后续实际读数提供。
        });
    }

    public GameCommandExecutor(IGameGui gameGui, ISigScanner sigScanner, IPluginLog log, IFramework framework)
    {
        _gameGui = gameGui;
        _sigScanner = sigScanner;
        _log = log;
        _framework = framework;
        Evidence = new MotionEvidenceBoard(OutputOwnership.SyncRoot);
        _framework.Update += OnFrameworkUpdate;

        // Try multiple signatures
        string[] sigs = [
            "48 89 5C 24 ?? 48 89 74 24 ?? 57 48 83 EC 20 48 8B F2 48 8B F9 45 84 C9", // FFXIVClientStructs ProcessChatBoxEntry
            "48 89 5C 24 ?? 57 48 83 EC 20 48 8B FA 48 8B D9 45 84 C9",               // OOBlugin ProcessChatBox
            "48 89 5C 24 ?? 48 89 6C 24 ?? 48 89 74 24 ?? 57 48 83 EC 28 48 8B FA 48 8B F9 45 84 C9", // variant
            "4C 8B DC 49 89 5B 10 49 89 6B 18 49 89 73 20 57 48 83 EC 30 8B F2",       // another variant
        ];

        for (int i = 0; i < sigs.Length; i++)
        {
            try
            {
                var addr = _sigScanner.ScanText(sigs[i]);
                _processChatBoxEntryAddr = addr;
                _processChatBoxEntry = Marshal.GetDelegateForFunctionPointer<ProcessChatBoxEntryDelegate>(addr);
                _log.Information("[sig {i}] Found at {addr}: {sig}", i, addr, sigs[i]);
                break;
            }
            catch (Exception ex)
            {
                _log.Information("[sig {i}] Not found: {sig} ({msg})", i, sigs[i], ex.Message);
            }
        }

        if (_processChatBoxEntryAddr == 0)
        {
            _log.Error("All signatures failed! Will try FFXIVClientStructs member function as fallback.");
        }
        else
        {
            _log.Information("GameCommandExecutor: using direct delegate at {addr}", _processChatBoxEntryAddr);
        }
    }

    public void ExecuteCommand(string command, GameOutputLease? origin = null, Func<bool>? originGuard = null)
        => ExecuteCommandTracked(command, origin, originGuard);

    /// <summary>追踪版入队（执行证据链 P1，加法入口）：与旧 ExecuteCommand 同一判定序列、
    /// 同一日志与队列副作用，返回的票据在证据板上逐态演进（七条静默丢弃路径与原生异常
    /// 各得终态）。证据只记录：不改变任何判定结果，也绝无重发。</summary>
    public CommandTicket ExecuteCommandTracked(string command, GameOutputLease? origin = null, Func<bool>? originGuard = null)
    {
        var ticket = Evidence.OpenTicket();
        var now = Environment.TickCount64;
        if (string.IsNullOrWhiteSpace(command))
        {
            Evidence.RecordQueueRejected(ticket, "empty", now);
            return ticket;
        }
        // AUD2-005：交给游戏前的最后一道闸。HTTP 层各入口已提前校验并回 400，
        // 这里兜底拦截内部旁路（定格器/录制触发/seek 前置切换），危险输入直接丢弃。
        if (!ChatCommandPolicy.TryValidate(command, out var reason))
        {
            _log.Warning("Command rejected by policy: {reason} (head='{head}')", reason, ChatCommandPolicy.DescribeForLog(command));
            Evidence.RecordQueueRejected(ticket, "policy", now);
            return ticket;
        }
        lock (_queueLock)
        {
            if (origin != null && !origin.IsCurrent || !GuardCurrent(originGuard))
            {
                Evidence.RecordQueueRejected(ticket, "stale-origin", now);
                return ticket;
            }
            if (!OutputOwnership.TryAcquireLegacy("command-queue", out var lease))
            {
                _log.Warning("命令未入队：当前由独占试验持有游戏输出");
                Evidence.RecordQueueRejected(ticket, "exclusive-owner", now);
                return ticket;
            }
            if (_commandQueue.Count >= MaxQueueSize)
            {
                var victim = _commandQueue.Dequeue();
                victim.Lease.Dispose(); // 队列满：丢最旧，避免无限积压
                Evidence.RecordDroppedOldest(victim.Ticket, now);
                _log.Warning("Command queue full ({n}), dropped oldest", MaxQueueSize);
            }
            _commandQueue.Enqueue((command, now, lease!, origin, originGuard, ticket));
            Evidence.RecordQueued(ticket, now);
        }
        // Info 每条命令只留这一行审计（歌词等个人文本经 DescribeForLog 隐藏明文）；
        // Pre-call/Post-call 细节降到 Debug（2026-08-31 审计 P2：每条命令 4 条 Info 密度偏高）
        _log.Information("Queued: {cmd}", ChatCommandPolicy.DescribeForLog(command));
        return ticket;
    }

    /// <summary>X1 专用同步提交（TASK-20260912-X1-ABILITY-ADAPTER r3，加法入口）：在调用线程上
    /// 即时完成一次聊天命令原生写入——不入队、不重试、不重排遗留队列。共享同一 200ms
    /// CommandThrottlePolicy 基准（busy 即刻拒绝，既不越权插队也不被遗留积压拖带）；原生前置
    /// 缺失（签名扫描失败）与命令闸拒绝即刻 false；原生异常原样上抛为可观测本地失败
    ///（由执行器冻结映射 SinkException）。另需属于本执行器的有效独占租约。</summary>
    public bool SubmitX1Synchronous(string command, GameOutputLease? lease = null)
    {
        if (lease == null || !lease.Exclusive || !lease.BelongsTo(OutputOwnership)) return false;
        return lease.TryRun(() =>
        {
            if (string.IsNullOrWhiteSpace(command)) return false;
            if (!IsAvailable) return false; // 原生前置缺失：即刻拒绝（可观测的本地失败）
            if (!ChatCommandPolicy.TryValidate(command, out var reason))
            {
                _log.Warning("X1 sync command rejected by policy: {reason} (head='{head}')", reason, ChatCommandPolicy.DescribeForLog(command));
                return false;
            }
            var nowMs = Environment.TickCount64;
            if (!_throttle.AllowNow(nowMs)) return false; // busy/throttled：即刻拒绝，不入队不等待
            _throttle.OnExecuted(nowMs); // 与遗留队列共享同一节流基准（互不越权、互不重排）
            ExecuteNative(command);
            _log.Information("X1 sync: {cmd}", ChatCommandPolicy.DescribeForLog(command));
            return true;
        });
    }

    /// <summary>日志摘要：命令只记前 60 字符，超长截断——不把任意大输入打进日志。</summary>
    private static string LogHead(string command)
        => command.Length <= 60 ? command : command.Substring(0, 60) + "…(" + command.Length + "字符)";

    /// <summary>清空待执行队列（停止/暂停/重播时调用，防止残留命令乱执行）</summary>
    public void Clear()
    {
        lock (_queueLock)
        {
            while (_commandQueue.Count > 0) _commandQueue.Dequeue().Lease.Dispose();
        }
    }

    /// <summary>只移除队列中匹配的命令，保留其他链路（播放/演出/录制）已入队的命令。
    /// 定格器重发/切换命令前用它代替 Clear——全进程单实例单队列，Clear 会把别的链路
    /// 还没执行的命令连带丢掉（2026-08-31 审计 P1）。返回移除条数。</summary>
    public int RemoveWhere(Func<string, bool> match)
    {
        if (match == null) return 0;
        lock (_queueLock)
        {
            var removed = 0;
            List<(string Cmd, long EnqueuedTick, GameOutputLease Lease, GameOutputLease? Origin, Func<bool>? Guard, CommandTicket Ticket)>? kept = null;
            while (_commandQueue.Count > 0)
            {
                var item = _commandQueue.Dequeue();
                if (match(item.Cmd)) { item.Lease.Dispose(); removed++; continue; }
                kept ??= new();
                kept.Add(item);
            }
            if (kept != null)
                foreach (var k in kept) _commandQueue.Enqueue(k);
            return removed;
        }
    }

    /// <summary>队列中积压的命令条数（供诊断）</summary>
    public int PendingCount
    {
        get { lock (_queueLock) { return _commandQueue.Count; } }
    }

    // 命令最小间隔：给游戏处理聊天命令留出时间，避免同帧/紧邻命令互相覆盖（吞动作）
    // PLUG-7（FIX-J）：DateTime.Now 墙钟会因系统时间调整停摆/连发——改单调 TickCount64，
    // 判定抽到纯策略件（datalayertest 直测边界），间隔口径与旧实现完全一致
    private static readonly TimeSpan MinCommandInterval = TimeSpan.FromMilliseconds(200);
    private readonly CommandThrottlePolicy _throttle = new((long)MinCommandInterval.TotalMilliseconds);

    private void OnFrameworkUpdate(IFramework framework)
    {
        lock (_queueLock)
        {
            var nowMs = Environment.TickCount64;
            if (!_throttle.AllowNow(nowMs)) return;
            while (_commandQueue.Count > 0)
            {
                var item = _commandQueue.Dequeue();
                using (item.Lease)
                {
                    if (nowMs - item.EnqueuedTick > MaxQueueAgeMs)
                    {
                        Evidence.RecordDroppedExpired(item.Ticket, nowMs);
                        continue;
                    }
                    if (item.Origin?.IsCurrent == false || !GuardCurrent(item.Guard))
                    {
                        Evidence.RecordDroppedStaleOrigin(item.Ticket, nowMs);
                        continue;
                    }
                    var ran = item.Lease.TryRun(() =>
                    {
                        if (item.Origin?.IsCurrent == false || !GuardCurrent(item.Guard)) return false;
                        _throttle.OnExecuted(nowMs);
                        ExecuteNow(item.Cmd, item.Ticket);
                        return true;
                    });
                    if (!ran) Evidence.RecordDroppedStaleOrigin(item.Ticket, nowMs);
                }
                return;
            }
        }
    }

    private static bool GuardCurrent(Func<bool>? guard)
    {
        try { return guard == null || guard(); }
        catch { return false; }
    }

    private void ExecuteNow(string command, CommandTicket? ticket)
    {
        try
        {
            ExecuteNative(command);
            if (ticket != null) Evidence.RecordNativeSubmitted(ticket, Environment.TickCount64);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "ExecuteNow failed: {cmd}", ChatCommandPolicy.DescribeForLog(command));
            // 留吞并语义不变（遗留队列红线）；证据板让异常可观测，不重试不重发
            if (ticket != null) Evidence.RecordNativeFault(ticket, Environment.TickCount64, ex.Message);
        }
    }

    /// <summary>原生执行核（同步）：构造 Utf8String 并调用 ProcessChatBoxEntry，非托管块全路径
    /// try/finally 释放（正常/异常/调用失败都不漏）；原生异常原样上抛，由调用方定夺观测策略
    ///（遗留队列路径照旧吞并记日志，X1 同步路径上抛为可观测本地失败）。执行行为与内存清理
    /// 与提取前的单体内核逐字一致（2026-09-12 r3 提取，遗留行为冻结）。</summary>
    private unsafe void ExecuteNative(string command)
    {
        var framework = Framework.Instance();
        if (framework == null)
        {
            _log.Error("Framework.Instance() is null");
            return;
        }

        var uiModule = framework->GetUIModule();
        if (uiModule == null)
        {
            _log.Error("UIModule is null");
            return;
        }

        var uiModulePtr = (nint)uiModule;

        // Manually construct Utf8String (size = 0x68 = 104 bytes)
        var bytes = ChatCommandBuffer.ToUtf8WithNull(command);
        var len = bytes.Length - 1; // without null terminator

        // 长命令(UTF-8 字节 ≥ 内联容量，含中文)会越出内联缓冲导致堆损坏 -> 走堆路径
        var useHeap = ChatCommandBuffer.UsesHeap(command);
        var strBuf = nint.Zero;
        var mem = Marshal.AllocHGlobal(0x68);
        try
        {
            // Zero-fill
            for (int i = 0; i < 0x68; i++) ((byte*)mem)[i] = 0;

            var basePtr = (byte*)mem;
            var inlineBuffer = basePtr + 0x22;

            if (useHeap)
            {
                strBuf = Marshal.AllocHGlobal(bytes.Length);
                Marshal.Copy(bytes, 0, strBuf, bytes.Length);
                // StringPtr at 0x00 → heap buffer
                *(IntPtr*)(basePtr + 0x00) = strBuf;
                // BufSize at 0x08
                *(long*)(basePtr + 0x08) = bytes.Length;
                // BufUsed at 0x10 → len + 1
                *(long*)(basePtr + 0x10) = len + 1;
                // StringLength at 0x18 → len
                *(long*)(basePtr + 0x18) = len;
                // IsEmpty at 0x20 → false
                basePtr[0x20] = 0;
                // IsUsingInlineBuffer at 0x21 → false (heap)
                basePtr[0x21] = 0;
            }
            else
            {
                // StringPtr at 0x00 → point to inline buffer
                *(IntPtr*)(basePtr + 0x00) = (IntPtr)inlineBuffer;
                // BufSize at 0x08 → 0x40 (64)
                *(long*)(basePtr + 0x08) = 0x40;
                // BufUsed at 0x10 → len + 1
                *(long*)(basePtr + 0x10) = len + 1;
                // StringLength at 0x18 → len
                *(long*)(basePtr + 0x18) = len;
                // IsEmpty at 0x20 → false
                basePtr[0x20] = 0;
                // IsUsingInlineBuffer at 0x21 → true
                basePtr[0x21] = 1;
                // Copy string bytes
                Marshal.Copy(bytes, 0, (IntPtr)inlineBuffer, bytes.Length);
            }

            // Verify：一律从受管 bytes 解码。长命令走堆缓冲时内联区没写过数据，
            // 从 inlineBuffer 读 = 越界读（还可能读到未分配边界），曾经在此泄漏乱码
            var verifyStr = ChatCommandBuffer.FromUtf8WithNull(bytes);
            _log.Debug("Pre-call: cmd='{cmd}' len={len} heap={heap} uiModule=0x{ptr:X}",
                LogHead(command), len, useHeap, uiModulePtr);

            if (_processChatBoxEntry != null)
            {
                // Direct delegate call
                _processChatBoxEntry(uiModulePtr, mem, 0, 0);
                _log.Debug("Direct delegate call OK for: {cmd}", LogHead(command));
            }
            else
            {
                // Fallback: FFXIVClientStructs member function
                var utf8Str = (Utf8String*)mem;
                uiModule->ProcessChatBoxEntry(utf8Str, 0, false);
                _log.Debug("FFXIVClientStructs fallback call OK for: {cmd}", LogHead(command));
            }

            // Check if string was modified after call (indicates the function processed it)
            var postLen = *(long*)(basePtr + 0x18);
            var postUsed = *(long*)(basePtr + 0x10);
            _log.Debug("Post-call: StringLength={len} BufUsed={used} (pre: len={preLen} used={preUsed})",
                postLen, postUsed, len, len + 1);
        }
        finally
        {
            // 非托管块全路径释放：正常、异常、调用失败都不能漏（原先只在正常路径末尾释放，
            // 中间任何异常都会把 mem/strBuf 泄漏掉）
            Marshal.FreeHGlobal(mem);
            if (strBuf != nint.Zero) Marshal.FreeHGlobal(strBuf);
        }
    }

    public void Dispose()
    {
        _framework.Update -= OnFrameworkUpdate;
        Clear();
        OutputOwnership.Close();
    }
}
