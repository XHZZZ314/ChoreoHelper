// 这个文件是干嘛的：EXEC-CORE 演出执行器核心——状态机 + 统一单调时钟（纯逻辑，无 Dalamud
// 依赖，进 datalayertest；时钟经 Func<long> 注入，测试用假时钟）。设计文档 §2 固定状态：
// Idle→Loaded→Armed→Countdown→Playing→(Stopping)→Completed/Faulted；任意状态收到紧急停止
// 都先入 Stopping、做完清扫回到 Loaded（或 Unload 后 Idle）；停止幂等，重复调绝不重复触发。
// 游戏无关性：调度用 EventScheduler（预编译队列+游标），守卫用 RuntimeGuard.Evaluate（纯
// 函数），执行经 IShowDispatcher 接口（游戏适配器在 GameShowDispatcher）——本文件不碰任何
// Dalamud/游戏对象。所有状态迁移单锁串行：Tick 在框架线程，HTTP 调用经 POST 闸，互不交错。
// 与旧 PlaybackManager（游戏预览模式）职责彻底分离：那边是网页逐帧驱动的预览/定格链路，
// 这边是一次上传、显式开始、倒计时、本地时钟自主执行的演出链路；互不调用。
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChoreoHelper;

public enum ShowState
{
    Idle, Loaded, Armed, Countdown, Playing, Stopping, Completed, Faulted
}

public interface IShowDispatcher
{
    /// <summary>立即执行一条事件。返回 Ok=false 时 Reason 为中文原因。</summary>
    ShowDispatchResult Dispatch(ShowEvent e);

    /// <summary>开演互斥：进入倒计时时恰调用一次——释放预览定格残留、清空共享命令队列残留，
    /// 与 PlaybackManager.Play 的 StopPreview+Clear 同口径（SHOWEXEC-DIAGNOSIS M3）。
    /// 实现必须幂等且不抛（ShowRunner 侧另有兜底，重复 Start 被拒不会重复调用）。</summary>
    void OnShowStart();

    /// <summary>停演清扫：停移动、清未执行命令、退定格。必须幂等（重复调用不得再触发）。</summary>
    void OnStop();
}

/// <summary>X1 离线执行器活动更新缝合（可选）：仅 X1ShowDispatcher 实现；传统执行器不实现，行为不变。</summary>
public interface IX1ActiveUpdater
{
    /// <summary>推进活动执行器。Skips 为本更新内按 Skip 策略跳过的结构化记录（可空即零条）；
    /// Ok=false 仍为故障停（跳过已记账后仍可伴随故障）。FailedEventId 为该次失败归属的事件标识：
    /// 能确定归属时必须给出（供结果绑定），不能确定时为空串（不编造归属）。重入停止时调用方以状态为准抑制记账。</summary>
    (bool Ok, string Error, List<X1SkipRecord>? Skips, string FailedEventId) UpdateActive(long showTimeMs);
}

public struct ShowDispatchResult
{
    public bool Ok { get; set; }
    public string Reason { get; set; }
    /// <summary>跳过标记：true=按声明 Skip 策略跳过该事件（非故障，演出继续）。Ok 恒为 true。</summary>
    public bool Skipped { get; set; }
    /// <summary>跳过失败类：ability-condition / facing-observation / movement-tolerance；非跳过为空。</summary>
    public string SkipClass { get; set; }
    /// <summary>未知与不满足标记：含“未知”或“不满足”；非跳过为空。</summary>
    public string SkipMarking { get; set; }
    public string TicketId { get; set; } // test-demanded (MotionEvidenceTests)
    public AbilityExecutionResult? AbilityAttempt { get; set; }
    public static ShowDispatchResult Success() => new() { Ok = true, Reason = "" };
    public static ShowDispatchResult Fail(string reason) => new() { Ok = false, Reason = reason ?? "" };
    public static ShowDispatchResult Skip(string reason, string skipClass, string marking) => new() { Ok = true, Skipped = true, Reason = reason ?? "", SkipClass = skipClass ?? "", SkipMarking = marking ?? "" };
}

/// <summary>X1 跳过记录：UpdateActive 逐跳观测/容差失败在 Skip 策略下的结构化跳过（非故障）。</summary>
public sealed class X1SkipRecord
{
    public string EventId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string SkipClass { get; set; } = "";
    public string Reason { get; set; } = "";
    public string Marking { get; set; } = "";
    public long ShowTimeMs { get; set; }
    public long PlannedMs { get; set; }
}

public interface IShowClockBinding
{
    void BindShowClock(long startMonoMs);
}

public sealed class ShowRunner
{
    private readonly object _gate;
    private readonly Func<long> _clock;              // 单调毫秒（生产 Environment.TickCount64，测试假时钟）
    private IShowDispatcher? _dispatcher;
    private readonly IShowDispatcher? _defaultDispatcher;
    private Func<ShowPackage, string, string, PreparedShowRegistration>? _registrationFactory;
    private PreparedShowRegistration? _registration;
    private bool _stageConfirmed;
    internal bool StageMappingConfirmed { get { lock(_gate)return _stageConfirmed; } }
    private object? _stageMapping;
    private X1CalibrationPose _stagePose;
    // R2：一次性确认被 Arm 消费后仍持有的「开演前上下文见证」——站位与模式/键位等上下文任一变化
    // 即失效，直到执行接管（Countdown→Playing）才退休；预约开演前必须复核。
    private Action? _stagePreStartCheck;
    private bool _stagePreStartValid;
    internal void InvalidatePendingStageMapping()
    {
        lock(_gate)
        {
            if(!_stageConfirmed && !_stagePreStartValid) return;
            _stageConfirmed=false;
            _stagePreStartValid=false;
            _stagePreStartCheck=null;
            _registration?.Cancel();
        }
    }
    internal void ObserveStageMapping(X1CalibrationPose pose)
    {
        lock(_gate)
            if((_stageConfirmed || _stagePreStartValid) && !StagePathMappingReview.SamePosition(_stagePose,pose))
                InvalidatePendingStageMapping();
    }

