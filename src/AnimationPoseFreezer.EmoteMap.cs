// AnimationPoseFreezer 的 Emote 表解析层分部（OVERHAUL 批 C 第三步按层拆出）：
// 命令 → 表情行/时间轴聚合与解析（AggEmote/EnsureEmoteMap/TryResolveEmote）、运行时
// 变体行合并（TryMergeVariantRow）与循环时间轴判定（IsLoopTimeline，缓存字段按静态
// 初始化顺序约束留主件）。自 AnimationPoseFreezer.cs 文件级搬入，同类型 partial 合并，行为逐字不变。
using System;
using System.Collections.Concurrent;
using Lumina.Excel.Sheets;

namespace ChoreoHelper;

public unsafe sealed partial class AnimationPoseFreezer
{
    private sealed class AggEmote
    {
        public readonly List<ushort> Rows = new();
        public readonly List<ushort> Tls = new();
        public bool Loop;
        public int FacialRows;              // 表情分类的行数（按行统计，不按命令）
        public int BodyRows;                // 有身体动画的行数
        public bool Facial => FacialRows > 0 && BodyRows == 0; // 纯表情命令（全部行都是表情分类）
        // v0.5.19：曾按"族内任一行是表情分类"判定 —— /wave 族里有一行表情变体，
        // 整个命令被当纯表情走免钉定流程（"挥手中断"根源之一）。改为全行判定。
    }

    // ---- 命令 → 表情行ID + 全部时间轴行ID（首次使用时从 Emote 表构建，站立变体=同命令最小行号）----
    private void EnsureEmoteMap()
    {
        if (PoseSignatureAccess.EmoteMap != null) return;
        var map = new ConcurrentDictionary<string, EmoteIds>();
        try
        {
            var sheet = _dataManager.GetExcelSheet<Emote>();
            if (sheet == null) { _log.Warning("Emote sheet is null"); }
            else
            {
                var rows = 0; var withCmd = 0;
                // 聚合同 TextCommand 的全部表情行：行号族（游戏实际执行任意变体行）+ 时间轴并集
                // （变体行的 ActionTimeline 含各变体实际时间轴 —— 只取最小行会漏掉如 breakdance
                // 的 7406/7407，导致表内验证永不通过、EmoteId 确认也对不上变体行号）
                // 可变类（不用元组：值类型局部副本会把先设置的 Facial 覆盖回去）
                var agg = new Dictionary<string, AggEmote>();
                foreach (var e in sheet)
                {
                    rows++;
                    try
                    {
                        if (!e.TextCommand.IsValid) continue;
                        var cmd = e.TextCommand.Value.Command.ToString();
                        if (string.IsNullOrEmpty(cmd)) continue;
                        withCmd++;
                        if (!agg.TryGetValue(cmd, out var g))
                        {
                            g = new AggEmote();
                            agg[cmd] = g;
                        }
                        if (!g.Rows.Contains((ushort)e.RowId)) g.Rows.Add((ushort)e.RowId);
                        // 表情分类按行统计：动画在面部骨架、不绑主槽0 —— 定格流程对其无效且有害
                        try
                        {
                            if (e.EmoteCategory.IsValid && e.EmoteCategory.Value.Name.ToString() == "\u8868\u60C5")
                                g.FacialRows++;
                            else
                                g.BodyRows++;
                        }
                        catch { g.BodyRows++; }
                        // ActionTimeline 只有 6 列（0-5），索引 6+ 会越界抛异常
                        for (var i = 0; i < 6; i++)
                        {
                            var tl = e.ActionTimeline[i];
                            if (!tl.IsValid) continue;
                            var key = tl.Value.Key.ToString();
                            if (string.IsNullOrEmpty(key)) continue;
                            var id = (ushort)tl.RowId;
                            if (!g.Tls.Contains(id)) g.Tls.Add(id);
                            if (tl.Value.IsLoop) g.Loop = true;
                        }
                    }
                    catch { }
                }
                foreach (var kv in agg)
                    map[kv.Key] = new EmoteIds(kv.Value.Rows[0], kv.Value.Tls.ToArray(), kv.Value.Loop, kv.Value.Rows.ToArray(), kv.Value.Facial);
                var facialCmds = 0; foreach (var kv in agg) if (kv.Value.Facial) facialCmds++;
                _log.Information("Emote sheet scan: rows={rows} withCmd={withCmd} cmds={cmds} facial={facialCmds}", rows, withCmd, agg.Count, facialCmds);
            }
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Build emote map failed");
        }
        PoseSignatureAccess.EmoteMap = map;
        // 表内归属反向索引（跨命令学习污染防护）
        var owners = new System.Collections.Concurrent.ConcurrentDictionary<ushort, HashSet<string>>();
        foreach (var kv in map)
            foreach (var tl in kv.Value.Timelines)
            {
                var set = owners.GetOrAdd(tl, _ => new HashSet<string>());
                lock (set) set.Add(kv.Key);
            }
        PoseSignatureAccess.TimelineOwners = owners;
        // v0.5.19：不再预填待机集合 —— 播放器上可能 linger 着上一轮 motion 的循环动画
        // （无 EmoteId、Mode=Normal、表外），预填会把它学成"待机"，从此该动作的挂载/学习
        // 全部被待机排除拒绝（/breakdance 的 3124 实测）。真待机由 ObserveIdleTimeline 的
        // "两个不同表情结束后回到同一 id"一致性规则收集（见该方法）。
        _log.Information("Emote map built: {n} commands", map.Count);
    }

    private bool TryResolveEmote(string command, out EmoteIds ids)
    {
        EnsureEmoteMap();
        return PoseSignatureAccess.TryResolve(command, out ids);
    }

