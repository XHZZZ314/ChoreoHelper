// 这个文件是干嘛的：动作执行证据链 P1 的纯证据板（无 Dalamud 依赖，进 datalayertest）。
// 每条经追踪通道派发的命令持一张票据，沿 计划 → 入队接受/拒绝 → 实际原生提交 → 匹配状态
// 变化 → 结束/超时/取消 记录：七条静默丢弃路径与原生异常各得一个终态。关联遵循技能链同款
// 严格纪律：预期表情 id（同 TextCommand 的变体行族）+ 派发前基线（EmoteId+槽0时间轴 id）
// + 固定观察窗（1500ms 常量）+ 终态恰一次 + 跨场票据不收养（旧表情的结束绝不认作本次确认）。
// 本板只记录：绝不改变 Ok/Faulted/跳过语义，也绝不调用任何执行/提交表面（无重发）。
using System;
using System.Collections.Generic;
using System.Text;

namespace ChoreoHelper;

public enum MotionEvidenceState
{
    None,              // 已开票尚未入队判定
    Queued,            // 已入队
    QueueRejected,     // 入队被拒（空命令/策略/租约/独占）
    DroppedOldest,     // 队列淘汰（被满队列挤出的受害者）
    DroppedExpired,    // 过期丢弃（出队时超过 5s）
    DroppedStaleOrigin,// 租约失效丢弃（出队时来源失效）
    NativeSubmitted,   // 已原生提交（不证明游戏接受）
    NativeFault,       // 原生提交异常
    Confirmed,         // 已确认（窗口内匹配到预期状态变化）
    NoEvidence,        // 超时未确认
    Mismatch,          // 证据不符（窗口内起了别的动作）
    CancelledByStop,   // 停演取消
    MappingUnknown,    // 无法映射预期（观察跳过，非失败）
    Superseded,        // 证据记录淘汰（容量上限挤出）
}

/// <summary>状态 id（JSON/日志用小写串）与主人可读中文渲染。</summary>
public static class MotionEvidenceText
{
    public static string Id(MotionEvidenceState s) => s switch
    {
        MotionEvidenceState.Queued => "queued",
        MotionEvidenceState.QueueRejected => "queue-rejected",
        MotionEvidenceState.DroppedOldest => "dropped-oldest",
        MotionEvidenceState.DroppedExpired => "dropped-expired",
        MotionEvidenceState.DroppedStaleOrigin => "dropped-stale-origin",
        MotionEvidenceState.NativeSubmitted => "native-submitted",
        MotionEvidenceState.NativeFault => "native-fault",
        MotionEvidenceState.Confirmed => "confirmed",
        MotionEvidenceState.NoEvidence => "no-evidence",
        MotionEvidenceState.Mismatch => "mismatch",
        MotionEvidenceState.CancelledByStop => "cancelled-by-stop",
        MotionEvidenceState.MappingUnknown => "mapping-unknown",
        MotionEvidenceState.Superseded => "superseded",
        _ => "",
    };

    /// <summary>设计契约 §2 的主人可读渲染；QueueRejected/Confirmed 带原因/Δ 毫秒。</summary>
    public static string Render(MotionEvidenceState s, string detail)
    {
        switch (s)
        {
            case MotionEvidenceState.Queued: return "已入队";
            case MotionEvidenceState.QueueRejected: return string.IsNullOrEmpty(detail) ? "入队被拒" : "入队被拒（" + detail + "）";
            case MotionEvidenceState.DroppedOldest: return "队列淘汰";
            case MotionEvidenceState.DroppedExpired: return "过期丢弃";
            case MotionEvidenceState.DroppedStaleOrigin: return "租约失效丢弃";
            case MotionEvidenceState.NativeSubmitted: return "已原生提交";
            case MotionEvidenceState.NativeFault: return string.IsNullOrEmpty(detail) ? "原生提交异常" : "原生提交异常（" + detail + "）";
            case MotionEvidenceState.Confirmed: return "已确认（+" + detail + "ms）";
            case MotionEvidenceState.NoEvidence: return "超时未确认";
            case MotionEvidenceState.Mismatch: return "证据不符";
            case MotionEvidenceState.CancelledByStop: return "停演取消";
            case MotionEvidenceState.MappingUnknown: return string.IsNullOrEmpty(detail) ? "无法映射预期" : "无法映射预期（" + detail + "）";
            case MotionEvidenceState.Superseded: return "证据记录淘汰";
            default: return "";
        }
    }