    // 仅由游戏内明确确认调用；HTTP 装载不能设置此许可，旧装载身份立即作废。
    internal (string PackageId, string ClientLoadId) ConfirmStageMapping(StagePathMappingReview review, X1CalibrationPose pose)
    {
        lock (_gate)
        {
            var mapped=review.Consume(pose);
            var nonce=Guid.NewGuid().ToString("D");
            var result=Load(mapped,nonce,true);
            if(!result.Ok)throw new InvalidOperationException(result.Message);
            _stageConfirmed=true;
            _stagePose=pose;
            _stagePreStartCheck=review.CheckPreStart;
            _stagePreStartValid=true;
            _stageMapping=new { sourcePackageId=review.SourcePackageId,sourceClientLoadId=review.SourceClientLoadId,
                packageId=_scheduled.PackageId,clientLoadId=nonce,summary=review.Summary };
            return (_scheduled.PackageId,nonce);
        }
    }
    private Action? _checkRunAdmission;             // 所有演出共用的只读输入互斥；不只覆盖有 X1 登记的演出。
    private Func<GuardSnapshot>? _guardProvider;     // 游戏适配器提供（框架线程上采集）
    private Action<string>? _trace;                  // 可读日志出口（插件日志）

    private ShowState _state = ShowState.Idle;
    private ShowPackage? _pkg;
    private EventScheduler? _sched;
    private ExecutionLog _log = new();
    private readonly List<ShowEvent> _dueBuffer = new();

    private readonly ScheduledShowStartPolicy _scheduled = new();
    private readonly OwnedShowLoadPolicy _owned = new();
    private bool _cleanupFailed;
    private (string PackageId, string ArmId, string StartId)? _failedScheduledStop;

    private long _lastTickMono;
    private long _countdownEndMono;
    private long _showStartMono;
    private string _resultStartId="";
    private long _showTimeMs;
    private int _dispatchedCount;
    private int _skippedCount;
    private string _stopReason = "";
    private int _stopCleanupRuns;   // 停演清扫执行次数（幂等断言用）

    /// <summary>倒计时默认时长（毫秒）。设计文档 §1：玩家点击开始 → 倒计时 → 执行。</summary>
    public const int DefaultCountdownMs = 3000;
    /// <summary>倒计时上限：倒计时是安全窗口不是表演内容，30s 顶格。</summary>
    public const int MaxCountdownMs = 30000;
    /// <summary>单调时钟单帧跨度超过此值视为时钟跳变（设计文档 §7）。</summary>
    public const long ClockJumpThresholdMs = 5000;

    public ShowRunner(IShowDispatcher? dispatcher, Func<long> clock, Action<string>? trace = null, object? synchronizationGate = null)
    {
        _gate = synchronizationGate ?? new object();
        _dispatcher = dispatcher;
        _defaultDispatcher = dispatcher;
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _trace = trace;
    }

    /// <summary>只读单调毫秒，与定时开演 deadline 使用同一时钟。</summary>
    public long Clock { get { lock (_gate) return _clock(); } }
    public const int MinScheduledLeadMs = ScheduledShowStartPolicy.MinLeadMs;

    public ScheduledShowStartClock GetScheduledStartClock()
    {
        lock (_gate) return new(_clock(), _scheduled.PackageId, _scheduled.ArmId,
            _state, _scheduled.StartId, _scheduled.DeadlineMonoMs, _owned.ClientLoadId);
    }

    public ShowState State { get { lock (_gate) return _state; } }
    public string StopReason { get { lock (_gate) return _stopReason; } }
    public long ShowTimeMs { get { lock (_gate) return _showTimeMs; } }
    // 面板只读取现有倒数终点，不建立另一个计时器或推进演出。
    public long CountdownRemainingMs { get { lock (_gate) return _state == ShowState.Countdown ? Math.Max(0, _countdownEndMono - _clock()) : 0; } }
    public int DispatchedCount { get { lock (_gate) return _dispatchedCount; } }
    public int SkippedCount { get { lock (_gate) return _skippedCount; } }
    public int TotalCount { get { lock (_gate) return _pkg?.Events.Count ?? 0; } }
    public int StopCleanupRuns { get { lock (_gate) return _stopCleanupRuns; } }
    public bool CleanupFailed { get { lock (_gate) return _cleanupFailed; } }

    /// <summary>确定拒绝装载时先记住取消身份；只有没有成为当前场次且墓碑写入成功才可回 noMutation。</summary>
    public bool CancelUnadoptedLoad(string clientLoadId)
    {
        lock (_gate) return clientLoadId != _owned.ClientLoadId && _owned.Cancel(clientLoadId);
    }

    private MotionEvidenceBoard? _motionBoard;
    // era-reconciliation micro-add (no donor; demanded by current MotionEvidenceTests).
    public void SetMotionEvidence(MotionEvidenceBoard? board) { lock (_gate) _motionBoard = board; }

    public void SetGuardProvider(Func<GuardSnapshot>? provider)
    {
        lock (_gate) _guardProvider = provider;
    }

