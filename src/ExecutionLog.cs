// 这个文件是干嘛的：EXEC-CORE 执行日志（纯逻辑，无 Dalamud 依赖，进 datalayertest）。
// 设计文档 §3/§4：ExecutionLog 记「计划时刻、发送时刻、结果、原因」，且必须区分
// 「已发送」与「已确认状态变化」——当前版本只记发送侧（游戏服务器是否接受、动画何时可见
// 属于实机观测，等实机基线后在适配器里补确认通道）。定容环形缓冲，/shows/status 取尾部
// 渲染成中文可读文本。日志绝不含配对码等敏感信息。
using System;
using System.Collections.Generic;
using System.Text;

namespace ChoreoHelper;

public sealed class ExecutionLogEntry
{
    public string EventId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Command { get; set; } = "";
    /// <summary>计划发送时刻（演出时间轴毫秒）。</summary>
    public long PlannedMs { get; set; }
    /// <summary>实际发送时的演出时间轴毫秒（与计划之差 = 时间轴口径抖动）。</summary>
    public long DispatchedShowMs { get; set; }
    /// <summary>实际发送时的单调时钟毫秒（环境 TickCount64 口径，用于漂移观测）。</summary>
    public long DispatchedMonoMs { get; set; }
    public bool Ok { get; set; }
    public string Reason { get; set; } = "";
    public string TicketId { get; set; } = "";
    public AbilityExecutionResult? AbilityAttempt { get; set; }
    // minimal-reconstruction (no donor; used by MotionEvidenceBoard.ApplyToEntry).
    public string EvidenceState { get; set; } = "";
    public string EvidenceReason { get; set; } = "";
    public long EvidenceMonoMs { get; set; }
    /// <summary>跳过标记：true=按失败策略跳过（非故障）；false=成功或故障。</summary>
    public bool Skipped { get; set; }
    /// <summary>跳过失败类：ability-condition / facing-observation / movement-tolerance；非跳过为空。</summary>
    public string SkipClass { get; set; } = "";
    /// <summary>未知与不满足标记：含“未知”或“不满足”；非跳过为空。</summary>
    public string SkipMarking { get; set; } = "";
}

public sealed class ExecutionLog
{
    private readonly Queue<ExecutionLogEntry> _entries = new();
    private readonly int _capacity;

    public ExecutionLog(int capacity = 500) => _capacity = Math.Max(16, capacity);

    // restored (repo cur file has it; _merge adopt dropped it).
    /// <summary>证据回写：把板上票据的最新状态拷进带票据的条目（ShowRunner.Tick/停演清扫内
    /// 调用；条目只在锁内被读写）。无票据条目零改动。</summary>
    public void UpdateEvidence(MotionEvidenceBoard? board)
    {
        if (board == null) return;
        foreach (var e in _entries)
            if (e.TicketId.Length != 0) board.ApplyToEntry(e);
    }

    public int Count => _entries.Count;

    public void Add(ExecutionLogEntry entry)
    {
        if (entry == null) return;
        while (_entries.Count >= _capacity) _entries.Dequeue();
        _entries.Enqueue(entry);
    }

    /// <summary>尾部 n 条（最老→最新）。</summary>
    public List<ExecutionLogEntry> Tail(int n)
    {
        var all = new List<ExecutionLogEntry>(_entries);
        return all.Count <= n ? all : all.GetRange(all.Count - n, n);
    }

    /// <summary>日志只记命令摘要（同 GameCommandExecutor.LogHead 口径），不整条打超长文本。</summary>
    private static string Head(string command)
        => command.Length <= 40 ? command : command.Substring(0, 40) + "…";

    /// <summary>中文可读的尾部日志（/shows/status 直接回给网页展示）。</summary>
    public string RenderTail(int n)
    {
        var sb = new StringBuilder();
        foreach (var e in Tail(n))
        {
            sb.Append('[').Append(e.DispatchedShowMs).Append("ms] ").Append(e.EventId).Append('(')
              .Append(e.Kind).Append(')');
            if (!string.IsNullOrEmpty(e.Command)) sb.Append(' ').Append(Head(e.Command));
            sb.Append(e.Skipped ? " → 已跳过" : e.Ok ? " → 已发送" : " → 失败");
            if (!string.IsNullOrEmpty(e.Reason)) sb.Append("（").Append(e.Reason).Append('）');
            sb.Append('\n');
        }
        return sb.ToString();
    }
}
