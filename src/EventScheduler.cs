// 这个文件是干嘛的：EXEC-CORE 事件调度器（纯逻辑，无 Dalamud 依赖，进 datalayertest）。
// 装载时把演出包事件预编译成一条按 startMs 排序、同刻按优先级排序的队列 + 只前进的游标
// （与 ENGINE-CURSOR 的「游标=第一条未触发事件」不变式同源）。执行期 ShowRunner 每帧用
// 统一单调时钟调 CollectDue：所有「showStart + startMs 已到」的事件按固定优先级顺序出队，
// 每条只出一次。绝不用 Task.Delay 链（设计文档 §4：所有事件=开演时刻+startMs，帧率无关）。
// 优先级（设计文档 §4 建议）：朝向准备 > 移动状态 > 技能 > 动作 > 提示/歌词；
// 紧急停摆不归调度器——ShowRunner 直接封游标。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class EventScheduler
{
    private readonly List<ShowEvent> _ordered = new();
    private int _cursor;

    /// <summary>发送提前量（毫秒）：补偿命令队列+游戏动画启动延迟。0 = 到点即发；
    /// 未来按实测校准（设计文档 §10：目标值等实机基线后再定，不拍脑袋）。</summary>
    public int DispatchLeadMs { get; }

    public EventScheduler(IEnumerable<ShowEvent> events, int dispatchLeadMs = 0)
    {
        DispatchLeadMs = Math.Max(0, dispatchLeadMs);
        if (events != null) _ordered.AddRange(events);
        // 同一 startMs 内优先级小者先发；再按传入顺序稳定排（数组序不是身份，只是确定性口径）
        var indexMap = new Dictionary<ShowEvent, int>(_ordered.Count);
        for (int i = 0; i < _ordered.Count; i++) indexMap[_ordered[i]] = i;
        _ordered.Sort((a, b) =>
        {
            int c = a.StartMs.CompareTo(b.StartMs);
            if (c != 0) return c;
            c = PriorityOf(a.Kind).CompareTo(PriorityOf(b.Kind));
            return c != 0 ? c : indexMap[a].CompareTo(indexMap[b]);
        });
        Reset();
    }

    /// <summary>同刻事件发送顺序。数值小者先发。</summary>
    public static int PriorityOf(string kind) => kind switch
    {
        "facing" => 0,
        "movement" => 1,
        "ability" => 2,
        "motion" => 3,
        "cue" => 4,
        "lyrics" => 5,
        _ => 9,
    };

    /// <summary>游标归零（重新开演/重演同一包时用）。</summary>
    public void Reset() => _cursor = 0;

    /// <summary>还没发送的事件数。</summary>
    public int Remaining => _ordered.Count - _cursor;

    /// <summary>下一条待发事件的应发时刻（startMs - 提前量）；队列空返回 null。</summary>
    public long? NextDueMs => _cursor < _ordered.Count ? _ordered[_cursor].StartMs - DispatchLeadMs : null;

    /// <summary>把 showTimeMs 时刻已到点的事件按固定顺序追加进 into，并推进游标。
    /// 每条事件只会被收集一次（游标只前进）。调用方对收集到的事件自行分发并记账。</summary>
    public void CollectDue(long showTimeMs, List<ShowEvent> into)
    {
        while (_cursor < _ordered.Count && _ordered[_cursor].StartMs - DispatchLeadMs <= showTimeMs)
        {
            into.Add(_ordered[_cursor]);
            _cursor++;
        }
    }
}
