// 这个文件是干嘛的：动作执行证据链 P1 离线回归（TASK-20260916-EXEC-EVIDENCE-P1-MOTION）。
// 全纯：假队列/假时钟直测证据板与关联器——[q-*] 七条静默丢弃路径 + 原生异常各得终态；
// [corr-*] 严格关联矩阵（基线/预期/窗口/终态恰一次/跨场不收养）；[render-*] 无票据渲染逐字
// 节不变 + 中文证据注释；[policy-*] 只记录（被拒/未确认绝不停演、Ok 不变）；[stop-*] 停演
// 取消恰一次 + 重演不撞号。GameCommandExecutor/GameShowDispatcher 为 Dalamud 绑定不进本套，
// 其调用序列由 FakeTrackedQueue 契约镜像（file:line 注释对应）。
using ChoreoHelper;

internal static class MotionEvidenceCases
{
    public static int RunNamed(bool red)
    {
        var fails = 0;
        void Check(string name, bool cond, string? detail = null)
        {
            if (cond) { if (!red) Console.WriteLine($"  OK  {name}"); }
            else { fails++; Console.WriteLine($"  FAIL {name} {detail}"); }
        }
        Console.WriteLine($"== 动作执行证据（motion-evidence{(red ? " --red" : "")}） ==");
        QueueCases(Check);
        CorrelatorCases(Check);
        RenderCases(Check);
        PolicyCases(Check);
        StopCases(Check);
        Console.WriteLine($"结果：motion-evidence {fails} 项失败");
        return fails == 0 ? 0 : 1;
    }