    /// <summary>终态集合：一旦进入绝不再变迁（第二次收养被拒绝）。</summary>
    public static bool IsTerminal(MotionEvidenceState s)
        => s != MotionEvidenceState.None && s != MotionEvidenceState.Queued && s != MotionEvidenceState.NativeSubmitted;
}

/// <summary>命令票据：执行器开票，板内逐态演进；预期/基线由派发侧在开票后补挂。</summary>
public sealed class CommandTicket
{
    public string Id { get; internal set; } = "";
    public string EventId { get; internal set; } = "";
    public long Generation { get; internal set; }
    public MotionEvidenceState State { get; internal set; } = MotionEvidenceState.None;
    /// <summary>当前状态的中文渲染（主人可读）。</summary>
    public string ReasonZh { get; internal set; } = "";
    /// <summary>当前状态变迁时刻（单调毫秒）。</summary>
    public long StateAtMs { get; internal set; }
    /// <summary>原生提交时刻（确认 Δ 与观察窗起点）；未提交为 null。</summary>
    public long? SubmittedAtMs { get; internal set; }
    /// <summary>预期表情行族（同 TextCommand 的全部变体行）；空=无法映射。</summary>
    internal int[]? ExpectedEmoteIds;
    internal long? BaselineEmoteId;
    internal long? BaselineTimelineId;
    public bool Queued => State == MotionEvidenceState.Queued;
}

/// <summary>纯证据板：票据台账 + 严格关联器（假时钟可测，无任何游戏/执行调用）。</summary>
public sealed class MotionEvidenceBoard
{
    /// <summary>固定观察窗（设计契约 §3.2：P1 代码常量，不做配置面）。</summary>
    public const long ObservationWindowMs = 1500;
    /// <summary>容量 ≥ 命令队列上限 64；超限按最旧挤出（非终态先记 superseded）。</summary>
    public const int DefaultCapacity = 256;

    private readonly object _gate;
    private readonly int _capacity;
    private readonly LinkedList<CommandTicket> _order = new();
    private readonly Dictionary<string, CommandTicket> _byId = new();
    private long _generation;
    private long _ticketSeq;

    public MotionEvidenceBoard(object? synchronizationGate = null, int capacity = DefaultCapacity)
    {
        _gate = synchronizationGate ?? new object();
        _capacity = Math.Max(1, capacity);
    }

    /// <summary>场次边界：世代号 +1，之后的观察/超时只作用于新世代的票据（跨场不收养）。</summary>
    public long BeginShow()
    {
        lock (_gate) { return ++_generation; }
    }

    /// <summary>开票（状态 None）。执行器随后立即记 queued 或 queue-rejected。</summary>
    public CommandTicket OpenTicket()
    {
        lock (_gate)
        {
            if (_order.Count >= _capacity)
            {
                var oldest = _order.First!.Value;
                _order.RemoveFirst();
                _byId.Remove(oldest.Id);
                if (!MotionEvidenceText.IsTerminal(oldest.State))
                    FinishLocked(oldest, MotionEvidenceState.Superseded, "", oldest.StateAtMs);
            }
            var ticket = new CommandTicket
            {
                Id = "g" + _generation + "t" + (++_ticketSeq),
                Generation = _generation,
            };
            _order.AddLast(ticket);
            _byId[ticket.Id] = ticket;
            return ticket;
        }
    }