    /// <summary>在装载前接入本机共享输入互斥；检查只读，失败不能释放另一位输入 owner。</summary>
    public void SetRunAdmissionCheck(Action check)
    {
        lock (_gate)
        {
            if (_state != ShowState.Idle) throw new InvalidOperationException("运行互斥检查只能在尚未装载时设置");
            _checkRunAdmission = check ?? throw new ArgumentNullException(nameof(check));
        }
    }

    public void SetRegistrationFactory(Func<ShowPackage, string, string, PreparedShowRegistration> factory)
    {
        lock (_gate)
        {
            if (_state != ShowState.Idle) throw new InvalidOperationException("登记工厂只能在尚未装载时设置");
            _registrationFactory = factory ?? throw new ArgumentNullException(nameof(factory));
        }
    }

    /// <summary>仅为本人原生命令获取当前登记快照；不 Arm/Start，也不调用任何生产输出。
    /// 取消、替换、就绪或开始后旧快照许可永久失效，按键前须再次调用返回的检查。</summary>
    public (ShowPackage Package, Action CheckCurrent, string PackageId, string ClientLoadId) CaptureRegisteredPathTrial()
    {
        lock (_gate)
        {
            var current = _registration;
            void CheckCurrent()
            {
                lock (_gate)
                    if (_cleanupFailed || _state != ShowState.Loaded || current == null
                        || !ReferenceEquals(_registration, current) || !current.IsCurrent)
                        throw new InvalidOperationException("路径试验绑定的整包已取消、替换或离开未启动状态");
            }
            CheckCurrent();
            return (X1PreparedPackage.ClonePackage(current!.Package), CheckCurrent, _scheduled.PackageId, _owned.ClientLoadId);
        }
    }

    /// <summary>装载演出包（须已过 ShowValidator）。执行中（Countdown/Playing/Stopping）拒绝。</summary>
    public (bool Ok, string Message) Load(ShowPackage pkg, string? clientLoadId = null, bool onlyIfIdle = false)
    {
        lock (_gate)
        {
            if (_cleanupFailed) return (false, "上次停止清理未完成，请先重试停止");
            if (_stageConfirmed) return (false,"游戏内映射已确认，请先明确停止此场，再登记新路径");
            if ((onlyIfIdle || _owned.ClientLoadId.Length != 0) && _state == ShowState.Armed)
                return (false, "本机演出已就绪，请先停止");
            if (_state is ShowState.Countdown or ShowState.Playing or ShowState.Stopping)
                return (false, "演出正在执行，请先紧急停止再装载新演出");
            if (pkg == null || pkg.Events.Count == 0)
                return (false, "演出包为空或没有事件");
            if (!_owned.CanLoad(clientLoadId))
                return (false, "本次装载身份无效、已使用或已取消，或会话容量已满，请使用新身份或重载插件");
            // 所有可失败准备先在私有候选上完成。失败不撤销原登记、不停预览、不提交游戏输入。
            var generation = _scheduled.Generation;
            var packageId = Guid.NewGuid().ToString("N");
            PreparedShowRegistration? candidate = null;
            EventScheduler scheduler;
            string fingerprint;
            try
            {
                if (pkg.X1 != null)
                {
                    if (clientLoadId == null || _registrationFactory == null)
                        return (false, "X1 完整输入需要本人装载身份与游戏框架线程登记入口");
                    candidate = _registrationFactory(pkg, packageId, clientLoadId);
                    pkg = candidate.Package;
                }
                scheduler = new EventScheduler(pkg.Events);
                fingerprint = ScheduledShowStartPolicy.Fingerprint(pkg);
            }
            catch (Exception error) { return (false, "整包准备失败：" + error.Message); }
            // 工厂的只读供给也可能重入取消；失去见证的旧候选永远不能被采用。
            if (_scheduled.Generation != generation || !_owned.CanLoad(clientLoadId) || _cleanupFailed
                || _state is ShowState.Countdown or ShowState.Playing or ShowState.Stopping
                || (onlyIfIdle || _owned.ClientLoadId.Length != 0) && _state == ShowState.Armed)
                return (false, "准备期间演出或装载身份已变化，本次没有采用输入");
            _scheduled.Load(pkg, packageId, fingerprint);
            _stageConfirmed=false; _stageMapping=null;
            _stagePreStartValid=false; _stagePreStartCheck=null;
            _owned.Loaded(clientLoadId);
            _registration?.Cancel();
            _registration = candidate;
            _registration?.Adopt();
            _dispatcher = candidate?.Dispatcher ?? _defaultDispatcher;
            _pkg = pkg;
            _sched = scheduler;
            _log = new ExecutionLog();
            _dispatchedCount = 0;
            _skippedCount = 0;
            _showTimeMs = 0;
            _resultStartId="";
            _stopReason = "";
            SetStateLocked(ShowState.Loaded, "装载演出「" + pkg.Name + "」（" + pkg.Events.Count + " 条事件）");
            return (true, "已装载");
        }
    }

    /// <summary>就绪（Armed）。HTTP 调用方须调度到框架线程；X1 先检查登记、角色、舞台和
    /// 输入准备。倒计时与执行仍由每帧守卫检查，未满足准备条件时不改变状态或清扫游戏。</summary>
    public (bool Ok, string Message) Arm()
        => ArmCore(false);

    public (bool Ok, string Message) ArmBound(string packageId, string clientLoadId)
    {
        lock (_gate)
        {
            if (!OwnedShowLoadPolicy.ValidId(clientLoadId) || clientLoadId != _owned.ClientLoadId ||
                packageId != _scheduled.PackageId || _owned.Cancelled)
                return (false, "本次装载已变化或已取消，未就绪当前演出");
            return ArmCore(true);
        }
    }