    /// <summary>
    /// id 是否为循环时间轴（ActionTimeline 表 IsLoop，带缓存）。打断器只对真循环开火 ——
    /// 表外普通动画（走路/姿态变体）会自己结束，打断它们只会制造无谓的 bow。
    /// （TryPinTimeline/Unpin 钉住原语已迁至 PoseApplicator。）
    /// </summary>
    private bool IsLoopTimeline(ushort id)
    {
        if (id == 0 || id == 3) return false;
        if (_loopTimelineCache.TryGetValue(id, out var v)) return v;
        var r = false;
        try
        {
            var sheet = _dataManager.GetExcelSheet<ActionTimeline>();
            var row = sheet.GetRow(id);
            r = row.RowId != 0 && row.IsLoop;
        }
        catch { }
        _loopTimelineCache[id] = r;
        return r;
    }

    /// <summary>
    /// 合并游戏实际解析出的变体行（v0.5.24）。rowIdOrTimeline 传表情行号时直接合并该行；
    /// 传时间轴 id 时反查 Emote 表找到属主行（motion 通道不设 EmoteId，只能反查）。
    /// 合并 = 该行全部时间轴并入等待集合 + 规范 id 改为该行 [0] + 族匹配把该行算进来。
    /// </summary>
    private bool TryMergeVariantRow(ushort rowIdOrTimeline)
    {
        if (_pendingCommand == null) return false;
        try
        {
            var sheet = _dataManager.GetExcelSheet<Emote>();
            uint rowId = rowIdOrTimeline;
            if (Array.IndexOf(_awaitTimelineIds, rowIdOrTimeline) >= 0 || PoseSignatureAccess.OwnerKnown(rowIdOrTimeline))
            {
                // 是时间轴 id 而非行号 —— 反查属主行（跳过命令自己的行/族，那些已在集合里）
                rowId = 0;
                foreach (var refRow in sheet)
                {
                    if (refRow.RowId == _awaitEmoteId || Array.IndexOf(_awaitEmoteFamily, (ushort)refRow.RowId) >= 0) continue;
                    for (var i = 0; i < 6; i++)
                    {
                        try
                        {
                            var t = refRow.ActionTimeline[i];
                            if (t.IsValid && t.RowId == rowIdOrTimeline) { rowId = refRow.RowId; break; }
                        }
                        catch { }
                    }
                    if (rowId != 0) break;
                }
                if (rowId == 0) return false;
            }
            var row = sheet.GetRow(rowId);
            // v0.5.25：拥有自己 TextCommand 的行是"别的命令的行"（如霹雳舞行 107=/breakdance），
            // 不是种族/性别变体行 —— 真变体行没有自己的文字命令（如 pose04 行 108）。
            // 迟到的排队命令落地时（循环舞残留期拖到新命令，旧命令数秒后才生效），
            // 把别人的命令行并进来会把规范 id 毒化成别人的动画 → 真动画上槽反被
            // canonWait 挡住 = "方形舞/练拳被吞"的根源。有命令的行一律拒绝。
            try
            {
                if (row.TextCommand.IsValid && row.TextCommand.Value.Command.ToString() is { Length: > 0 } ownCmd)
                {
                    if (_lastMergeRejectKey != rowId)
                    {
                        _lastMergeRejectKey = rowId;
                        PoseSignatureAccess.Diag($"merge rejected: row {rowId} has own command '{ownCmd}' (stale queued emote?)");
                    }
                    return false;
                }
            }
            catch { }
            var list = new List<ushort>();
            for (var i = 0; i < 6; i++)
            {
                try { var t = row.ActionTimeline[i]; if (t.IsValid) list.Add((ushort)t.RowId); } catch { }
            }
            if (list.Count == 0) return false;
            // v0.5.25：行的动画已被其他命令学过 = 那个命令的变体行（如霹雳舞的行 107，
            // 3181 早已学给 /breakdance）。迟到的排队旧命令落地时若把它并给当前命令，
            // 规范 id 会被毒化成别人的动画 → 真动画上槽反被 canonWait 挡住（"被吞"）。
            foreach (var lk in PoseSignatureAccess.LearnedTimelines)
            {
                if (lk.Key == _pendingCommand) continue;
                lock (lk.Value)
                {
                    foreach (var t in list)
                        if (lk.Value.Contains(t))
                        {
                            if (_lastMergeRejectKey != rowId)
                            {
                                _lastMergeRejectKey = rowId;
                                PoseSignatureAccess.Diag($"merge rejected: row {rowId} tl {t} already learned for {lk.Key} (stale queued emote?)");
                            }
                            return false;
                        }
                }
            }
            _observedRowMerged = true;
            _observedRowAt = Now();
            PoseSignatureAccess.ResolvedEmoteRow[_pendingCommand] = (ushort)rowId;
            var merged = new List<ushort>(_awaitTimelineIds);
            foreach (var t in list) if (!merged.Contains(t)) merged.Add(t);
            _awaitTimelineIds = merged.ToArray();
            PoseSignatureAccess.CommandTimelineSets[_pendingCommand] = _awaitTimelineIds;
            _canonicalTimeline = list[0];
            if (_canonicalTimeline != 0)
            {
                PoseSignatureAccess.CanonicalTimelines[_pendingCommand] = _canonicalTimeline;
                if (PoseSignatureAccess.LearnedTimelines.TryGetValue(_pendingCommand, out var polluted))
                    lock (polluted)
                        polluted.RemoveAll(id => id != _canonicalTimeline && Array.IndexOf(_awaitTimelineIds, id) >= 0);
            }
            PoseSignatureAccess.Diag($"merged variant row {rowId} (src={rowIdOrTimeline}): canon={_canonicalTimeline} set=[{string.Join(",", _awaitTimelineIds)}]");
            return true;
        }
        catch { return false; }
    }
}