    /// <summary>派发侧补挂观察参数（事件 id、预期表情行族、派发前基线）；终态票据拒收。</summary>
    public void PrepareObservation(CommandTicket ticket, string eventId, int[]? expectedEmoteIds,
        long? baselineEmoteId, long? baselineTimelineId)
    {
        if (ticket == null) return;
        lock (_gate)
        {
            if (!ReferenceEquals(_byId.GetValueOrDefault(ticket.Id), ticket)) return;
            if (MotionEvidenceText.IsTerminal(ticket.State)) return;
            ticket.EventId = eventId ?? "";
            ticket.ExpectedEmoteIds = expectedEmoteIds is { Length: > 0 } ? expectedEmoteIds : null;
            ticket.BaselineEmoteId = baselineEmoteId;
            ticket.BaselineTimelineId = baselineTimelineId;
        }
    }

    public void RecordQueued(CommandTicket ticket, long atMs)
    {
        lock (_gate) { if (CanTransitionLocked(ticket, MotionEvidenceState.None)) FinishLocked(ticket, MotionEvidenceState.Queued, "", atMs); }
    }

    /// <summary>入队被拒。reasonClass：empty/policy/stale-origin/exclusive-owner（板内译中文）。</summary>
    public void RecordQueueRejected(CommandTicket ticket, string reasonClass, long atMs)
    {
        var detail = reasonClass switch
        {
            "empty" => "空命令",
            "policy" => "安全策略拒绝",
            "stale-origin" => "来源租约失效",
            "exclusive-owner" => "独占试验持有输出",
            _ => reasonClass ?? "",
        };
        lock (_gate)
        {
            if (CanTransitionLocked(ticket, MotionEvidenceState.None))
                FinishLocked(ticket, MotionEvidenceState.QueueRejected, detail, atMs);
        }
    }

    public void RecordDroppedOldest(CommandTicket ticket, long atMs)
    {
        lock (_gate) { if (CanTransitionLocked(ticket, MotionEvidenceState.Queued)) FinishLocked(ticket, MotionEvidenceState.DroppedOldest, "", atMs); }
    }

    public void RecordDroppedExpired(CommandTicket ticket, long atMs)
    {
        lock (_gate) { if (CanTransitionLocked(ticket, MotionEvidenceState.Queued)) FinishLocked(ticket, MotionEvidenceState.DroppedExpired, "", atMs); }
    }

    public void RecordDroppedStaleOrigin(CommandTicket ticket, long atMs)
    {
        lock (_gate) { if (CanTransitionLocked(ticket, MotionEvidenceState.Queued)) FinishLocked(ticket, MotionEvidenceState.DroppedStaleOrigin, "", atMs); }
    }

    public void RecordNativeFault(CommandTicket ticket, long atMs, string? detail = null)
    {
        lock (_gate)
        {
            if (CanTransitionLocked(ticket, MotionEvidenceState.Queued))
                FinishLocked(ticket, MotionEvidenceState.NativeFault, detail ?? "", atMs);
        }
    }

    /// <summary>原生提交返回：观察参数齐备 → native-submitted（观察窗起算）；否则 mapping-unknown
    /// （预期不可映射/基线不可采，观察跳过，绝非失败）。</summary>
    public void RecordNativeSubmitted(CommandTicket ticket, long atMs)
    {
        lock (_gate)
        {
            if (!CanTransitionLocked(ticket, MotionEvidenceState.Queued)) return;
            if (ticket.ExpectedEmoteIds == null || ticket.BaselineEmoteId == null || ticket.BaselineTimelineId == null)
            {
                var detail = ticket.ExpectedEmoteIds == null ? "无法映射预期表情" : "无法采集表情基线";
                FinishLocked(ticket, MotionEvidenceState.MappingUnknown, detail, atMs);
                return;
            }
            ticket.SubmittedAtMs = atMs;
            FinishLocked(ticket, MotionEvidenceState.NativeSubmitted, "", atMs);
        }
    }

    /// <summary>是否有需要喂观察的票据（适配器可据此跳过游戏读数）。</summary>
    public bool ObservationActive
    {
        get
        {
            lock (_gate)
            {
                foreach (var t in _order)
                    if (t.Generation == _generation && t.State == MotionEvidenceState.NativeSubmitted) return true;
                return false;
            }
        }
    }