    // ---- [q-*] 队列侧：七条静默丢弃路径 + 原生异常 + 恰一次终态 + 有界 ----
    private static void QueueCases(CheckFn check)
    {
        // FakeTrackedQueue：GameCommandExecutor 追踪通道的契约镜像（判定顺序 ↔ 新代码）
        CommandTicket EnqueueFake(MotionEvidenceBoard board, Queue<(string Cmd, long At, CommandTicket T)> q,
            string cmd, long now, string? rejectClass = null)
        {
            var t = board.OpenTicket();                       // ↔ ExecuteCommandTracked 开票
            if (string.IsNullOrWhiteSpace(cmd)) { board.RecordQueueRejected(t, "empty", now); return t; }   // ↔ :94 静默 return
            if (rejectClass != null) { board.RecordQueueRejected(t, rejectClass, now); return t; }           // ↔ 策略/租约/独占三类拒绝
            if (q.Count >= 64) { var victim = q.Dequeue(); board.RecordDroppedOldest(victim.T, now); }       // ↔ MaxQueueSize=64 丢最旧
            q.Enqueue((cmd, now, t));
            board.RecordQueued(t, now);
            return t;
        }

        foreach (var (cls, zh) in new[] { ("empty", "空命令"), ("policy", "安全策略拒绝"),
            ("stale-origin", "来源租约失效"), ("exclusive-owner", "独占试验持有输出") })
        {
            var board = new MotionEvidenceBoard();
            var q = new Queue<(string, long, CommandTicket)>();
            var cmd = cls == "empty" ? "   " : "/bow motion";
            var t = EnqueueFake(board, q, cmd, 1000, cls == "empty" ? "empty" : cls);
            check($"[q-reject:{cls}] 终态 queue-rejected 且不入队",
                t.State == MotionEvidenceState.QueueRejected && q.Count == 0
                && MotionEvidenceText.Id(t.State) == "queue-rejected", t.State.ToString());
            check($"[q-reject:{cls}] 中文原因含「{zh}」", t.ReasonZh.Contains(zh), t.ReasonZh);
            board.RecordQueued(t, 1100);
            check($"[q-reject:{cls}] 终态后拒绝再入队记录（恰一次）", t.State == MotionEvidenceState.QueueRejected);
        }

        {
            var board = new MotionEvidenceBoard();
            var q = new Queue<(string, long, CommandTicket)>();
            CommandTicket victim = null!;
            for (var i = 0; i < 64; i++)
            {
                var t = EnqueueFake(board, q, "/dance" + i + " motion", 1000);
                if (i == 0) victim = t;                    // 被挤出的是最旧（首条）
            }
            var survivor = EnqueueFake(board, q, "/wave motion", 1100);
            check("[q-dropped-oldest] 满队列挤出最旧：受害者终态 dropped-oldest",
                victim.State == MotionEvidenceState.DroppedOldest && MotionEvidenceText.Id(victim.State) == "dropped-oldest");
            check("[q-dropped-oldest] 受害者中文渲染 队列淘汰", victim.ReasonZh == "队列淘汰", victim.ReasonZh);
            check("[q-dropped-oldest] 新命令正常入队且队列有界", survivor.Queued && q.Count == 64);
        }
        {
            var board = new MotionEvidenceBoard();
            var t = EnqueueFake(board, new(), "/bow motion", 1000, null);
            board.RecordDroppedExpired(t, 6001);             // ↔ 出队时 now-enqueued > 5000
            check("[q-dropped-expired] 超 5s 出队丢弃终态", t.State == MotionEvidenceState.DroppedExpired
                && t.ReasonZh == "过期丢弃", t.ReasonZh);
        }
        {
            var board = new MotionEvidenceBoard();
            var t = EnqueueFake(board, new(), "/bow motion", 1000, null);
            board.RecordDroppedStaleOrigin(t, 1200);         // ↔ 出队时 Origin 失效/守卫失败
            check("[q-dropped-stale-origin] 出队租约失效终态", t.State == MotionEvidenceState.DroppedStaleOrigin
                && t.ReasonZh == "租约失效丢弃", t.ReasonZh);
        }
        {
            var board = new MotionEvidenceBoard();
            var t = EnqueueFake(board, new(), "/bow motion", 1000, null);
            board.RecordNativeFault(t, 1300, "访问受保护内存");
            check("[q-native-fault] 原生异常可观测终态（不重试）", t.State == MotionEvidenceState.NativeFault
                && t.ReasonZh.Contains("原生提交异常") && t.ReasonZh.Contains("访问受保护内存"), t.ReasonZh);
            board.RecordNativeSubmitted(t, 1400);
            check("[q-native-fault] 终态后拒绝提交记录（恰一次）", t.State == MotionEvidenceState.NativeFault);
        }
        {
            var board = new MotionEvidenceBoard(capacity: 8);
            CommandTicket? first = null;
            for (var i = 0; i < 9; i++)
            {
                var t = board.OpenTicket();
                first ??= t;
                if (i > 0) board.RecordQueued(t, 1000 + i); // 首票留 None 也必须可被挤出结算
            }
            check("[q-bounded] 容量上限挤出最旧且非终态先记 superseded",
                board.Count == 8 && first!.State == MotionEvidenceState.Superseded, first!.State.ToString());
            check("[q-bounded] 板容量 ≥ 命令队列上限 64（设计 §3.1）", MotionEvidenceBoard.DefaultCapacity >= 64);
        }
    }

    // ---- [corr-*] 关联矩阵：基线(5,100)/预期 7、提交@2000、观察窗 [2000,3500] ----
    private static CommandTicket SubmittedTicket(MotionEvidenceBoard board, int[]? expected,
        long? baseEmote = 5, long? baseTimeline = 100, string eventId = "e1")
    {
        var t = board.OpenTicket();
        board.RecordQueued(t, 1000);
        board.PrepareObservation(t, eventId, expected, baseEmote, baseTimeline);
        board.RecordNativeSubmitted(t, 2000);
        return t;
    }