    private (bool Ok, string Message) ArmCore(bool owned)
    {
        lock (_gate)
        {
            if (_cleanupFailed) return (false, "停止清理未完成，请先重试停止");
            if (!owned && _owned.ClientLoadId.Length != 0)
                return (false, "此演出必须由装载它的页面确认就绪");
            if (_state is not (ShowState.Loaded or ShowState.Completed or ShowState.Faulted))
                return (false, StateRuleMessage());
            if (_pkg == null) return (false, "没有已装载的演出");
            if (StageShowContract.IsStage(_pkg) && !_stageConfirmed)
                return (false,"请先在游戏内审阅并明确确认当前站位映射；网页登记不授予执行许可");
            var generation = _scheduled.Generation;
            try { _checkRunAdmission?.Invoke(); _registration?.CheckReady(); }
            catch (Exception error) { return (false, "演出尚未就绪：" + error.Message); }
            if (_scheduled.Generation != generation || owned && _owned.Cancelled)
                return (false, "准备检查期间本次演出已变化或取消");
            _scheduled.Arm();
            if (StageShowContract.IsStage(_pkg)) _stageConfirmed=false;
            _owned.ArmId = _scheduled.ArmId;
            _sched!.Reset();
            _log = new ExecutionLog();
            _dispatchedCount = 0;
            _skippedCount = 0;
            _showTimeMs = 0;
            _stopReason = "";
            SetStateLocked(ShowState.Armed, "演出已就绪");
            return (true, "已就绪");
        }
    }

    /// <summary>开始执行：只接受 Armed 状态（设计文档 §8「POST /shows/start accepts only
    /// Armed sessions」）。进入倒计时，倒计时结束自动开演。</summary>
    public (bool Ok, string Message, int CountdownMs) Start(int countdownMs = DefaultCountdownMs)
    {
        lock (_gate)
        {
            if (_owned.ClientLoadId.Length != 0)
                return (false, "此演出必须使用本次就绪身份预约开演", 0);
            if (_state != ShowState.Armed)
                return (false, StateRuleMessage(), 0);
            var beforePreparation = _scheduled.Generation;
            try { _checkRunAdmission?.Invoke(); _registration?.CheckReady(); }
            catch (Exception error) { return (false, "开演前置条件未满足：" + error.Message, 0); }
            if (_scheduled.Generation != beforePreparation || _state != ShowState.Armed)
                return (false, "开演检查期间本次演出已变化", 0);
            _scheduled.InvalidateRun();
            var generation = _scheduled.Generation;
            var cd = Math.Clamp(countdownMs, 0, MaxCountdownMs);
            var now = _clock();
            _countdownEndMono = now + cd;
            _resultStartId=Guid.NewGuid().ToString("D");
            _lastTickMono = now;
            // SHOWEXEC-DIAGNOSIS（TASK-20260910-X1-SHOWEXEC-DIAGNOSIS，终端 A）开演互斥：
            // 释放预览/seek 残留的定格 + 清空共享命令队列残留（与 PlaybackManager.Play 的
            // StopPreview+Clear 同口径）。缺失的后果见 mechanism-assessment.md M3：残留定格
            // 会在整个 Playing 期把派发的舞蹈动作钉住（演中静止），停止时的 OnStop 才松开
            // （停后才动）。放在 Start 而非 Arm：Arm→Start 之间主人还可能预览/Seek，开始
            // 时刻释放最接近 Playing，倒计时窗口供沉降。清理失败必须停止，不能继续开演。
            try
            {
                SetStateLocked(ShowState.Countdown, "倒计时 " + cd + "ms 后开演");
                if (_scheduled.Generation != generation || _state != ShowState.Countdown)
                    return (false, "开演已被停止或替换", 0);
                _dispatcher?.OnShowStart();
            }
            catch (Exception ex)
            {
                if (_scheduled.Generation == generation && _state == ShowState.Countdown)
                    Faulted("开演准备失败：" + ex.Message);
                return (false, "开演准备失败：" + ex.Message, 0);
            }
            if (_scheduled.Generation != generation || _state != ShowState.Countdown)
                return (false, "开演已被停止或替换", 0);
            return (true, "倒计时开始", cd);
        }
    }