    /// <summary>框架线程观察（EmoteId + 槽0时间轴 id）。提交前忽略；仍等于基线忽略；命中预期
    /// 行族=确认；槽0换了别的时间轴=别的动作（终态 mismatch）；仅 EmoteId 瞬时漂移忽略
    /// （基线→其他→预期仍可确认本次）。返回本次采纳的变迁数。</summary>
    public int Observe(long atMs, long emoteId, long timelineId)
    {
        var adopted = 0;
        lock (_gate)
        {
            foreach (var t in _order)
            {
                if (t.Generation != _generation || t.State != MotionEvidenceState.NativeSubmitted
                    || t.SubmittedAtMs is not long submit) continue;
                if (atMs < submit || atMs > submit + ObservationWindowMs) continue; // 提交前/过窗不收养
                if (emoteId == t.BaselineEmoteId && timelineId == t.BaselineTimelineId) continue; // 旧表情仍在播
                if (Array.IndexOf(t.ExpectedEmoteIds!, (int)emoteId) >= 0)
                {
                    FinishLocked(t, MotionEvidenceState.Confirmed, (atMs - submit).ToString(), atMs);
                    adopted++;
                    continue;
                }
                if (timelineId != 0 && timelineId != t.BaselineTimelineId)
                {
                    FinishLocked(t, MotionEvidenceState.Mismatch, "", atMs);
                    adopted++;
                }
                // 其余：EmoteId 瞬时值或槽0空闲（旧表情结束）——不认作本次证据，继续等窗口
            }
        }
        return adopted;
    }

    /// <summary>观察窗到期：仍未匹配 → no-evidence（终态）。返回本次到期数。</summary>
    public int ExpireWindows(long nowMs)
    {
        var expired = 0;
        lock (_gate)
        {
            foreach (var t in _order)
            {
                if (t.Generation != _generation || t.State != MotionEvidenceState.NativeSubmitted
                    || t.SubmittedAtMs is not long submit || nowMs <= submit + ObservationWindowMs) continue;
                FinishLocked(t, MotionEvidenceState.NoEvidence, "", nowMs);
                expired++;
            }
        }
        return expired;
    }

    /// <summary>停演/卸载：所有未终态票据 → cancelled-by-stop，恰一次；重复调用零新增。</summary>
    public int MarkStopped(long atMs)
    {
        var cancelled = 0;
        lock (_gate)
        {
            foreach (var t in _order)
            {
                if (MotionEvidenceText.IsTerminal(t.State)) continue;
                FinishLocked(t, MotionEvidenceState.CancelledByStop, "", atMs);
                cancelled++;
            }
        }
        return cancelled;
    }

    /// <summary>把票据当前证据回写进执行日志条目（仅带票据条目；板外/已淘汰返回 false）。</summary>
    public bool ApplyToEntry(ExecutionLogEntry entry)
    {
        if (entry == null || entry.TicketId.Length == 0) return false;
        lock (_gate)
        {
            var t = _byId.GetValueOrDefault(entry.TicketId);
            if (t == null) return false;
            var state = MotionEvidenceText.Id(t.State);
            if (entry.EvidenceState == state && entry.EvidenceReason == t.ReasonZh && entry.EvidenceMonoMs == t.StateAtMs)
                return false;
            entry.EvidenceState = state;
            entry.EvidenceReason = t.ReasonZh;
            entry.EvidenceMonoMs = t.StateAtMs;
            return true;
        }
    }

    private bool CanTransitionLocked(CommandTicket ticket, MotionEvidenceState requiredFrom)
        => ticket != null && ReferenceEquals(_byId.GetValueOrDefault(ticket.Id), ticket)
            && ticket.State == requiredFrom;

    private static void FinishLocked(CommandTicket ticket, MotionEvidenceState state, string detail, long atMs)
    {
        ticket.State = state;
        ticket.ReasonZh = MotionEvidenceText.Render(state, detail);
        ticket.StateAtMs = atMs;
    }

    /// <summary>诊断只读视图（测试/日志摘要）。</summary>
    public int Count { get { lock (_gate) return _order.Count; } }
    public long Generation { get { lock (_gate) return _generation; } }
}