    private static void CorrelatorCases(CheckFn check)
    {
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            var adopted = b.Observe(2100, 7, 150);
            check("[corr-confirm] 提交后命中预期=确认（含 Δms）", adopted == 1 && t.State == MotionEvidenceState.Confirmed
                && t.ReasonZh == "已确认（+100ms）", t.ReasonZh);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            b.Observe(1900, 7, 150);                          // 提交前的观察必须忽略
            check("[corr-pre-submit] 提交前观察被忽略", t.State == MotionEvidenceState.NativeSubmitted);
            b.ExpireWindows(3600);
            check("[corr-pre-submit] 忽略后到期=超时未确认（非确认）", t.State == MotionEvidenceState.NoEvidence);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            b.Observe(2500, 0, 0);                            // 旧表情结束（主人裁决：绝不认作本次确认）
            check("[corr-old-emote-end] 旧表情结束不被收养", t.State == MotionEvidenceState.NativeSubmitted);
            b.ExpireWindows(3600);
            check("[corr-old-emote-end] 最终以超时未确认收场", t.State == MotionEvidenceState.NoEvidence);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            b.Observe(2400, 9, 100);                          // 仅 EmoteId 瞬时漂移、槽0未换
            var adopted = b.Observe(2600, 7, 150);
            check("[corr-other-then-expected] 基线→其他→预期仍确认本次", adopted == 1 && t.State == MotionEvidenceState.Confirmed);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            b.Observe(2400, 9, 200);                          // 槽0起了别的时间轴
            check("[corr-mismatch] 窗口内别的动作=终态证据不符", t.State == MotionEvidenceState.Mismatch
                && t.ReasonZh == "证据不符", t.ReasonZh);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            for (var at = 2050; at <= 3500; at += 150) b.Observe(at, 5, 100); // 一直等于基线
            check("[corr-window] 等于基线的观察不推进状态", t.State == MotionEvidenceState.NativeSubmitted);
            b.ExpireWindows(3500);
            check("[corr-window] 窗口边界（≤3500）仍开", t.State == MotionEvidenceState.NativeSubmitted);
            b.ExpireWindows(3501);
            check("[corr-window] 过窗未匹配=超时未确认", t.State == MotionEvidenceState.NoEvidence
                && t.ReasonZh == "超时未确认", t.ReasonZh);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            b.Observe(2100, 7, 150);
            b.Observe(2200, 9, 200);                          // 已确认后的「新证据」
            b.ExpireWindows(4000);
            board_NoOp(b);
            check("[corr-once-terminal] 第二次终态收养被拒绝（终态恰一次）",
                t.State == MotionEvidenceState.Confirmed && t.ReasonZh == "已确认（+100ms）", t.ReasonZh);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 });
            b.Observe(4000, 7, 150);                          // 过窗的迟到观察
            check("[corr-late] 过窗观察不确认", t.State == MotionEvidenceState.NativeSubmitted);
            b.ExpireWindows(4001);
            check("[corr-late] 迟到=超时未确认", t.State == MotionEvidenceState.NoEvidence);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, null);                 // 预期不可映射（如歌词聊天行）
            check("[corr-mapping-unknown] 无法映射预期=观察跳过（非失败）",
                t.State == MotionEvidenceState.MappingUnknown && t.ReasonZh.Contains("无法映射预期"), t.ReasonZh);
            b.Observe(2100, 7, 150);
            check("[corr-mapping-unknown] 跳过后观察无副作用", t.State == MotionEvidenceState.MappingUnknown);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 }, baseEmote: null); // 基线不可采
            check("[corr-baseline-missing] 基线不可采=观察跳过（非失败）",
                t.State == MotionEvidenceState.MappingUnknown && t.ReasonZh.Contains("无法采集表情基线"), t.ReasonZh);
        }
        {
            var b = new MotionEvidenceBoard();
            var stale = SubmittedTicket(b, new[] { 7 });       // 上一场遗留
            b.BeginShow();                                     // 新一场：世代号翻新
            b.Observe(2100, 7, 150);
            check("[corr-supersede] 上一场票据不被本场观察收养", stale.State == MotionEvidenceState.NativeSubmitted);
            var fresh = SubmittedTicket(b, new[] { 7 });
            check("[corr-supersede] 新场票据正常收养", fresh.State == MotionEvidenceState.NativeSubmitted);
            b.Observe(2600, 7, 150);
            check("[corr-supersede] 新场票据确认、旧票仍原状",
                fresh.State == MotionEvidenceState.Confirmed && stale.State == MotionEvidenceState.NativeSubmitted);
        }
        {
            var b = new MotionEvidenceBoard();
            var t1 = b.OpenTicket();
            var gen1 = b.Generation;
            b.BeginShow();
            var t2 = b.OpenTicket();
            check("[corr-ticket-id] 世代翻新且票据号永不撞（跨场/同场）",
                b.Generation == gen1 + 1 && t1.Id != t2.Id && t1.Id.Contains("t") && t2.Id.Contains("t"), t1.Id + "|" + t2.Id);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 7 }, baseEmote: 7); // 同表情重派：基线即预期
            b.Observe(2100, 7, 100);                           // 仍等于基线 → 旧表情继续播
            check("[corr-same-emote] 等于基线不认（旧表情不算新证据）", t.State == MotionEvidenceState.NativeSubmitted);
            b.Observe(2200, 7, 160);                           // 同表情换时间轴 → 新起播
            check("[corr-same-emote] 同表情新时间轴=确认", t.State == MotionEvidenceState.Confirmed);
        }
        {
            var b = new MotionEvidenceBoard();
            var t = SubmittedTicket(b, new[] { 80, 91 });      // 同 TextCommand 变体行族
            b.Observe(2100, 91, 150);                          // 游戏实际执行变体行 91
            check("[corr-family] 变体行命中族即确认", t.State == MotionEvidenceState.Confirmed);
        }
    }

    private static void board_NoOp(MotionEvidenceBoard b) { _ = b.Count; }

    // ---- [render-*] 渲染：无票据逐字节不变；有票据追加中文证据注释 ----
    private static void RenderCases(CheckFn check)
    {
        {
            long t = 7000;
            var disp = new FakeShowDispatcher();
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.SetMotionEvidence(new MotionEvidenceBoard()); // 有板但派发器无票据
            var pkg = new ShowPackage { ProtocolVersion = 1, Name = "渲染基线", DurationMs = 30000 };
            pkg.Events.Add(new ShowEvent { Id = "e1", Kind = "motion", StartMs = 500, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
            runner.Load(pkg); runner.Arm(); runner.Start(0);
            runner.Tick(); t += 500; runner.Tick();
            using var doc = System.Text.Json.JsonDocument.Parse(runner.StatusJson());
            var entry = doc.RootElement.GetProperty("recentLog")[0];
            check("[render-no-ticket] 无票据 recentLog 证据键为空值",
                entry.GetProperty("evidenceState").GetString() == "" && entry.GetProperty("evidenceReason").GetString() == ""
                && entry.GetProperty("evidenceMonoMs").GetInt64() == 0);
            check("[render-no-ticket] 无票据 logText 逐字节保持旧渲染",
                doc.RootElement.GetProperty("logText").GetString() == "[500ms] e1(motion) /bow motion → 已发送\n",
                doc.RootElement.GetProperty("logText").GetString());
        }
        {
            var b = new MotionEvidenceBoard();
            var t = b.OpenTicket();
            b.RecordQueued(t, 1000);
            var log = new ExecutionLog();
            var entry = new ExecutionLogEntry { EventId = "e1", Kind = "motion", Command = "/bow motion",
                PlannedMs = 500, DispatchedShowMs = 500, DispatchedMonoMs = 1000, Ok = true, TicketId = t.Id };
            log.Add(entry);
            b.ApplyToEntry(entry);
            check("[render-queued] 基础箭头保留 + 追加 已入队 注释",
                log.RenderTail(10) == "[500ms] e1(motion) /bow motion → 已发送〔证据：已入队〕\n", log.RenderTail(10));
            b.PrepareObservation(t, "e1", new[] { 7 }, 5, 100);
            b.RecordNativeSubmitted(t, 2000);
            b.Observe(2100, 7, 150);
            log.UpdateEvidence(b);
            check("[render-confirmed] 状态演进后回写 已确认（+Δms）",
                log.RenderTail(10) == "[500ms] e1(motion) /bow motion → 已发送〔证据：已确认（+100ms）〕\n", log.RenderTail(10));
        }
        {
            var b = new MotionEvidenceBoard();
            var t = b.OpenTicket();
            b.RecordQueueRejected(t, "policy", 1000);
            var log = new ExecutionLog();
            var entry = new ExecutionLogEntry { EventId = "e2", Kind = "lyrics", Command = "/party 你好",
                PlannedMs = 900, DispatchedShowMs = 900, DispatchedMonoMs = 1000, Ok = true, TicketId = t.Id };
            log.Add(entry);
            b.ApplyToEntry(entry);
            check("[render-rejected] 被拒注释带原因类",
                log.RenderTail(10) == "[900ms] e2(lyrics) /party 你好 → 已发送〔证据：入队被拒（安全策略拒绝）〕\n", log.RenderTail(10));
        }
    }

    // ---- [policy-*] 只记录：被拒/未确认不停演、Ok 不变 ----
    private sealed class TicketedFakeDispatcher : IShowDispatcher
    {
        public readonly MotionEvidenceBoard Board;
        public readonly List<CommandTicket> Tickets = new();
        public bool RejectAll;
        public int StopCalls, ShowStartCalls;
        public TicketedFakeDispatcher(MotionEvidenceBoard board) { Board = board; }
        public ShowDispatchResult Dispatch(ShowEvent e)
        {
            var ticket = Board.OpenTicket();
            if (RejectAll) Board.RecordQueueRejected(ticket, "policy", 1000);
            else
            {
                Board.RecordQueued(ticket, 1000);
                Board.PrepareObservation(ticket, e.Id, new[] { 7 }, 5, 100);
            }
            Tickets.Add(ticket);
            var r = ShowDispatchResult.Success(); // 证据只记录：被拒也返回 Success（P1 裁决）
            r.TicketId = ticket.Id;
            return r;
        }
        public void OnShowStart() => ShowStartCalls++;
        public void OnStop() => StopCalls++;
    }

    private static ShowPackage TwoMotionShow()
    {
        var p = new ShowPackage { ProtocolVersion = 1, Name = "只记录", DurationMs = 30000 };
        p.Events.Add(new ShowEvent { Id = "m1", Kind = "motion", StartMs = 0, DurationMs = 500, Command = "/bow motion", PerformerId = "p1" });
        p.Events.Add(new ShowEvent { Id = "m2", Kind = "motion", StartMs = 1000, DurationMs = 500, Command = "/wave motion", PerformerId = "p1" });
        return p;
    }

    private static void PolicyCases(CheckFn check)
    {
        {
            var board = new MotionEvidenceBoard();
            var disp = new TicketedFakeDispatcher(board) { RejectAll = true };
            long t = 1000;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.SetMotionEvidence(board);
            runner.Load(TwoMotionShow()); runner.Arm(); runner.Start(0);
            runner.Tick();
            t += 1000; runner.Tick();
            check("[policy-rejected] 入队被拒仍 Playing、Ok=true、不停演",
                runner.State == ShowState.Playing && runner.DispatchedCount == 2 && disp.Tickets.TrueForAll(x => x.State == MotionEvidenceState.QueueRejected));
            using var doc = System.Text.Json.JsonDocument.Parse(runner.StatusJson());
            var first = doc.RootElement.GetProperty("recentLog")[0];
            check("[policy-rejected] 条目记录 入队被拒 证据",
                first.GetProperty("ok").GetBoolean() && first.GetProperty("evidenceState").GetString() == "queue-rejected"
                && first.GetProperty("evidenceReason").GetString() == "入队被拒（安全策略拒绝）",
                first.GetProperty("evidenceReason").GetString());
        }
        {
            var board = new MotionEvidenceBoard();
            var disp = new TicketedFakeDispatcher(board);
            long t = 1000;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.SetMotionEvidence(board);
            runner.Load(TwoMotionShow()); runner.Arm(); runner.Start(0);
            runner.Tick();
            t += 16; runner.Tick();                              // 旧 Start：转换帧后下一帧才派发 t0
            var m1 = disp.Tickets[0];
            board.RecordNativeSubmitted(m1, 1500);            // 原生已提交但从未确认
            board.ExpireWindows(5000);                        // 观察适配器帧结算窗口
            t += 1000; runner.Tick();
            check("[policy-unconfirmed] 超时未确认仍 Playing、无 Fault、无跳过",
                runner.State == ShowState.Playing && runner.SkippedCount == 0);
            using var doc = System.Text.Json.JsonDocument.Parse(runner.StatusJson());
            var first = doc.RootElement.GetProperty("recentLog")[0];
            check("[policy-unconfirmed] 条目 Ok 不变且记录 超时未确认",
                first.GetProperty("ok").GetBoolean() && first.GetProperty("evidenceState").GetString() == "no-evidence",
                first.GetProperty("evidenceState").GetString());
            for (var i = 0; i < 40 && runner.State != ShowState.Completed; i++) { t += 1000; runner.Tick(); }
            check("[policy-unconfirmed] 演出照常完结", runner.State == ShowState.Completed);
        }
    }

    // ---- [stop-*] 停演取消恰一次；重演不撞号 ----
    private static void StopCases(CheckFn check)
    {
        {
            var b = new MotionEvidenceBoard();
            var queued = b.OpenTicket(); b.RecordQueued(queued, 1000);
            var submitted = SubmittedTicket(b, new[] { 7 }, eventId: "e2");
            var n1 = b.MarkStopped(3000);
            var atQueued = queued.StateAtMs;
            var n2 = b.MarkStopped(3100);
            check("[stop-cancel] 所有未终态票据停演取消恰一次",
                n1 == 2 && n2 == 0 && queued.State == MotionEvidenceState.CancelledByStop
                && submitted.State == MotionEvidenceState.CancelledByStop
                && queued.ReasonZh == "停演取消");
            check("[stop-cancel] 重复停演零新增（时间戳不变）", queued.StateAtMs == atQueued);
        }
        {
            var board = new MotionEvidenceBoard();
            var disp = new TicketedFakeDispatcher(board);
            long t = 1000;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.SetMotionEvidence(board);
            runner.Load(TwoMotionShow()); runner.Arm(); runner.Start(0);
            runner.Tick();
            t += 16; runner.Tick();                              // 转换帧后下一帧派发 m1（票据打开）
            var firstTicket = disp.Tickets[0].Id;
            runner.RequestStop("测试停止");
            check("[stop-runner] 停演清扫把打开票据记为停演取消", disp.Tickets[0].State == MotionEvidenceState.CancelledByStop);
            using var doc = System.Text.Json.JsonDocument.Parse(runner.StatusJson());
            var first = doc.RootElement.GetProperty("recentLog")[0];
            check("[stop-runner] recentLog 回写 cancelled-by-stop",
                first.GetProperty("evidenceState").GetString() == "cancelled-by-stop",
                first.GetProperty("evidenceState").GetString());
            runner.RequestStop("重复停止");
            check("[stop-runner] 重复停止零新增（幂等）",
                disp.StopCalls == 1 && disp.Tickets[0].State == MotionEvidenceState.CancelledByStop);
            // 重演（Arm+Start，不重新 Load）：新票据号与上一轮不同
            check("[stop-replay] 停后可重新就绪", runner.Arm().Ok);
            runner.Start(0); runner.Tick();
            t += 16; runner.Tick();                              // 重演的 m1 在转换帧后下一帧派发
            var replayTicket = disp.Tickets[disp.Tickets.Count - 1].Id;
            check("[stop-replay] 重演票据号不与上一场相撞", replayTicket != firstTicket, replayTicket + " vs " + firstTicket);
            runner.RequestStop("重演后再停");
            check("[stop-replay] 重演后停演同样取消", disp.Tickets[disp.Tickets.Count - 1].State == MotionEvidenceState.CancelledByStop);
        }
        {
            // 卸载也不留悬空观察（残留票一并停演取消）
            var board = new MotionEvidenceBoard();
            var disp = new TicketedFakeDispatcher(board);
            long t = 1000;
            var runner = new ShowRunner(disp, () => t);
            runner.SetGuardProvider(() => new GuardSnapshot());
            runner.SetMotionEvidence(board);
            runner.Load(TwoMotionShow()); runner.Arm(); runner.Start(0); runner.Tick();
            t += 16; runner.Tick();
            runner.RequestStop("先停");
            runner.Unload();
            check("[stop-unload] 卸载后无悬空打开票据",
                disp.Tickets.TrueForAll(x => x.State == MotionEvidenceState.CancelledByStop || MotionEvidenceText.IsTerminal(x.State)));
        }
    }
}