    /// <summary>按服务器单调 deadline 开演。身份来自 GetScheduledStartClock；每个 startId 只接受一次。</summary>
    public (bool Ok, string Message, int CountdownMs) ScheduleStart(string packageId, string armId,
        string startId, long deadlineMonoMs)
    {
        lock (_gate)
        {
            if (_state != ShowState.Armed) return (false, StateRuleMessage(), 0);
            // 前置检查在接受预约和生产 OnShowStart 之前；无写入失败不得触发游戏 Stop。
            var beforePreparation = _scheduled.Generation;
            try { _checkRunAdmission?.Invoke(); _registration?.CheckReady(); }
            catch (Exception error) { return (false, "开演前置条件未满足：" + error.Message, 0); }
            // R2：Arm 消费一次性确认后，预约开演前必须复核开演前上下文见证（站位由观察失效，
            // 模式/键位/角色由见证委托复核）；失效即拒绝，回到旧站位也不恢复。
            if (StageShowContract.IsStage(_pkg))
            {
                if (!_stagePreStartValid)
                    return (false, "开演前置条件未满足：站位确认后的上下文见证已失效，请重新审阅并确认", 0);
                try { _stagePreStartCheck?.Invoke(); }
                catch (Exception error)
                {
                    _stagePreStartValid=false; _stagePreStartCheck=null; _registration?.Cancel();
                    return (false, "开演前置条件未满足：" + error.Message, 0);
                }
            }
            if (_scheduled.Generation != beforePreparation || _state != ShowState.Armed)
                return (false, "开演检查期间本次演出已变化", 0);
            var now = _clock();
            var accepted = _scheduled.Accept(_pkg, packageId, armId, startId, now, deadlineMonoMs);
            if (!accepted.Ok) return accepted;
            var generation = _scheduled.Generation;
            _countdownEndMono = deadlineMonoMs;
            _resultStartId=startId;
            _lastTickMono = now;
            try
            {
                SetStateLocked(ShowState.Countdown, "已预约开演，剩余 " + accepted.CountdownMs + "ms");
                if (_scheduled.Generation != generation || _state != ShowState.Countdown)
                    return (false, "定时开演已被停止或替换", 0);
                _dispatcher?.OnShowStart();
            }
            catch (Exception ex)
            {
                // 回调可能重入并开启后来的一场；旧请求失败不能停止后来那场。
                if (_scheduled.Generation == generation && _state == ShowState.Countdown)
                    Faulted("开演准备失败：" + ex.Message);
                return (false, "开演准备失败：" + ex.Message, 0);
            }
            if (_scheduled.Generation != generation || _state != ShowState.Countdown)
                return (false, "定时开演已被停止或替换", 0);
            if (!_scheduled.PackageMatches(_pkg))
            {
                Faulted("演出内容已变化，请重新装载并就绪");
                return (false, "演出内容已变化，请重新装载并就绪", 0);
            }
            var preparedAt = _clock();
            if (preparedAt < now || preparedAt >= deadlineMonoMs)
            {
                Faulted("开演准备超过预约时间或时钟倒退，请重新就绪");
                return (false, "开演准备超过预约时间或时钟倒退，请重新就绪", 0);
            }
            return (true, accepted.Message, (int)(deadlineMonoMs - preparedAt));
        }
    }

    /// <summary>只停止身份精确匹配的定时演出；网络中滞留的旧停止请求不会影响新演出。</summary>
    public (bool Ok, string Message) StopScheduled(string packageId, string armId, string startId, string reason)
    {
        lock (_gate)
        {
            var retry = _cleanupFailed && _state == ShowState.Faulted &&
                _failedScheduledStop == (packageId, armId, startId);
            if (!retry && (!_scheduled.Matches(packageId, armId, startId) ||
                _state is not (ShowState.Countdown or ShowState.Playing)))
                return (false, "定时演出身份已失效，未停止当前演出");
            RequestStop(reason);
            return _cleanupFailed ? (false, "停止清理未完成，请重试停止") : (true, "已停止匹配的定时演出");
        }
    }

    /// <summary>旧无身份停止：只停止本机旧口径装载的场次。带装载归属（网页登记 clientLoadId）的
    /// 场次一律不动——滞留的旧请求绝不能停止新归属场次；页面须用定向停止身份，玩家可在游戏内
    /// /choreo stop 全局紧急停止。</summary>
    public (bool Ok, string Message) StopLegacy(string reason)
    {
        lock (_gate)
        {
            if (_owned.ClientLoadId.Length != 0)
                return (false, "本场带有装载归属（clientLoadId），旧无身份停止不会影响本场；请由装载页面定向停止，或在游戏内 /choreo stop 紧急停止");
            RequestStop(reason);
            return (true, "已请求停止");
        }
    }

    /// <summary>先消耗取消身份，再清扫自己的演出；从未到达的装载也不能迟到后执行。</summary>
    public (bool Ok, string Message, bool MatchedCurrent) StopOwnedLoad(string clientLoadId,
        string? packageId = null, string? armId = null, string reason = "本机取消多人演出")
    {
        lock (_gate)
        {
            var matched = clientLoadId.Length != 0 && clientLoadId == _owned.ClientLoadId;
            if (matched && (packageId != null && packageId != _scheduled.PackageId ||
                armId != null && armId != _owned.ArmId))
                return (false, "演出或就绪身份不匹配，未停止当前演出", true);
            if (!_owned.Cancel(clientLoadId))
                return (false, "取消身份无效或会话容量已满，未确认取消", matched);
            if (!matched) return (true, "该次装载已取消，当前演出未受影响", false);
            if (_state == ShowState.Stopping) return (false, "仍在停止，请等待清理完成", true);
            if (_state is ShowState.Countdown or ShowState.Playing || _cleanupFailed) RequestStop(reason);
            // 清扫/日志回调可能重入装载。目标已经取消，后续状态只属于新装载。
            if (_owned.ClientLoadId != clientLoadId) return (true, "该次演出已停止，当前演出未受影响", false);
            if (_cleanupFailed) return (false, "停止清理未完成：" + _stopReason, true);
            _registration?.Cancel();
            // 装载和就绪没有游戏写入；取消这些状态不能清扫其他预览/命令。
            _stageConfirmed=false;
            _stagePreStartValid=false; _stagePreStartCheck=null;
            _scheduled.InvalidateRun();
            _stopReason = reason;
            SetStateLocked(ShowState.Loaded, "本次演出已取消");
            return (true, "本次演出已停止", true);
        }
    }

    /// <summary>紧急停止：任意执行态（Armed/Countdown/Playing）幂等安全停。先入 Stopping，
    /// 清扫（停移动/清命令/退定格）成功后回 Loaded（保留演出包可重演）；清扫异常则 Faulted。
    /// 清扫失败的 Faulted 允许显式重试；其他非执行状态直接忽略，保证重复调用
    /// 绝不重复触发清扫（设计文档 §7「Stopping must be idempotent」）。</summary>
    public void RequestStop(string reason)
    {
        lock (_gate)
        {
            if (_state is not (ShowState.Armed or ShowState.Countdown or ShowState.Playing) &&
                !(_state == ShowState.Faulted && _cleanupFailed)) return;
            if (_owned.ClientLoadId.Length != 0) _owned.Cancel(_owned.ClientLoadId);
            if (_state == ShowState.Armed && _registration != null)
            {
                // X1 就绪仍未取得输入执行权，不能清扫另一条普通预览链路。
                _stagePreStartValid=false; _stagePreStartCheck=null;
                _registration.Cancel();
                _scheduled.InvalidateRun();
                _stopReason = reason;
                SetStateLocked(ShowState.Loaded, "已取消输入准备");
                return;
            }
            _stagePreStartValid=false; _stagePreStartCheck=null;
            SetStateLocked(ShowState.Stopping, "停止请求：" + reason);
            _stopReason = reason;
            var err = CleanupLocked();
            if (err == null) _registration?.Cancel();
            if (err != null) _stopReason += "；停止清扫失败：" + err;
            SetStateLocked(err == null ? ShowState.Loaded : ShowState.Faulted,
                err == null ? "已安全停止（演出保留，可重新就绪）" : "停止清扫失败：" + err);
        }
    }

    /// <summary>卸载演出包（回 Idle）。执行中先 RequestStop。</summary>
    public (bool Ok, string Message) Unload()
    {
        lock (_gate)
        {
            if (_cleanupFailed) return (false, "停止清理未完成，不能卸载演出");
            if (_state is ShowState.Countdown or ShowState.Playing or ShowState.Stopping)
                return (false, "演出正在执行，请先紧急停止再卸载");
            _scheduled.Unload();
            _stageConfirmed=false;_stageMapping=null;
            _stagePreStartValid=false;_stagePreStartCheck=null;
            _registration?.Cancel();
            _registration = null;
            _dispatcher = _defaultDispatcher;
            _owned.Loaded(null);
            _pkg = null;
            _sched = null;
            _log = new ExecutionLog();
            _dispatchedCount = 0;
            _skippedCount = 0;
            _showTimeMs = 0;
            _stopReason = "";
            SetStateLocked(ShowState.Idle, "已卸载演出");
            return (true, "已卸载");
        }
    }

    /// <summary>框架线程每帧调用：推进倒计时/执行/守卫。绝不让异常逃出（框架线程红线）。</summary>
    public void Tick()
    {
        try { TickInner(); }
        catch (Exception ex)
        {
            try { Faulted("执行器异常：" + ex.Message); } catch { }
        }
    }

    private void TickInner()
    {
        lock (_gate)
        {
            var now = _clock();
            var delta = now - _lastTickMono;
            _lastTickMono = now;

            // Stopping 是 RequestStop 单次持锁内的瞬态（进 Stopping → 清扫 → 终态一次完成），
            // 任何观察者（含本 Tick）都观察不到它——这里不再有"补清扫"分支
            //（2026-08-31 审计 P1：原防御臂不可达，系设计注释误设，已删）。
            if (_state != ShowState.Countdown && _state != ShowState.Playing) return;

            // 守卫：倒计时和执行中每帧评估（角色/地图/过场/战斗/不可控/时钟跳变/适配器失败）。
            // X1 守卫采集契约（TASK-20260910-X1-OFFLINE-GUARD）：采集不可用——未接入采集、采集抛
            // 异常、采集返回 null——= 输入不可信，fail-closed 直接故障停（原因含「守卫采集」），
            // 绝不用健康默认快照替身继续演出；故障先于 Countdown→Playing 转换与任何到点分发，
            // 清扫恰一次。Faulted 后 Tick 早退：恢复采集+时钟前进不自动复演，显式 Arm+Start 唯一恢复。
            var generation = _scheduled.Generation;
            GuardSnapshot? snap = null;
            try { snap = _guardProvider?.Invoke(); } catch (Exception ex) { TraceLocked("守卫采集失败：" + ex.Message); }
            if (_scheduled.Generation != generation) return;
            if (snap == null)
            {
                Faulted("安全停止：守卫采集不可用");
                return;
            }
            snap.FrameDeltaMs = delta;
            snap.ClockJumpThresholdMs = ClockJumpThresholdMs;
            var code = RuntimeGuard.Evaluate(snap);
            if (code != GuardCode.None)
            {
                Faulted("安全停止：" + RuntimeGuard.Describe(code) +
                        (string.IsNullOrEmpty(snap.Detail) ? "" : "（" + snap.Detail + "）"));
                return;
            }

            if (_scheduled.Active && !_scheduled.PackageMatches(_pkg))
            {
                Faulted("演出内容已变化，请重新装载并就绪");
                return;
            }
            if (_state == ShowState.Countdown)
            {
                if (now < _countdownEndMono) return;
                // R2：执行接管前的最后一道上下文门——倒数期间站位/模式/键位变化必须在任何输出前失败，
                // 而不是带着失效的映射开演；见证在执行接管的这一刻退休。
                if (StageShowContract.IsStage(_pkg))
                {
                    if (!_stagePreStartValid)
                    {
                        Faulted("开演前站位或输入上下文已变化，请重新审阅并确认");
                        return;
                    }
                    try { _stagePreStartCheck?.Invoke(); }
                    catch (Exception ex)
                    {
                        _stagePreStartValid=false; _stagePreStartCheck=null;
                        Faulted("开演前输入上下文已变化：" + ex.Message);
                        return;
                    }
                }
                var scheduled = _scheduled.Active;
                _showStartMono = scheduled ? _countdownEndMono : now;
                try { (_dispatcher as IShowClockBinding)?.BindShowClock(_showStartMono); }
                catch (Exception ex) { Faulted("演出时钟绑定失败：" + ex.Message); return; }
                if (_scheduled.Generation != generation || _state != ShowState.Countdown) return;
                _showTimeMs = now - _showStartMono;
                _stagePreStartValid=false; _stagePreStartCheck=null;
                SetStateLocked(ShowState.Playing, "开演");
                if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                // 旧 Start 保持下一帧派发；定时路径在到点这一帧按原 deadline 派发 t0。
                if (!scheduled) return;
            }

            // Playing：统一时钟推进，收集到点事件按固定优先级逐条分发
            _showTimeMs = now - _showStartMono;
            _dueBuffer.Clear();
            _sched!.CollectDue(_showTimeMs, _dueBuffer);
            foreach (var ev in _dueBuffer)
            {
                // 可重入停止防护：上一条分发中的槽回调可能已 RequestStop（同线程重入），
                // 状态已离开 Playing，剩余突发必须零进一步分发。
                if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                ShowDispatchResult r;
                try { r = _dispatcher != null ? _dispatcher.Dispatch(ev) : ShowDispatchResult.Fail("无执行器"); }
                catch (Exception ex) { r = ShowDispatchResult.Fail(ex.Message); }
                if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                _dispatchedCount++;
                if (r.Skipped)
                {
                    _skippedCount++;
                    _log.Add(new ExecutionLogEntry
                    {
                        EventId = ev.Id,
                        Kind = ev.Kind,
                        Command = ev.Command,
                        PlannedMs = ev.StartMs,
                        DispatchedShowMs = _showTimeMs,
                        DispatchedMonoMs = now,
                        Ok = false,
                        Reason = r.Reason,
                        Skipped = true,
                        SkipClass = r.SkipClass ?? "",
                        SkipMarking = r.SkipMarking ?? "",
                        AbilityAttempt = r.AbilityAttempt,
                    });
                    TraceLocked("事件「" + ev.Id + "(" + ev.Kind + ")」已跳过：" + r.Reason);
                    continue;
                }
                _log.Add(new ExecutionLogEntry
                {
                    EventId = ev.Id,
                    AbilityAttempt = r.AbilityAttempt,
                    Kind = ev.Kind,
                    Command = ev.Command,
                    PlannedMs = ev.StartMs,
                    DispatchedShowMs = _showTimeMs,
                    DispatchedMonoMs = now,
                    Ok = r.Ok,
                    Reason = r.Reason,
                });
                if (!r.Ok)
                {
                    // 失败策略（设计文档 §5 + X1 增量）：motion 与新增 ability/movement/facing
                    // 失败默认停整场；提示/歌词失败只跳过（存量行为不变）。
                    if (ev.Kind == "motion" || ev.Kind == "ability" || ev.Kind == "movement" || ev.Kind == "facing")
                    {
                        Faulted("动作事件「" + ev.Id + "」执行失败：" + r.Reason);
                        return;
                    }
                    TraceLocked("事件「" + ev.Id + "(" + ev.Kind + ")」失败已跳过：" + r.Reason);
                }
            }

            // X1 活动执行器更新（可选缝合）：同一 showTime 推进 movement/facing，守卫已在本 Tick 首部评估。
            // 传统执行器不实现此接口，行为不变。
            if (_scheduled.Generation == generation && _state == ShowState.Playing && _dispatcher is IX1ActiveUpdater x1)
            {
                try
                {
                    var (ok, err, skips, failedEventId) = x1.UpdateActive(_showTimeMs);
                    if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                    if (skips != null)
                    {
                        foreach (var s in skips)
                        {
                            if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                            _skippedCount++;
                            _log.Add(new ExecutionLogEntry
                            {
                                EventId = s.EventId,
                                Kind = s.Kind,
                                Command = "",
                                PlannedMs = s.PlannedMs,
                                DispatchedShowMs = s.ShowTimeMs,
                                DispatchedMonoMs = now,
                                Ok = false,
                                Reason = s.Reason,
                                Skipped = true,
                                SkipClass = s.SkipClass ?? "",
                                SkipMarking = s.Marking ?? "",
                            });
                            TraceLocked("事件「" + s.EventId + "(" + s.Kind + ")」已跳过：" + s.Reason);
                        }
                    }
                    if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                    if (!ok)
                    {
                        // R3：活动更新失败必须落回具体事件结果（保留分发/登记证据，追加失败结果），
                        // 不声称原生效果；无法确定归属时不编造事件。
                        BindActiveFailureLocked(failedEventId, err, now);
                        Faulted("执行器更新失败：" + err);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
                    Faulted("执行器更新失败：" + ex.Message);
                    return;
                }
            }

            if (_scheduled.Generation != generation || _state != ShowState.Playing) return;
            // 完成判定：队列发完且到达声明时长 → 正常完结（同样做清扫，防动作残留）
            if (_sched.Remaining == 0 && _showTimeMs >= _pkg!.DurationMs)
            {
                SetStateLocked(ShowState.Stopping, "演出完成，清理动作");
                var err = CleanupLocked();
                SetStateLocked(err == null ? ShowState.Completed : ShowState.Faulted,
                    err == null ? "演出完成" : "完成清扫失败：" + err);
            }
        }
    }

    /// <summary>把活动更新失败绑定到已分发事件的结果：保留原分发时刻与登记证据，追加失败结果与
    /// 失败时刻；不声称原生调用或效果。归属缺失或找不到对应日志时，不猜测邻近事件，
    /// 不编造条目（全局 stopReason 仍记录）。</summary>
    private void BindActiveFailureLocked(string failedEventId, string error, long monoMs)
    {
        var id = failedEventId ?? "";
        if (id.Length == 0) return;
        var entry = _log.Tail(500).LastOrDefault(r => r.EventId == id);
        if (entry == null) return;
        entry.Ok = false;
        entry.Reason = (entry.Reason.Length != 0 ? entry.Reason + "；" : "") + "活动更新失败：" + error;
        entry.EvidenceState = "active-update-failed";
        entry.EvidenceReason = error;
        entry.EvidenceMonoMs = monoMs;
    }

    /// <summary>故障停：任意执行态 → Faulted（带清扫）。重复 Faulted 幂等（清扫只跑一次）。</summary>
    private void Faulted(string reason)
    {
        lock (_gate)
        {
            if (_state is ShowState.Faulted or ShowState.Idle or ShowState.Stopping) return;
            SetStateLocked(ShowState.Stopping, "故障停止：" + reason);
            _stopReason = reason;
            var err = CleanupLocked();
            SetStateLocked(ShowState.Faulted, reason + (err == null ? "" : "；清扫失败：" + err));
        }
    }

    /// <summary>停演清扫：停移动/清未执行命令/退定格。幂等计数暴露给测试。返回异常消息或 null。</summary>
    private string? CleanupLocked()
    {
        if (_scheduled.Active)
            _failedScheduledStop = (_scheduled.PackageId, _scheduled.ArmId, _scheduled.StartId);
        _scheduled.InvalidateRun();
        _stopCleanupRuns++;
        try { _dispatcher?.OnStop(); _cleanupFailed = false; _failedScheduledStop = null; return null; }
        catch (Exception ex) { _cleanupFailed = true; return ex.Message; }
    }

    private void SetStateLocked(ShowState state, string message)
    {
        _state = state;
        TraceLocked(message);
    }

    private void TraceLocked(string message)
    {
        // 日志出口不可阻断安全清扫或把状态卡在 Stopping。
        try { _trace?.Invoke("[" + _state + "] " + message); } catch { }
    }

    private string StateRuleMessage() => _state switch
    {
        ShowState.Idle => "没有已装载的演出：先 POST /shows/load",
        ShowState.Loaded => "演出还没就绪：先 POST /shows/arm",
        ShowState.Armed => "演出已在倒计时/执行中：如需重来请先紧急停止",
        ShowState.Countdown => "倒计时进行中：等待开演或紧急停止",
        ShowState.Playing => "演出正在执行：如需中断请紧急停止",
        ShowState.Stopping => "正在安全停止，请稍候",
        ShowState.Completed => "演出已完成：重新就绪（arm）后再开始",
        ShowState.Faulted => _cleanupFailed ? "停止清理未完成，请重试停止并检查游戏状态" :
            "上次执行因异常结束（" + _stopReason + "）：清理已完成，请确认角色状态后重新就绪",
        _ => "状态不允许该操作",
    };

    /// <summary>只读状态（/shows/status 用）。结构化 JSON；日志尾部中文可读字段同时带上。</summary>
    public string StatusJson(bool includeDailyState = false)
    {
        lock (_gate)
        {
            _log.UpdateEvidence(_motionBoard);
            var recent = new List<object>();
            foreach (var e in _log.Tail(_pkg!=null && StageShowContract.IsStage(_pkg)?500:10))
                recent.Add(new
                {
                    id = e.EventId,
                    kind = e.Kind,
                    plannedMs = e.PlannedMs,
                    dispatchedMs = e.DispatchedShowMs,
                    ok = e.Ok,
                    reason = e.Reason,
                    skipped = e.Skipped,
                    skipClass = e.SkipClass ?? "",
                    skipMarking = e.SkipMarking ?? "",
                    evidenceState = e.EvidenceState ?? "",
                    evidenceReason = e.EvidenceReason ?? "",
                    evidenceMonoMs = e.EvidenceMonoMs,
                    abilityAttempt = e.AbilityAttempt,
                });
            var payload = new
            {
                state = _state.ToString().ToLowerInvariant(),
                stateText = StateRuleMessage(),
                name = _pkg?.Name ?? "",
                projectId = _pkg?.ProjectId ?? "",
                protocolVersion = _pkg?.ProtocolVersion ?? 0,
                x1Prepared = _registration?.IsCurrent == true,
                x1Registration = _registration?.IsCurrent == true ? _registration.Status : null,
                stageMapping = _stageMapping,
                startId = includeDailyState ? _resultStartId : null,
                packageId = includeDailyState ? _scheduled.PackageId : null,
                clientLoadId = includeDailyState ? _owned.ClientLoadId : null,
                events = !includeDailyState ? null : _pkg?.Events.Select(e=>new { id=e.Id,kind=e.Kind,plannedMs=e.StartMs,durationMs=e.DurationMs,
                    dispatched=_log.Tail(500).Any(r=>r.EventId==e.Id),
                    outcome=_log.Tail(500).LastOrDefault(r=>r.EventId==e.Id) }).ToArray(),
                timelineRevision = _pkg?.TimelineRevision ?? 0,
                durationMs = _pkg?.DurationMs ?? 0,
                showTimeMs = _showTimeMs,
                dispatched = _dispatchedCount,
                skipped = _skippedCount,
                total = _pkg?.Events.Count ?? 0,
                remaining = _sched?.Remaining ?? 0,
                stopReason = _stopReason,
                cleanupFailed = _cleanupFailed,
                recentLog = recent,
                logText = _log.RenderTail(10),
            };
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            });
            if (!includeDailyState) return json;
            var daily = System.Text.Json.Nodes.JsonNode.Parse(json)!;
            daily["stageMappingConfirmed"] = _stageConfirmed;
            return daily.ToJsonString();
        }
    }
}
