// 这个文件是干嘛的：本人主动开启的输入观察、自动短响应准备与独立接管检查；探测失败先松键，不自动开演。
using System;
using System.Linq;
using System.Text.Json;

namespace ChoreoHelper;

public sealed class X1InputPreparation : IDisposable
{
    private readonly Func<X1GameInputSnapshot> _read;
    private readonly Func<bool> _busy;
    private readonly GameOutputOwnership _outputOwnership;
    private GameOutputLease? _outputLease;
    private readonly Func<bool>? _externalOutputCleanupFailed;
    private readonly Action<string> _notify;
    private readonly Func<object?>? _abilityObservation;
    private readonly Func<object?>? _abilityReadReport;
    private readonly Func<object?>? _abilityTrialReport;
    private readonly X1StationaryFacingEvidence _stationaryFacing = new();
    private string? _facingCandidate;
    private readonly X1PhysicalTakeoverEvidence _passiveTakeover = new(), _activeTakeover = new();
    private bool _captureFeedbackTakeover;
    private readonly X1TakeoverCountdown _takeoverCountdown = new();
    private bool _activeTakeoverRequested, _diagnosticTakeover;
    private string _feedbackOwnerId = "";
    private readonly X1OsKeyWriter _keys;
    private readonly X1PhysicalInputMonitor _monitor = new();
    private readonly X1AutomaticProbeSession _automatic;
    private readonly X1ReferenceDiagnosticSession _diagnostic;
    private X1Control? _diagnosticRequested;
    private bool _cameraPreparing;
    private readonly System.Collections.Generic.List<X1ReferenceDiagnosticReport> _cameraReports = new();
    private X1CameraRelativeProfile? _cameraProfile;
    private X1CalibrationPose? _cameraPreparationOrigin;
    private X1CameraPreparationReport? _lastCameraAttempt;
    private X1ReferenceDiagnosticReport? _cameraAttemptPriorDiagnostic;
    private readonly X1CameraFeedbackSession _feedback;
    private readonly System.Collections.Generic.Dictionary<string,X1CameraFeedbackReport> _segmentReports=new();
    private void CaptureSegmentReport()
    {
        var report=_feedback.LastReport;
        if(report?.Path!=null && _showPathOwner==report.Path.PackageId+":"+report.Path.ClientLoadId)
            _segmentReports[report.Path.EventId]=report;
    }
    private (double X, double Z)? _followRequested;
    private X1CameraPathPlan? _pathRequested;
    private string? _showPathOwner;
    private Action? _showPathCheck;
    private Func<bool>? _showPathOtherBusy;
    private Action? _queuedShowStart;
    public Func<Action>? CaptureReviewedShowStart { private get; set; }
    public Func<Action>? CaptureStageReview { private get; set; }
    public Func<Action>? CaptureStageConfirmation { private get; set; }
    public Action? CancelStageReview { private get; set; }
    public Action<X1CalibrationPose>? ObserveStageReview { private get; set; }
    public StageManualMode ManualMode { get; private set; } = StageManualMode.Interrupt;
    public string ManualModeDescription => ManualMode==StageManualMode.Interrupt
        ? "手动打断自动：实际人工输入即取消本场，松键不恢复；重新准备、审阅、确认、明确开始。"
        : "手动与自动协同：只接受列出的独立移动键；自动键先释放。全松停稳250毫秒且距原时钟位置≤2.5厘米（还受原死区限制）才继续；偏离原容差或错过路点停止，不追赶、不补时。同键、鼠标、手柄不支持协同。";
    public string CooperativeKeysDescription
    {
        get { var game=_read(); var keys=StageManualControl.SupportedKeys(game.Bindings);
            return keys.Length==0 ? "当前键位没有可安全协同的独立移动键；协同开始被拒绝" : string.Join("、",keys.Select(KeyLabel)); }
    }
    public void CheckStageMappingReady()
    {
        CheckReadyForExecution(false);
        var error=_cameraProfile?.IdentityError(ReadReferenceObservation(), _locomotionSwitcher != null) ?? "本轮镜头响应尚未完成";
        if(error.Length!=0)throw new InvalidOperationException(error);
    }

    /// <summary>按段自动切换走/跑（TASK-20260919-PATH-LOCOMOTION）：Plugin 框架线程接线后生效；
    /// 未接线时全部走旧口径（实际步态须与申报一致，不自动切换）。</summary>
    public X1LocomotionSwitcher? LocomotionSwitcher
    {
        get => _locomotionSwitcher;
        set
        {
            if (_locomotionSwitcher != null && _locomotionSwitcher.Switched)
                throw new InvalidOperationException("步态切换进行中不能替换切换器；请先停止并恢复");
            _locomotionSwitcher = value;
        }
    }
    private X1LocomotionSwitcher? _locomotionSwitcher;
    /// <summary>校准（prepare）完成时的步行状态；供登记工厂执行「含跑步段须按最快档校准」就绪规则。</summary>
    public bool? CalibrationWhileWalking => _cameraProfile?.CalibratedWhileWalking;

    public void CheckReadyForShowPath(X1CameraPathPlan path, Func<bool> otherBusy)
    {
        CheckShowRunAdmission();
        CheckReadyForExecution(false);
        var game = _read();
        var observation = ReferenceObservation(game, _monitor.Snapshot()) with { Safe = game.Safe && !otherBusy() };
        if (_cameraProfile == null) throw new InvalidOperationException("请先在游戏内 prepare，取得本轮三键镜头响应");
        var error = _cameraProfile.IdentityError(observation, _locomotionSwitcher != null);
        if (error.Length != 0) throw new InvalidOperationException(error);
        if(ManualMode==StageManualMode.Cooperate && StageManualControl.SupportedKeys(game.Bindings).Length==0)
            throw new InvalidOperationException("当前键位没有与自动三键分离的手动移动键，不能安全协同；请明确选择打断模式");
        path.CheckStart(observation, _locomotionSwitcher != null);
    }
    public void ArmShowPath(string owner, X1CameraPathPlan path, Action check, Func<bool> otherBusy)
    {
        CheckReadyForShowPath(path,otherBusy); check();
        AcquireOutputOwnership();
        try
        {
            _monitor.SetCooperativeKeys(ManualMode==StageManualMode.Cooperate ? StageManualControl.SupportedKeys(_read().Bindings) : Array.Empty<byte>());
            if (!_monitor.TryArm(out var reason)) throw new InvalidOperationException(reason);
            _showPathOwner=owner;_showPathCheck=check;_showPathOtherBusy=otherBusy;
            _segmentReports.Clear();
            _executionArmed=true;_executionOwner=owner;_executionNeedsMovement=false;
        }
        catch { _outputLease?.Dispose();_outputLease=null;throw; }
    }
    public void CheckShowPath(string owner)
    {
        if (_showPathOwner!=owner || !_executionArmed || _outputLease?.IsCurrent!=true || HasCleanupFailure)
            throw new InvalidOperationException("路径演出输入身份或清理状态已失效");
        _showPathCheck!();
        if (_showPathOtherBusy!()) throw new InvalidOperationException("其他播放、录制或技能试验正在运行");
        var observation=ReadReferenceObservation();
        if(_locomotionSwitcher?.ExpectedIsWalking is bool expectedWalking && observation.Reference.IsWalking!=expectedWalking)
            throw new InvalidOperationException("本场自动切换后步态被改变，停止本场");
        if(observation.Input.ManualTakeover && _feedback.Active)
        {
            _feedback.StopForManual(observation.Pose.TimeMs);
            throw new InvalidOperationException(_feedback.Message);
        }
        var error=_cameraProfile?.CheckCurrent(observation, allowCooperativeMovement: ManualMode==StageManualMode.Cooperate && _feedback.Active, ignoreWalkingIdentity: _locomotionSwitcher != null) ?? "本轮镜头方向配置已失效";
        if(error.Length!=0)throw new InvalidOperationException(error);
    }
    internal GameOutputLease ShowPathLease(string owner) { CheckShowPath(owner);return _outputLease!; }
    public void BeginShowPath(string owner, X1CameraPathPlan path, long startMonoMs)
    {
        CheckShowPath(owner);
        // TASK-20260919-PATH-LOCOMOTION：每段开始前把实际步态切到本段申报档（读取→写→回读验证，失败即停场）。
        _locomotionSwitcher?.Ensure(path.Locomotion == X1Locomotion.Walk);
        if(ManualMode==StageManualMode.Cooperate)_monitor.ActivateCooperation();
        _feedback.BeginPath(_cameraProfile!,ReadReferenceObservation(),path,startMonoMs,ManualMode==StageManualMode.Cooperate,_locomotionSwitcher != null);
    }
    public (bool Active, bool Completed, string Message) TickShowPath(string owner)
    {
        CheckShowPath(owner);_feedback.Tick(ReadReferenceObservation());_status=_feedback.Message;
        CaptureSegmentReport();
        if(!_feedback.Active)_monitor.SetCooperativeKeys(ManualMode==StageManualMode.Cooperate?StageManualControl.SupportedKeys(_read().Bindings):Array.Empty<byte>());
        return (_feedback.Active,_feedback.LastReport?.Completed==true,_feedback.Message);
    }
    public void StopShowPath(string owner)
    {
        if (_showPathOwner!=owner)return;
        // StopCore retains a cleanup failure; no automatic reattempt on the next frame.
        StopCore("本人停止或有界路径演出结束");
    }
    private readonly Func<(ShowPackage Package, Action CheckCurrent, string PackageId, string ClientLoadId)>? _readRegisteredPath;
    private X1KeyBindings? _bindings;
    private uint? _registeredMovementMode;
    private X1MovementReferenceSnapshot? _registeredReference;
    private long _sampleSequence, _waitUntil, _neutralDeadline, _enabledAt;
    private long _sampleFocusSequence, _sampleInjectedSequence, _focusSequence;
    private bool _hadSample, _takeoverProbe, _executionArmed, _awaitingNeutral, _cleanupFailed, _idleTextPaused;
    private string _status = "未开启输入准备；演出技能／走位／朝向准入关闭";
    private string? _executionOwner;
    private bool _automaticRequested, _executionNeedsMovement = true, _physicalTakeoverObserved;
    public X1InputCalibration Calibration { get; } = new();
    public bool Enabled => _monitor.Snapshot().Enabled;
    // 技能只借用本人已经开启的观察，不武装移动、不自动登记。
    public X1PhysicalInputSnapshot ReadSkillInput()
    {
        if (HasPreparationInputClaim || _executionArmed || _takeoverProbe || Calibration.Pending.HasValue
            || HasCleanupFailure || _keys.AnyHeld || _externalOutputCleanupFailed?.Invoke() == true)
            throw new InvalidOperationException("其他输入操作或未完成清理阻止技能演出");
        var input = _monitor.Snapshot();
        if (!input.Enabled || !input.Healthy || !input.Foreground || input.Armed || input.ManualTakeover
            || input.AnyPhysicalHeld || !input.NeutralEstablished)
            throw new InvalidOperationException("请先在游戏内 /choreo x1 observe，保持游戏前台并松开按键；技能演出不自动开启输入观察");
        return input;
    }
    private bool HasPreparationInputClaim => _queuedShowStart != null || _automaticRequested || _automatic.OwnsInput
        || _cameraPreparing || _diagnosticRequested.HasValue || _diagnostic.OwnsInput
        || _followRequested.HasValue || _pathRequested != null || _feedback.OwnsInput
        || _facingCandidate != null || _stationaryFacing.Active || _activeTakeoverRequested || _takeoverCountdown.Active;
    private bool HasCleanupFailure => _cleanupFailed || _automatic.CleanupFailed || _diagnostic.CleanupFailed || _feedback.CleanupFailed;

    /// <summary>普通演出与 X1 共用的只读就绪/开演前置；不以代释放另一位 owner 取得输入权。</summary>
    public void CheckShowRunAdmission()
    {
        CheckShowInputCleanup();
        if (_externalOutputCleanupFailed?.Invoke() == true) throw new InvalidOperationException("预览清理失败，请 /choreo stop 明确重试");
        if (_executionArmed || _keys.AnyHeld)
            throw new InvalidOperationException("共享输入仍被持有，请先明确停止并确认清理");
    }

    // 单技能试验只借用当前健康全松观察，不允许借另一输出持有者取得许可。
    public string? CheckIsolatedAbilitySafety()
    {
        if (HasPreparationInputClaim || _executionArmed || _takeoverProbe || Calibration.Pending.HasValue)
            return "准备、朝向观察、接管检测或演出仍占用本机输入";
        if (HasCleanupFailure || _keys.AnyHeld) return "输入持有或清理失败尚未解除";
        var input = _monitor.Snapshot();
        if (!input.Enabled || !input.Healthy || !input.Foreground || input.Armed || input.ManualTakeover
            || input.AnyPhysicalHeld || !input.NeutralEstablished)
            return "先开启 observe 并确认新鲜前台全松；单技能试验不猜测输入状态";
        var game = _read();
        if (!game.Safe) return game.Reason;
        if (_bindings == null || !Calibration.Matches(game.Bindings, game.Pose) || !ReferenceIdentityMatches(game))
            return "当前角色、键位、移动模式或步态与本轮观察不一致";
        return null;
    }

    /// <summary>生产演出的共享按键清理只能触碰自己的执行输入；准备/诊断/反馈由 Stop 自行清理。</summary>
    public void CheckShowInputCleanup()
    {
        if (HasCleanupFailure) throw new InvalidOperationException("输入清理已锁定，请先 /choreo x1 off 明确重试；演出不能代为重试");
        if (HasPreparationInputClaim) throw new InvalidOperationException("输入属于准备、诊断或坐标反馈，请先 /choreo x1 off 确认停止");
    }

    /// <summary>共享释放失败写入同一清理锁；OnShowStart 的异常清扫不能在同帧再次释放或抹去首次失败。</summary>
    public void ClearShowInputs(Action clear)
    {
        CheckShowInputCleanup();
        try { clear(); }
        catch { _cleanupFailed = true; throw; }
    }

    public X1InputPreparation(Func<X1GameInputSnapshot> read, Func<bool> busy, X1OsKeyWriter keys, Action<string> notify,
        Func<object?>? abilityObservation = null, Func<(ShowPackage Package, Action CheckCurrent, string PackageId, string ClientLoadId)>? readRegisteredPath = null,
        Func<object?>? abilityReadReport = null, Func<object?>? abilityTrialReport = null, GameOutputOwnership? outputOwnership = null, Func<bool>? externalOutputCleanupFailed = null)
    {
        _read = read; _busy = busy; _keys = keys; _notify = notify;
        _outputOwnership = outputOwnership ?? new GameOutputOwnership();
        _externalOutputCleanupFailed = externalOutputCleanupFailed;
        _abilityObservation = abilityObservation;
        _abilityReadReport = abilityReadReport;
        _abilityTrialReport = abilityTrialReport;
        _readRegisteredPath = readRegisteredPath;
        _automatic = new X1AutomaticProbeSession(Calibration, PressProbeControl, _keys.ReleaseAll, () => _keys.AnyHeld, ReadAutomaticObservation);
        _diagnostic = new X1ReferenceDiagnosticSession(PressDiagnosticControl, _keys.ReleaseAll, () => _keys.AnyHeld, ReadReferenceObservation);
        _feedback = new X1CameraFeedbackSession(PressFeedbackControl, _keys.ReleaseAll, () => _keys.AnyHeld, ReadReferenceObservation);
    }

    public void HandleCommand(string args)
    {
        try
        {
            ReleaseOutputOwnershipIfStopped();
            var command = args.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var verb = command.FirstOrDefault()?.ToLowerInvariant() ?? "status";
            if (verb == "off") { Stop(); _notify(_status); return; }
            if (verb == "status") { _notify(_status + "；" + Calibration.Message); return; }
            if (_automaticRequested || _automatic.OwnsInput || _diagnosticRequested.HasValue || _diagnostic.OwnsInput
                || _followRequested.HasValue || _pathRequested != null || _feedback.OwnsInput
                || _facingCandidate != null || _stationaryFacing.Active || _activeTakeoverRequested || _takeoverCountdown.Active)
                throw new InvalidOperationException("自动响应准备正在占用输入，请先 /choreo x1 off 取消；status 可查看");
            if (_cleanupFailed && verb != "observe") throw new InvalidOperationException("清理未确认，请先 /choreo x1 off 明确重试");
            if (_executionArmed) throw new InvalidOperationException("当前演出仍持有输入，请先通过演出停止并确认清理");
            if (_busy()) throw new InvalidOperationException("请先停止当前播放、演出或录制");
            if (verb == "mode")
            {
                if(command.Length!=2 || command[1] is not ("cooperate" or "interrupt")) throw new InvalidOperationException("模式：mode cooperate 或 mode interrupt");
                if(_queuedShowStart!=null) throw new InvalidOperationException("旧请求尚在等待；先停止取消，再切换模式");
                var mode=command[1]=="cooperate" ? StageManualMode.Cooperate : StageManualMode.Interrupt;
                if(mode!=ManualMode) { CancelStageReview?.Invoke(); ManualMode=mode; }
                _status=ManualModeDescription; _notify(_status); return;
            }
            if (verb == "show-start")
            {
                if (command.Length != 1 || _queuedShowStart != null || CaptureReviewedShowStart == null || _cameraProfile == null)
                    throw new InvalidOperationException("先在网页审阅并登记单路径，再在游戏 prepare；每次只开始一遍");
                _queuedShowStart=CaptureReviewedShowStart();
                _monitor.RequireNeutral();_awaitingNeutral=true;_neutralDeadline=Environment.TickCount64+10000;
                _notify("已请求一次已审阅路径；退出文字输入并全松后按演出时钟倒数3秒。起点不符则停止，不移动路径或追赶起点。");
                return;
            }
            if (verb is "show-review" or "show-confirm")
            {
                if(command.Length!=1 || _queuedShowStart!=null || _cameraProfile==null)
                    throw new InvalidOperationException("先登记路径并完成本次 prepare，再在游戏内审阅与确认");
                var capture=verb=="show-review"?CaptureStageReview:CaptureStageConfirmation;
                _queuedShowStart=capture?.Invoke() ?? throw new InvalidOperationException("映射入口不可用");
                _monitor.RequireNeutral();_awaitingNeutral=true;_neutralDeadline=Environment.TickCount64+10000;
                _notify("退出文字输入并全松后处理本次映射；不会移动角色或开始路径。");return;
            }
            if (verb == "takeover-active")
            {
                if (command.Length != 1) throw new InvalidOperationException("在途接管只需 takeover-active；先重新 prepare");
                if (_cameraProfile == null || _bindings == null || !Enabled)
                    throw new InvalidOperationException("先 prepare 取得当轮完整响应，再开始独立在途接管");
                if (HasCleanupFailure || _keys.AnyHeld) throw new InvalidOperationException("持键或清理失败未解除，请明确 off");
                _activeTakeover.Cancel("本人明确开始独立在途接管", Environment.TickCount64);
                _feedbackOwnerId = Guid.NewGuid().ToString("D"); _captureFeedbackTakeover = false;
                AcquireOutputOwnership();
                _diagnosticTakeover = true; _activeTakeoverRequested = true;
                _monitor.Disarm(); _monitor.RequireNeutralSnapshot(); _takeoverProbe = false;
                _awaitingNeutral = true; _idleTextPaused = false; _neutralDeadline = Environment.TickCount64 + 10000;
                _status = "退出文字输入并全松后，游戏内倒数3、2、1；在“现在”轻点左Shift并松开。只短按一次前进150ms，累计仍限1.25米；错过即不通过，不自动再试";
                _notify(_status); return;
            }
            if (verb == "path")
            {
                if (command.Length != 2 || _readRegisteredPath == null)
                    throw new InvalidOperationException("路径试验需当前已登记包及明确事件标识：path <eventId>");
                if (_cameraProfile == null || _bindings == null || !Enabled)
                    throw new InvalidOperationException("先 prepare 取得本次完整镜头响应；不能使用历史报告");
                var registered = _readRegisteredPath();
                if(StageShowContract.IsStage(registered.Package))
                    throw new InvalidOperationException("网页路径须经 show-review、show-confirm、show-start；不能绕过映射确认或演出时钟");
                var plan = new X1CameraPathPlan(registered.Package, command[1], registered.CheckCurrent, registered.PackageId, registered.ClientLoadId);
                var game = _read();
                if (!game.Safe && !game.TextInput) throw new InvalidOperationException(game.Reason);
                plan.CheckStart(ReferenceObservation(game, _monitor.Snapshot()));
                AcquireOutputOwnership();
                _monitor.Disarm(); _monitor.RequireNeutral(); _takeoverProbe = false;
                _pathRequested = plan; _awaitingNeutral = true; _idleTextPaused = false;
                PrepareFeedbackEvidence();
                _neutralDeadline = Environment.TickCount64 + 10000;
                _status = "等候退出文字输入并全松后，只执行登记路径「" + plan.EventId
                    + "」的原采样点和时间；4秒/1.5米上限，保留原容差，到时不追赶，不启动整场";
                _notify(_status); return;
            }
            if (verb == "follow")
            {
                if (command.Length != 3
                    || !double.TryParse(command[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var x)
                    || !double.TryParse(command[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var z)
                    || !double.IsFinite(x) || !double.IsFinite(z))
                    throw new InvalidOperationException("短目标需明确世界坐标 X Z；例如 follow <X> <Z>，不猜相对方向");
                if (_cameraProfile == null || _bindings == null || !Enabled)
                    throw new InvalidOperationException("先 prepare 取得本次完整镜头方向响应，不能沿用历史或半套数据");
                var game = _read();
                if (!game.Safe && !game.TextInput) throw new InvalidOperationException(game.Reason);
                if (X1MovementExecutor.Distance(game.Pose.X, game.Pose.Z, x, z) > X1CameraFeedbackPolicy.MaxTotalDistanceM)
                    throw new InvalidOperationException("本次坐标反馈短目标限1.5米；完整路径和独立朝向仍未开放");
                _monitor.Disarm(); _monitor.RequireNeutral(); _takeoverProbe = false;
                AcquireOutputOwnership();
                _followRequested = (x, z); _awaitingNeutral = true; _idleTextPaused = false;
                PrepareFeedbackEvidence();
                _neutralDeadline = Environment.TickCount64 + 10000;
                _status = "等待退出文字输入并全松后，按真实坐标误差追踪明确短目标；最长4秒，累计限1.5米，到达容差0.12米";
                _notify(_status); return;
            }
            if (verb is "observe" or "prepare" or "diagnose" or "facing-observe")
            {
                X1Control? diagnosticControl = null;
                if (verb == "facing-observe" && (command.Length != 2 || command[1].Length > 80))
                    throw new InvalidOperationException("朝向只读观察需明确候选标签：facing-observe <标签>；不输出按键");
                if (verb == "diagnose")
                {
                    if (command.Length != 2 || !TryControl(command[1], out var selected)
                        || selected is not (X1Control.Forward or X1Control.TurnLeft or X1Control.TurnRight))
                        throw new InvalidOperationException("参考诊断需明确 forward、turnleft 或 turnright；只短按这一键，不采用校准");
                    diagnosticControl = selected;
                }
                Stop();
                var game = _read();
                // 命令提交帧文本焦点可能尚未退出；只接受随后全松且文字输入关闭的帧。
                if (!game.Safe && !game.TextInput) throw new InvalidOperationException(game.Reason);
                if (verb == "prepare" && !game.MovementMode.HasValue)
                    throw new InvalidOperationException("实际移动模式不可读，暂不能自动短测；不猜默认模式");
                var cameraPreparation = verb == "prepare" && game.MovementMode == 1;
                if (cameraPreparation) diagnosticControl = X1Control.Forward;
                if (diagnosticControl.HasValue && (!game.MovementMode.HasValue || game.MovementReference?.Readable != true))
                    throw new InvalidOperationException("镜头、步行状态或实际移动模式不可读，不能短按诊断");
                StartFreshObservation(game);
                if (verb == "prepare" || diagnosticControl.HasValue) AcquireOutputOwnership();
                _automaticRequested = verb == "prepare" && !cameraPreparation;
                _facingCandidate = verb == "facing-observe" ? command[1] : null;
                _cameraPreparing = cameraPreparation;
                _cameraPreparationOrigin = cameraPreparation ? game.Pose : null;
                _cameraAttemptPriorDiagnostic = cameraPreparation ? _diagnostic.LastReport : null;
                _diagnosticRequested = diagnosticControl;
                _physicalTakeoverObserved = false;
                _status = _facingCandidate != null ? "等待退出文字输入并全松；随后只读观察身体朝向15秒，不输出或采用控制配置"
                    : cameraPreparation ? "等待全松后自动记录前进、左转、右转的镜头参考响应；整套成立才采用，不修改设置"
                    : diagnosticControl.HasValue ? "等待退出文字输入并全松键后，短按" + Label(diagnosticControl.Value) + "并逐帧记录；仅诊断、不采用校准"
                    : _automaticRequested
                    ? "正在准备自动短测，请退出文字输入并松开全部按键；保持游戏前台，本人输入会取消"
                    : "正在观察物理输入，请退出文字输入并松开全部按键；不代按、不读取聊天内容";
                _notify((_automaticRequested ? "即将自动短测前进和转向响应；请留在游戏并松开全部按键，无需手动校准。" : "")
                    + _status + "。实际键位：" + string.Join("，", Enum.GetValues<X1Control>().Select(c => Label(c) + "=" + KeyLabel(game.Bindings[c]))));
                return;
            }
            if (verb == "calibrate" && command.Length == 2 && TryControl(command[1], out var control))
            {
                if (_bindings == null || !Enabled) throw new InvalidOperationException("先 /choreo x1 observe 登记游戏实际键位");
                var current = _read();
                if (!current.MovementMode.HasValue || current.MovementMode != _registeredMovementMode)
                    throw new InvalidOperationException("实际移动模式变化或不可读，不能在旧登记中手动采样");
                if (_bindings[control] == 0) throw new InvalidOperationException(Label(control) + "没有绑定；保留当前键位，不能采样该方向");
                _monitor.Disarm(); _monitor.RequireNeutral(); _takeoverProbe = false; _awaitingNeutral = true;
                _idleTextPaused = false;
                _sampleInjectedSequence = _monitor.Snapshot().InjectedChangeSequence;
                Calibration.Begin(control); _hadSample = false;
                _waitUntil = Environment.TickCount64 + 15000; _neutralDeadline = Environment.TickCount64 + 3000;
                _status = "退出文字输入并松键后，单独按 " + KeyLabel(_bindings[control]) + "（" + Label(control) + "）约 0.1–0.3 秒再松开";
                _notify(_status + "；本次只测量，走远或长按会作废"); return;
            }
            if (verb == "takeover")
            {
                if (command.Length != 1) throw new InvalidOperationException("被动接管检测只需 /choreo x1 takeover，不需要其它参数");
                // 这一命令只免去 observe 的人工前置；失败锁不能借新建观察隐式重试。
                if (HasCleanupFailure) throw new InvalidOperationException("清理未确认，请先 /choreo x1 off 明确重试");
                if (_keys.AnyHeld) throw new InvalidOperationException("仍有未确认释放的持键，请先 /choreo x1 off；被动检测不代为释放");
                if (!Enabled)
                {
                    Stop(); // 原有关闭链确认旧线程/钩子退出；失败即抛出，不启新线程。
                    var game = _read();
                    if (!game.Safe && !game.TextInput) throw new InvalidOperationException(game.Reason);
                    StartFreshObservation(game);
                }
                _passiveTakeover.Cancel("本人明确开始新检测", Environment.TickCount64);
                _monitor.Disarm(); _monitor.RequireNeutralSnapshot(); _awaitingNeutral = true; Calibration.Cancel("准备验证物理接管，不输出任何动作");
                _idleTextPaused = false;
                _takeoverProbe = true; _neutralDeadline = Environment.TickCount64 + 3000;
                _waitUntil = Environment.TickCount64 + 15000;
                _status = "被动观察已建立；退出文字输入并松开全部按键后，等待接管检测就绪提示；不输出按键";
                _notify(_status); return;
            }
            _notify("/choreo x1 prepare 自动准备三键方向；follow <世界X> <世界Z> 坐标短测；path <事件标识> 试当前登记的4秒/1.5米采样路径；diagnose forward|turnleft|turnright 单键诊断；observe 只观察；takeover 检查本人接管；ability <动作编号> <目标编号> <职业编号> <最低等级> 只读技能条件；status 查看；off 明确停止/重试清理");
        }
        catch (Exception error) { _status = error.Message; _notify("输入准备未执行：" + _status); }
        finally { ReleaseOutputOwnershipIfStopped(); }
    }

    // observe 与未开启观察时的 takeover 共用同一初始化；这里只登记真实输入，不武装、不按键。
    private void StartFreshObservation(X1GameInputSnapshot game)
    {
        _bindings = game.Bindings; _keys.Configure(_bindings);
        _registeredMovementMode = game.MovementMode;
        _registeredReference = game.MovementReference;
        Calibration.Reset(_bindings, game.Pose);
        _enabledAt = Environment.TickCount64;
        _monitor.Enable(_bindings.CopyKeys().Where(k => k != 0));
        _neutralDeadline = Environment.TickCount64 + 10000;
        _focusSequence = _monitor.Snapshot().FocusLossSequence;
        _awaitingNeutral = true;
        _physicalTakeoverObserved = false; _diagnosticTakeover = false;
    }

    public void Tick()
    {
        if (_cleanupFailed) return; // 失败锁住；只有本人 off/observe 明确请求才再次清理。
        if (!Enabled) return;
        try
        {
            var input = _monitor.Snapshot();
            if (!input.Healthy && input.Failure == "物理输入观测正在准备"
                && Environment.TickCount64 - _enabledAt <= X1ManualTakeoverPolicy.HeartbeatLeaseMs) return;
            if (!input.Healthy) throw new InvalidOperationException(input.Failure.Length > 0 ? input.Failure : "物理输入观测不可用");
            if (input.FocusLossSequence != _focusSequence)
                throw new InvalidOperationException("曾离开游戏前台，本次输入准备作废，请重新 observe");
            var game = _read();
            ObserveStageReview?.Invoke(game.Pose);
            if (_queuedShowStart != null)
            {
                if (Environment.TickCount64 > _neutralDeadline || _busy()) throw new InvalidOperationException("本次路径开始等待超时或其他输出已开始");
                if (game.TextInput || input.AnyPhysicalHeld || !input.NeutralEstablished) return;
                var start=_queuedShowStart;_queuedShowStart=null;_awaitingNeutral=false;
                start();return;
            }
            if (_showPathOwner != null) { CheckShowPath(_showPathOwner); return; }
            if (_facingCandidate != null || _stationaryFacing.Active)
            {
                if (_facingCandidate is { } candidate)
                {
                    if (Environment.TickCount64 > _neutralDeadline) throw new InvalidOperationException("朝向只读观察等待全松超时");
                    if (game.TextInput || !input.NeutralEstablished || input.AnyPhysicalHeld) return;
                    _stationaryFacing.Begin(candidate, FacingObservation(game, input));
                    _facingCandidate = null; _awaitingNeutral = false;
                    _status = "朝向只读观察已就绪，记录接下来15秒实际身体角度与坐标；输入不由插件输出";
                    _notify(_status); return;
                }
                _stationaryFacing.Observe(_stationaryFacing.Generation, FacingObservation(game, input));
                _status = _stationaryFacing.LastReport!.Status;
                if (!_stationaryFacing.Active) _notify(_status);
                return;
            }
            if (_passiveTakeover.Active)
            {
                _passiveTakeover.Observe(TakeoverFrame(game, input, false));
                if (_passiveTakeover.Stage == X1TakeoverEvidenceStage.AwaitNeutralReset)
                {
                    _monitor.Disarm();
                    var resetGame = _read();
                    _passiveTakeover.RecordNeutralReset(TakeoverFrame(resetGame, _monitor.RequireNeutralSnapshot(), false));
                    _takeoverProbe = false; _awaitingNeutral = true; _neutralDeadline = Environment.TickCount64 + 3000;
                }
                _status = _passiveTakeover.Report!.Status;
                if (_passiveTakeover.Report.Completed) { _physicalTakeoverObserved = true; _notify(_status); }
                if (_passiveTakeover.Active) return;
                if (_passiveTakeover.Stage == X1TakeoverEvidenceStage.Failed)
                {
                    _monitor.Disarm(); _monitor.RequireNeutral(); _takeoverProbe = false;
                    _awaitingNeutral = true; _neutralDeadline = Environment.TickCount64 + 3000;
                    _notify(_status); return;
                }
            }
            if (_activeTakeover.Active)
            {
                _activeTakeover.Observe(TakeoverFrame(game, input, true));
                if (_activeTakeover.Report is { Completed: true })
                { _physicalTakeoverObserved = true; _status = _activeTakeover.Report.Status; _notify(_status); }
            }
            if (_cameraPreparing && !ReferenceIdentityMatches(game))
                throw new InvalidOperationException("整套准备期间镜头或步行模式改变/不可读，响应作废");
            if (_cameraProfile != null && !ReferenceIdentityMatches(game))
            {
                _cameraProfile = null;
                if (_followRequested.HasValue || _pathRequested != null || _feedback.OwnsInput)
                    throw new InvalidOperationException("镜头或步行模式变化，本次坐标控制配置已永久作废，请重新准备");
            }
            if (_takeoverCountdown.Active)
            {
                var cue = _takeoverCountdown.Advance(ReferenceObservation(game, input));
                _status = _takeoverCountdown.Status;
                if (cue != null) _notify(cue);
                if (_takeoverCountdown.Ready)
                {
                    _diagnostic.Begin(X1Control.Forward, ReferenceObservation(game, input));
                    _diagnostic.Tick(ReferenceObservation(game, input));
                    if (!_diagnostic.Active || !_keys.AnyHeld)
                        throw new InvalidOperationException("独立接管未建立真实持键：" + _diagnostic.Message);
                    _activeTakeover.Begin(X1TakeoverEvidenceKind.ActiveOwnedKeyRelease, TakeoverFrame(_read(), _monitor.Snapshot(), true));
                }
                return;
            }
            if (_feedback.OwnsInput)
            {
                _feedback.Tick(ReferenceObservation(game, input)); _status = _feedback.Message;
                if (_activeTakeover.Stage == X1TakeoverEvidenceStage.AwaitRelease)
                    _activeTakeover.ConfirmRelease(TakeoverFrame(_read(), _monitor.Snapshot(), true));
                if (_captureFeedbackTakeover && _feedback.Active && _keys.AnyHeld)
                {
                    _captureFeedbackTakeover = false;
                    _activeTakeover.Begin(X1TakeoverEvidenceKind.ActiveOwnedKeyRelease, TakeoverFrame(_read(), _monitor.Snapshot(), true));
                }
                if (!_feedback.Active)
                {
                    _monitor.Disarm(); _cleanupFailed |= _feedback.CleanupFailed;
                    if (!_cleanupFailed)
                    {
                        var resetGame = _read(); var resetInput = _monitor.RequireNeutralSnapshot();
                        _awaitingNeutral = true; _neutralDeadline = Environment.TickCount64 + 3000;
                        _activeTakeover.RecordNeutralReset(TakeoverFrame(resetGame, resetInput, true));
                    }
                    _notify(_status);
                }
                return;
            }
            if (_diagnostic.OwnsInput)
            {
                if (_cameraPreparing && (_cameraPreparationOrigin is not { } activeOrigin
                    || game.Pose.TimeMs - activeOrigin.TimeMs > 10000))
                    _diagnostic.Stop("镜头参考整套准备超过时间上限", game.Pose.TimeMs);
                _diagnostic.Tick(ReferenceObservation(game, input));
                if (_diagnosticTakeover && _activeTakeover.Stage == X1TakeoverEvidenceStage.AwaitRelease)
                    _activeTakeover.ConfirmRelease(TakeoverFrame(_read(), _monitor.Snapshot(), true));
                _status = _diagnostic.Message;
                if (!_diagnostic.Active)
                {
                    if (_diagnostic.CleanupFailed)
                    {
                        _cleanupFailed = true; _cameraPreparing = false; _diagnosticRequested = null;
                        _lastCameraAttempt = new(false, _status, Array.AsReadOnly(_cameraReports
                            .Concat(_diagnostic.LastReport == null ? Array.Empty<X1ReferenceDiagnosticReport>() : new[] { _diagnostic.LastReport }).ToArray()));
                        _monitor.Disarm(); _notify(_status); return; // 释放失败本帧绝不再走 Stop 暗重试。
                    }
                    if (_diagnosticTakeover)
                    {
                        if (_activeTakeover.Stage == X1TakeoverEvidenceStage.AwaitPhysical)
                            _activeTakeover.Cancel("短按已结束，没有真实持键期间的物理输入；本次主动接管未通过", game.Pose.TimeMs);
                        _monitor.Disarm();
                        var resetGame = _read(); var resetInput = _monitor.RequireNeutralSnapshot();
                        _activeTakeover.RecordNeutralReset(TakeoverFrame(resetGame, resetInput, true));
                        _awaitingNeutral = true; _neutralDeadline = Environment.TickCount64 + 3000;
                        _status = _activeTakeover.Report?.Status ?? "独立在途接管未建立证据";
                        _notify(_status); return;
                    }
                    if (_cameraPreparing)
                    {
                        var report = _diagnostic.LastReport;
                        if (_diagnostic.CleanupFailed || _diagnostic.OwnsInput || report?.Completed != true)
                            throw new InvalidOperationException("镜头参考整套准备未采用：" + _diagnostic.Message);
                        _cameraReports.Add(report);
                        _lastCameraAttempt = new(false, "整套尚未采用", Array.AsReadOnly(_cameraReports.ToArray()));
                        if (_cameraReports.Sum(r => r.TotalDistanceM) > 3
                            || _cameraPreparationOrigin is not { } origin || game.Pose.TimeMs - origin.TimeMs > 10000)
                            throw new InvalidOperationException("镜头参考准备超过整套位移或时间上限，未采用");
                        if (_cameraReports.Count < 3)
                        {
                            if (_cameraReports.Sum(r => r.TotalDistanceM) + X1ReferenceDiagnosticSession.MaxDistanceM > 3)
                                throw new InvalidOperationException("剩余位移预算不足以安全执行下一项响应，整套未采用");
                            _diagnosticRequested = _cameraReports.Count == 1 ? X1Control.TurnLeft : X1Control.TurnRight;
                        }
                        else
                        {
                            var current = ReadReferenceObservation();
                            var candidate = X1CameraRelativeProfile.TryCreate(_cameraReports, current);
                            if (!candidate.Ok || candidate.Profile == null) throw new InvalidOperationException(candidate.Error);
                            _cameraProfile = candidate.Profile; _cameraPreparing = false;
                            _status = "镜头参考三键响应已整套采用；仍须实际坐标到达验证，独立朝向与完整路径未开放";
                            _lastCameraAttempt = new(true, _status, Array.AsReadOnly(_cameraReports.ToArray()));
                        }
                    }
                    _monitor.Disarm(); _cleanupFailed |= _diagnostic.CleanupFailed;
                    if (!_cleanupFailed)
                    { _monitor.RequireNeutral(); _awaitingNeutral = true; _neutralDeadline = Environment.TickCount64 + 3000; }
                    _notify(_status);
                }
                return;
            }
            // 自动短测拥有真实输出，必须先于旧的被动采样/聊天暂停等零输出分支处理。
            if (_automatic.OwnsInput)
            {
                var modeMatches = game.MovementMode.HasValue && game.MovementMode == _registeredMovementMode;
                _automatic.Tick(game.Bindings, game.Pose, input, game.Safe && !_busy() && modeMatches,
                    !game.Safe ? game.Reason : !modeMatches ? "自动短测期间实际移动模式变化或不可读"
                        : "本机播放、录制或演出已开始");
                _status = _automatic.Message;
                if (!_automatic.Active)
                {
                    _monitor.Disarm(); _cleanupFailed |= _automatic.CleanupFailed;
                    if (!_cleanupFailed)
                    { _monitor.RequireNeutral(); _awaitingNeutral = true; _neutralDeadline = Environment.TickCount64 + 3000; }
                    _notify(_status);
                }
                return;
            }
            if (_bindings == null || !Calibration.Matches(game.Bindings, game.Pose))
                throw new InvalidOperationException("角色、地图或键位已变化，需要重新登记");
            if ((_automaticRequested || _diagnosticRequested.HasValue || _followRequested.HasValue || _pathRequested != null || _activeTakeoverRequested) && _busy())
                throw new InvalidOperationException("等待自动短测期间开始播放或录制，本次请求已取消");
            if (_busy() && !_executionArmed) { Calibration.Cancel("开始播放或录制，已取消被动校准"); _monitor.Disarm(); _takeoverProbe = false; return; }
            if (!input.Foreground) throw new InvalidOperationException("游戏离开前台，已作废输入准备；返回后请重新 observe");
            if (_automaticRequested || _diagnosticRequested.HasValue || _followRequested.HasValue || _pathRequested != null || _activeTakeoverRequested)
            {
                _pathRequested?.CheckCurrent(ReferenceObservation(game, input));
                if (_cameraPreparing && _cameraReports.Count != 0
                    && _cameraReports[0].Frames[0].Observation is { } firstResponse
                    && (input.PhysicalChangeSequence != firstResponse.Input.PhysicalChangeSequence
                        || input.ForeignInjectedChangeSequence != firstResponse.Input.ForeignInjectedChangeSequence
                        || input.FocusLossSequence != firstResponse.Input.FocusLossSequence))
                    throw new InvalidOperationException("响应项之间出现本人或外来输入，整套已取消，不能再按下一键");
                if (_cameraPreparing && (_cameraPreparationOrigin is not { } batchOrigin
                    || game.Pose.TimeMs - batchOrigin.TimeMs > 10000))
                    throw new InvalidOperationException("镜头参考整套准备等待超时，未采用");
                if (!game.MovementMode.HasValue || game.MovementMode != _registeredMovementMode)
                    throw new InvalidOperationException("等待自动短测期间实际移动模式变化或不可读，本次请求已取消");
                if (Environment.TickCount64 > _neutralDeadline)
                    throw new InvalidOperationException("自动短测等待退出文字输入和全松键超时，未开始输入");
                if (game.TextInput || !input.NeutralEstablished || input.AnyPhysicalHeld) return;
                if (!game.Safe) throw new InvalidOperationException(game.Reason);
                if (!_monitor.TryArm(out var autoReason)) { _status = autoReason; return; }
                if (_activeTakeoverRequested)
                {
                    if (_cameraProfile == null) throw new InvalidOperationException("本次镜头响应已失效，请重新prepare");
                    _takeoverCountdown.Begin(_cameraProfile, ReferenceObservation(game, _monitor.Snapshot()));
                    _activeTakeoverRequested = false; _awaitingNeutral = false;
                    _status = _takeoverCountdown.Status; _notify(_status); return;
                }
                if (_pathRequested is { } path)
                {
                    if (_cameraProfile == null) throw new InvalidOperationException("本次镜头方向配置已经失效");
                    _feedback.BeginPath(_cameraProfile, ReferenceObservation(game, _monitor.Snapshot()), path);
                    _pathRequested = null; _awaitingNeutral = false;
                    _status = _feedback.Message; _notify(_status); return;
                }
                if (_followRequested is { } target)
                {
                    if (_cameraProfile == null) throw new InvalidOperationException("本次镜头方向配置已经失效");
                    _feedback.Begin(_cameraProfile, ReferenceObservation(game, _monitor.Snapshot()), target.X, target.Z, .12);
                    _followRequested = null; _awaitingNeutral = false;
                    _status = _feedback.Message; _notify(_status); return;
                }
                if (_diagnosticRequested is { } diagnosticControl)
                {
                    _diagnostic.Begin(diagnosticControl, ReferenceObservation(game, _monitor.Snapshot()));
                    _diagnosticRequested = null; _awaitingNeutral = false;
                    _status = _diagnostic.Message; _notify(_status);
                    return;
                }
                _automatic.Begin(game.Bindings, game.Pose, _monitor.Snapshot());
                _automaticRequested = _awaitingNeutral = false;
                _status = _automatic.Message; _notify(_status);
                return;
            }
            if (!_executionArmed && input.Armed && input.ManualTakeover)
            {
                _physicalTakeoverObserved = true;
                _status = "已检测到本人接管；未输出游戏动作"; _notify(_status);
                _monitor.Disarm(); _takeoverProbe = false; return;
            }
            // 已登记且空闲时允许本人重新输入下一条命令，不能沿用开启时的旧超时。
            // 采样、接管检测、执行期间仍用下方严格检查；退出文字输入后须新鲜全松确认。
            if (game.TextInput && !_executionArmed && !Calibration.Pending.HasValue && !_takeoverProbe
                && (_idleTextPaused || !_awaitingNeutral))
            {
                if (!_idleTextPaused) { _monitor.Disarm(); _monitor.RequireNeutral(); }
                _idleTextPaused = _awaitingNeutral = true;
                _neutralDeadline = Environment.TickCount64 + 3000;
                _status = "文字输入期间暂停观察准备；退出并松键后继续";
                return;
            }
            _idleTextPaused = false;
            if (game.TextInput || !input.NeutralEstablished || _awaitingNeutral && input.AnyPhysicalHeld)
            {
                if (Environment.TickCount64 <= _neutralDeadline) return;
                throw new InvalidOperationException(game.TextInput ? "文字输入仍占用，输入准备已取消" : "无法确认全部物理按键松开");
            }
            if (!game.Safe) throw new InvalidOperationException(game.Reason);
            _awaitingNeutral = false;
            if (_executionArmed) return; // 接管锁交给 RuntimeGuard 消费，不能在 ShowRunner.Tick 前清掉。
            if ((Calibration.Pending.HasValue || _takeoverProbe) && Environment.TickCount64 > _waitUntil)
            { Calibration.Cancel("等待按键超时，本次已取消"); _monitor.Disarm(); _takeoverProbe = false; _status = Calibration.Message; return; }
            if (_takeoverProbe)
            {
                if (!input.Armed && !input.AnyPhysicalHeld && _monitor.TryArm(out var reason))
                {
                    _passiveTakeover.Begin(X1TakeoverEvidenceKind.PassiveDetection, TakeoverFrame(_read(), _monitor.Snapshot(), false));
                    _status = "被动接管检测已就绪；本人按键或点击鼠标后再全松，不输出动作，也不代表在途持键释放通过"; _notify(_status);
                }
                return;
            }
            if (Calibration.Pending is { } control)
            {
                if (!game.MovementMode.HasValue || game.MovementMode != _registeredMovementMode)
                    throw new InvalidOperationException("手动采样期间实际移动模式变化或不可读，本次响应作废");
                var bound = _monitor.ReadBoundKey(_bindings[control]); input = bound.Snapshot;
                var held = bound.Held;
                if (!input.Healthy || !input.Foreground || input.FocusLossSequence != _focusSequence)
                    throw new InvalidOperationException("采样输入观测失效，请重新登记");
                if (input.InjectedChangeSequence != _sampleInjectedSequence || _hadSample && input.FocusLossSequence != _sampleFocusSequence)
                { Calibration.Cancel("采样中出现失焦或注入输入，本次作废"); _status = Calibration.Message; _notify(_status); return; }
                if (_hadSample && input.PhysicalChangeSequence != _sampleSequence
                    && (held || input.AnyPhysicalHeld || input.PhysicalChangeSequence != _sampleSequence + 1))
                { Calibration.Cancel("采样期间出现其他物理输入，本次作废"); _status = Calibration.Message; _notify(_status); return; }
                Calibration.Observe(game.Bindings, game.Pose, held, bound.OnlyHeld, input.AnyPhysicalHeld);
                if (Calibration.Sampling && !_hadSample)
                { _sampleSequence = input.PhysicalChangeSequence; _sampleFocusSequence = input.FocusLossSequence;
                  _hadSample = true; }
                if (!Calibration.Pending.HasValue) { _status = Calibration.Message; _notify(_status); }
            }
            else _status = (_feedback.LastReport != null ? _feedback.Message + "；" : "")
                + (_cameraProfile != null ? "镜头参考三键已准备；" : "")
                + (_diagnostic.LastReport != null ? _diagnostic.Message + "；" : "")
                + (_automatic.LastReport is { Complete: false } failed
                    ? "上次自动短测未采用：" + failed.Status + "；" : "")
                + "物理输入观察正常；移动响应 " + Calibration.Samples.Length + "/" + Calibration.RequiredSamples
                + "（" + Calibration.Source + "）；正式演出准入关闭";
        }
        catch (Exception error)
        {
            var reason = error.Message;
            // 清理失败后即使通知等后处理再抛错，也不能绕回 Stop 暗中重试按键释放。
            if (HasCleanupFailure) _cleanupFailed = true;
            else try { StopCore(reason); } catch (Exception cleanupError) { reason += "；" + cleanupError.Message; }
            Calibration.Invalidate(reason); _status = reason;
            _notify("输入准备停止：" + _status);
        }
        finally { ReleaseOutputOwnershipIfStopped(); }
    }

    // 供未来受版本约束的 X1 正式装载使用；普通 motion 演出不因此被额外占有。
    public void CheckExecutionSafety()
    {
        var input = _monitor.Snapshot(); var game = _read();
        if (!_executionArmed || !input.Enabled || !input.Healthy || !input.Foreground || !input.Armed || input.ManualTakeover
            || !game.Safe || _bindings == null || _automaticRequested || _automatic.OwnsInput
            || _diagnosticRequested.HasValue || _diagnostic.OwnsInput
            || _followRequested.HasValue || _pathRequested != null || _feedback.OwnsInput
            || (_executionNeedsMovement && (!Calibration.Complete || !game.MovementMode.HasValue
                || game.MovementMode != _registeredMovementMode)) || !Calibration.Matches(game.Bindings, game.Pose))
            throw new InvalidOperationException("X1 输入登记、校准或物理接管条件未满足");
    }
    public void ApplyGuard(GuardSnapshot snapshot)
    {
        snapshot.AdapterFailure |= HasCleanupFailure || HasPreparationInputClaim && _showPathOwner == null;
        if (!_executionArmed) return;
        var input = _monitor.Snapshot();
        snapshot.ManualTakeover |= input.Armed && input.ManualTakeover;
        snapshot.AdapterFailure |= !input.Enabled || !input.Healthy || !input.Foreground || !input.Armed;
    }
    public void CheckReadyForExecution(bool needsMovementResponse = true)
    {
        var game = _read();
        var input = _monitor.Snapshot();
        if (_automaticRequested || _automatic.OwnsInput || _diagnosticRequested.HasValue || _diagnostic.OwnsInput
            || _followRequested.HasValue || _pathRequested != null || _feedback.OwnsInput)
            throw new InvalidOperationException("自动移动响应准备或参考诊断仍在进行，暂不能就绪演出");
        if (_cleanupFailed || _keys.AnyHeld) throw new InvalidOperationException("上次输入清理未确认，请 /choreo x1 off 明确重试");
        if (_bindings == null || !input.Enabled) throw new InvalidOperationException("尚未由本人开启输入观察，请先在游戏内 /choreo x1 observe");
        if (!input.Healthy || !input.Foreground) throw new InvalidOperationException("物理输入观察不健康或游戏不在前台");
        if (!game.Safe) throw new InvalidOperationException(game.Reason);
        if (!Calibration.Matches(game.Bindings, game.Pose)) throw new InvalidOperationException("角色、区域或键位已变化，请重新登记");
        if (needsMovementResponse && (!game.MovementMode.HasValue || game.MovementMode != _registeredMovementMode))
            throw new InvalidOperationException("移动模式已变化或不可读，现有方向响应不能沿用");
        if (needsMovementResponse && !Calibration.Complete) throw new InvalidOperationException("移动响应尚未准备（" + Calibration.Samples.Length + "/" + Calibration.RequiredSamples + "），请 /choreo x1 prepare 自动短测；无需本人逐键校准");
        if (_awaitingNeutral || !input.NeutralEstablished || input.AnyPhysicalHeld || input.ManualTakeover)
            throw new InvalidOperationException("尚未确认新鲜全松键状态，或本人已接管");
    }
    public void ArmForExecution()
        => ArmForExecution("legacy-native");
    public void ArmForExecution(string owner, bool needsMovementResponse = true)
    {
        if (string.IsNullOrWhiteSpace(owner) || _executionArmed)
            throw new InvalidOperationException("输入执行权仍被持有或缺少场次身份");
        CheckReadyForExecution(needsMovementResponse);
        if (_executionArmed) throw new InvalidOperationException("准备检查期间输入执行权已变化");
        if (!_monitor.TryArm(out var reason)) throw new InvalidOperationException(reason);
        _executionOwner = owner;
        _executionNeedsMovement = needsMovementResponse;
        _executionArmed = true;
    }
    public void CheckExecutionSafety(string owner)
    {
        if (_executionOwner != owner) throw new InvalidOperationException("输入执行权不属于当前场次");
        CheckExecutionSafety();
        if (_executionOwner != owner) throw new InvalidOperationException("安全检查期间输入执行权已变化");
    }
    public void EndExecution() => EndExecution("legacy-native");
    public void EndExecution(string owner)
    {
        if (_executionOwner != owner) return;
        _executionArmed = false; _executionOwner = null; _monitor.Disarm();
    }
    // 面板只取显示字段，不生成 HTTP 诊断 JSON，也不枚举朝向候选。
    internal (bool Preparing, bool Pending, bool OwnsInput, bool CleanupFailed, bool Cooperate, string Keys, string Actor, string Status, string Result) ReadPanelState()
    {
        var game = _read();
        var report = _feedback.LastReport;
        return (_cameraPreparing || _automatic.Active, _queuedShowStart != null, _feedback.OwnsInput,
            HasCleanupFailure, ManualMode == StageManualMode.Cooperate,
            string.Join("、", StageManualControl.SupportedKeys(game.Bindings).Select(KeyLabel)),
            $"角色 #{game.Pose.ActorId} · 区域 {game.Pose.Territory} · ({game.Pose.X:F2}, {game.Pose.Z:F2})",
            _status, report == null ? "" : $"{report.Status} · 手动介入 {report.ManualInterventions} / 续走 {report.ManualResumptions}");
    }

    public string StatusJson()
    {
        X1GameInputSnapshot? game = null; string? error = null;
        try { game = _read(); } catch (Exception e) { error = e.Message; }
        var input = _monitor.Snapshot();
        return JsonSerializer.Serialize(new { protocolVersion = 1, executionEnabled = false, status = _status, cleanupFailed = _cleanupFailed,
            unconfirmedHeldKeys = _keys.AnyHeld,
            outputOwnership = new { inputLeaseHeld = _outputLease?.IsCurrent == true,
                previewCleanupFailed = _externalOutputCleanupFailed?.Invoke() == true,
                exclusiveOwner = _outputOwnership.Snapshot().ExclusiveOwner, legacyLeases = _outputOwnership.Snapshot().LegacyLeases },
            automaticPreparation = new { requested = _automaticRequested, active = _automatic.Active,
                ownsInput = _automatic.OwnsInput, cleanupFailed = _automatic.CleanupFailed,
                lastReport = _automatic.LastReport, lastSuccessfulResult = _automatic.LastSuccessfulResult },
            referenceDiagnostic = new { requested = _diagnosticRequested?.ToString(), active = _diagnostic.Active,
                ownsInput = _diagnostic.OwnsInput, cleanupFailed = _diagnostic.CleanupFailed, lastReport = _diagnostic.LastReport },
            cameraPreparation = new { active = _cameraPreparing, reports = _cameraReports, profile = _cameraProfile, lastAttempt = _lastCameraAttempt },
            coordinateFeedback = new { requested = _followRequested.HasValue, active = _feedback.Active,
                ownsInput = _feedback.OwnsInput, cleanupFailed = _feedback.CleanupFailed, lastReport = _feedback.LastReport,
                reports=_segmentReports.Values.ToArray() },
            stageRequestPending = _queuedShowStart != null,
            stageManual = new { mode=ManualMode.ToString(), description=ManualModeDescription, cooperativeKeys=game==null ? Array.Empty<string>() : StageManualControl.SupportedKeys(game.Bindings).Select(KeyLabel).ToArray(), yielding=_feedback.Yielding },
            registeredPathTrial = new { requested = _pathRequested, sharedWithCoordinateFeedback = true, fullShowExecutionEnabled = false },
            physicalTakeover = new { observedThisSession = _physicalTakeoverObserved, automaticallyVerified = false,
                passiveReport = _passiveTakeover.Report, activeOwnedKeyReport = _activeTakeover.Report,
                dedicatedTrial = new { requested = _activeTakeoverRequested, countdown = _takeoverCountdown.Report,
                    diagnosticOwner = _diagnosticTakeover, pressMs = X1ReferenceDiagnosticSession.PressMs,
                    maximumDistanceM = X1ReferenceDiagnosticSession.MaxDistanceM } },
            lastNativeAbilityObservation = _abilityObservation?.Invoke(),
            lastAbilityReadReport = _abilityReadReport?.Invoke(),
            lastAbilityTrial = _abilityTrialReport?.Invoke(),
            stationaryFacing = new { requested = _facingCandidate, active = _stationaryFacing.Active, lastReport = _stationaryFacing.LastReport },
            gameReadable = game != null, gameSafe = game?.Safe ?? false, gameReason = error ?? game?.Reason,
            actor = game == null ? null : new { id = game.Pose.ActorId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                territoryId = game.Pose.Territory, worldX = game.Pose.X, worldZ = game.Pose.Z, rotationRad = game.Pose.RotationRad },
            textInput = game?.TextInput, gamepadActive = game?.GamepadActive,
            movementMode = game?.MovementMode,
            movementReference = game?.MovementReference,
            facingBindingCandidates = X1FacingBindingReader.Read(),
            allDirectionsBound = game?.Bindings.HasAllDirections ?? false,
            bindings = game == null ? null : Enum.GetValues<X1Control>().Select(c => new { control = c.ToString(), name = Label(c), key = KeyLabel(game.Bindings[c]), assigned = game.Bindings[c] != 0 }),
            input = new { input.Enabled, input.Healthy, input.Foreground, input.Armed, input.ManualTakeover, input.AnyPhysicalHeld, input.PhysicalChangeSequence, input.ForeignInjectedChangeSequence, input.NeutralEstablished, input.Failure },
            calibration = new { completedSamples = Calibration.Samples.Length, complete = Calibration.Complete,
                source = Calibration.Source,
                requiredSamples = Calibration.RequiredSamples, turnThenMove = Calibration.RequiresTurnThenMove,
                validForCurrentState = game != null && game.MovementMode.HasValue
                    && game.MovementMode == _registeredMovementMode && Calibration.Matches(game.Bindings, game.Pose),
                message = Calibration.Message, samples = Calibration.Samples } });
    }
    public (bool Pending, bool Held, bool CleanupFailed, bool Observing) StopSnapshot()
    {
        lock (_outputOwnership.SyncRoot)
            return (HasPreparationInputClaim || _activeTakeover.Active || _executionArmed, _keys.AnyHeld, HasCleanupFailure, Enabled);
    }

    public void Stop() => StopCore("本人明确关闭输入准备");

    private void StopCore(string reason)
    {
        CancelStageReview?.Invoke();
        _queuedShowStart = null;
        _facingCandidate = null;
        _stationaryFacing.Cancel(_stationaryFacing.Generation, reason, Environment.TickCount64);
        _passiveTakeover.Cancel(reason, Environment.TickCount64);
        _activeTakeover.Cancel(reason, Environment.TickCount64);
        _captureFeedbackTakeover = false;
        _activeTakeoverRequested = false; _takeoverCountdown.Cancel(reason);
        var automaticOwned = _automatic.OwnsInput || _automatic.CleanupFailed;
        var diagnosticOwned = _diagnostic.OwnsInput || _diagnostic.CleanupFailed;
        var feedbackOwned = _feedback.OwnsInput || _feedback.CleanupFailed;
        if (feedbackOwned) _feedback.Stop(reason + "；坐标反馈短目标已停止", Environment.TickCount64);
        CaptureSegmentReport();
        if (diagnosticOwned) _diagnostic.Stop(reason + "；参考诊断已停止", Environment.TickCount64);
        if (automaticOwned) _automatic.Stop(reason + "；自动短测已停止", Environment.TickCount64);
        if (_cameraPreparing)
            _lastCameraAttempt = X1CameraPreparationReport.Stopped(reason, _cameraReports,
                _diagnostic.LastReport, _cameraAttemptPriorDiagnostic);
        Calibration.Invalidate("输入准备已关闭"); _bindings = null; _registeredMovementMode = null; _registeredReference = null;
        _automaticRequested = false;
        _diagnosticRequested = null;
        _cameraPreparing = false; _cameraPreparationOrigin = null; _cameraProfile = null; _cameraReports.Clear();
        _cameraAttemptPriorDiagnostic = null;
        _followRequested = null;
        _pathRequested = null;
        _takeoverProbe = _executionArmed = _hadSample = _awaitingNeutral = _idleTextPaused = false;
        _executionOwner = null;
        _showPathOwner = null; _showPathCheck = null; _showPathOtherBusy = null;
        var errors = new System.Collections.Generic.List<Exception>();
        if (!automaticOwned && !diagnosticOwned && !feedbackOwned) { try { _keys.ReleaseAll(); } catch (Exception error) { errors.Add(error); } }
        try { _monitor.Disable(); } catch (Exception error) { errors.Add(error); }
        // TASK-20260919-PATH-LOCOMOTION：停止时恢复开演前步态（仅恢复本组件切过的状态；失败并入清理失败，不吞）。
        try { _locomotionSwitcher?.Restore(); } catch (Exception error) { errors.Add(error); }
        _cleanupFailed = errors.Count != 0 || _automatic.CleanupFailed || _diagnostic.CleanupFailed || _feedback.CleanupFailed;
        _status = _cleanupFailed ? "输入清理未确认，已锁定；请 /choreo x1 off 明确重试" : "输入准备已关闭";
        ReleaseOutputOwnershipIfStopped();
        if (_cleanupFailed) throw new AggregateException(_status, errors);
    }
    private void AcquireOutputOwnership()
    {
        if (_externalOutputCleanupFailed?.Invoke() == true) throw new InvalidOperationException("预览清理失败，请 /choreo stop 明确重试");
        if (_outputLease is { IsCurrent: true }) throw new InvalidOperationException("上一输入输出租约尚未结束");
        if (!_outputOwnership.TryAcquireExclusive("x1-input", out _outputLease))
            throw new InvalidOperationException("播放、预览、录制或其它输出仍占用本机；请先停止并明确重试");
    }
    private void ReleaseOutputOwnershipIfStopped()
    {
        if (HasPreparationInputClaim || _activeTakeover.Active || _executionArmed || _keys.AnyHeld || HasCleanupFailure) return;
        _outputLease?.Dispose(); _outputLease = null;
    }
    private void RunOwnedOutput(Action output)
    {
        var lease = _outputLease;
        if (lease == null || !lease.TryRun(() => { output(); return true; }))
            throw new InvalidOperationException("本次输入输出租约已撤销，旧回调不得再按键");
    }
    private void PressProbeControl(X1Control control) => RunOwnedOutput(() => PressProbeControlCore(control));
    private void PressDiagnosticControl(X1Control control) => RunOwnedOutput(() => PressDiagnosticControlCore(control));
    private void PressFeedbackControl(X1Control control) => RunOwnedOutput(() => PressFeedbackControlCore(control));
    private void PressProbeControlCore(X1Control control)
    {
        var input = _monitor.Snapshot(); var game = _read();
        var sourceError = _automatic.CheckCurrentInput(input);
        if (sourceError.Length != 0) throw new InvalidOperationException(sourceError);
        if (!_automatic.Active || !game.Safe || _busy() || !input.Enabled || !input.Healthy
            || !input.Foreground || !input.Armed || input.ManualTakeover || input.AnyPhysicalHeld
            || !game.MovementMode.HasValue || game.MovementMode != _registeredMovementMode
            || _bindings == null || !Calibration.Matches(game.Bindings, game.Pose))
            throw new InvalidOperationException("按键输出前的自动短测条件已失效");
        if (control is X1Control.TurnLeft or X1Control.TurnRight)
            _keys.SyncTurn(control == X1Control.TurnLeft, control == X1Control.TurnRight);
        else _keys.SyncMove(control == X1Control.Forward, control == X1Control.StrafeLeft,
            control == X1Control.Back, control == X1Control.StrafeRight);
    }
    private X1AutomaticProbeObservation ReadAutomaticObservation()
    {
        var game = _read(); var input = _monitor.Snapshot();
        var modeMatches = game.MovementMode.HasValue && game.MovementMode == _registeredMovementMode;
        return new(game.Bindings, game.Pose, input, game.Safe && !_busy() && modeMatches,
            !modeMatches ? "移动模式变化或不可读" : game.Reason);
    }
    private X1ReferenceDiagnosticObservation ReadReferenceObservation()
        => ReferenceObservation(_read(), _monitor.Snapshot());
    private X1StationaryFacingObservation FacingObservation(X1GameInputSnapshot game, X1PhysicalInputSnapshot input)
        => new(ReferenceObservation(game, input), _executionArmed || _automatic.OwnsInput || _diagnostic.OwnsInput || _feedback.OwnsInput,
            _keys.AnyHeld, HasCleanupFailure);
    private void PrepareFeedbackEvidence()
    {
        _activeTakeover.Cancel("本人明确开始新坐标反馈试验", Environment.TickCount64);
        _feedbackOwnerId = Guid.NewGuid().ToString("D"); _captureFeedbackTakeover = true; _diagnosticTakeover = false;
    }
    private X1TakeoverEvidenceFrame TakeoverFrame(X1GameInputSnapshot game, X1PhysicalInputSnapshot input, bool active)
        => new(ReferenceObservation(game, input), active ? _feedbackOwnerId : "passive",
            active && (_diagnosticTakeover ? _diagnostic.Active : _feedback.Active),
            active && (_diagnosticTakeover ? _diagnostic.OwnsInput : _feedback.OwnsInput), _keys.AnyHeld, HasCleanupFailure);
    private bool ReferenceIdentityMatches(X1GameInputSnapshot game)
    {
        var r = game.MovementReference; var initial = _registeredReference;
        return initial?.Readable == true && r?.Readable == true && game.MovementMode.HasValue
            && game.MovementMode == _registeredMovementMode && r.CameraControlMode == initial.CameraControlMode
            && r.CameraZoomMode == initial.CameraZoomMode && r.ActiveCameraIndex == initial.ActiveCameraIndex
            && r.EventCameraAutoControl == initial.EventCameraAutoControl && r.IsWalking == initial.IsWalking
            && r.IsWalkingDuringAutorun == initial.IsWalkingDuringAutorun;
    }
    private X1ReferenceDiagnosticObservation ReferenceObservation(X1GameInputSnapshot game, X1PhysicalInputSnapshot input)
        => new(game.Bindings, game.Pose, game.MovementReference ?? new(), game.MovementMode, input,
            game.Safe && (_showPathOwner != null ? _showPathOtherBusy?.Invoke() == false : !_busy()),
            !game.Safe ? game.Reason : (_showPathOwner != null ? _showPathOtherBusy?.Invoke() != false : _busy()) ? "本机其他播放、录制或演出已开始" : "");
    private void PressDiagnosticControlCore(X1Control control)
    {
        var game = _read(); var input = _monitor.Snapshot();
        var sourceError = _diagnostic.CheckCurrentObservation(ReferenceObservation(game, input));
        if (_diagnosticTakeover && (_cameraProfile == null || _cameraProfile.CheckCurrent(ReferenceObservation(game, input)).Length != 0))
            throw new InvalidOperationException("独立接管写前当轮响应已经失效");
        if (sourceError.Length != 0) throw new InvalidOperationException(sourceError);
        if (!_diagnostic.Active || !game.Safe || _busy() || !input.Enabled || !input.Healthy || !input.Foreground
            || !input.Armed || input.ManualTakeover || input.AnyPhysicalHeld || _bindings == null
            || !game.MovementMode.HasValue || game.MovementMode != _registeredMovementMode
            || !Calibration.Matches(game.Bindings, game.Pose))
            throw new InvalidOperationException("参考诊断按键前实际安全状态已变化");
        if (control is X1Control.TurnLeft or X1Control.TurnRight)
            _keys.SyncTurn(control == X1Control.TurnLeft, control == X1Control.TurnRight);
        else if (control == X1Control.Forward) _keys.SyncMove(true, false, false, false);
        else throw new InvalidOperationException("未授权的参考诊断方向");
    }
    private void PressFeedbackControlCore(X1Control control)
    {
        var current = ReadReferenceObservation();
        var error = _feedback.CheckCurrentObservation(current, beforePress: true);
        if (error.Length != 0) throw new InvalidOperationException(error);
        if (!_feedback.Active || _bindings == null || !Calibration.Matches(current.Bindings, current.Pose))
            throw new InvalidOperationException("坐标反馈不再持有当前角色输入");
        if (control is X1Control.TurnLeft or X1Control.TurnRight)
            _keys.SyncTurn(control == X1Control.TurnLeft, control == X1Control.TurnRight);
        else if (control == X1Control.Forward) _keys.SyncMove(true, false, false, false);
        else throw new InvalidOperationException("坐标反馈不支持的单键意图");
    }
    public void Dispose() { try { Stop(); } finally { _monitor.Dispose(); } }
    public static string Label(X1Control c) => c switch { X1Control.Forward => "前进", X1Control.Back => "后退", X1Control.StrafeLeft => "左平移", X1Control.StrafeRight => "右平移", X1Control.TurnLeft => "左转", _ => "右转" };
    private static string KeyLabel(byte k) => k == 0 ? "未绑定" : k is >= 0x30 and <= 0x5A ? ((char)k).ToString() : "VK-" + k.ToString("X2");
    private static bool TryControl(string text, out X1Control control)
    {
        control = text.ToLowerInvariant() switch { "forward" => X1Control.Forward, "back" => X1Control.Back,
            "left" => X1Control.StrafeLeft, "right" => X1Control.StrafeRight,
            "turnleft" => X1Control.TurnLeft, "turnright" => X1Control.TurnRight, _ => (X1Control)(-1) };
        return Enum.IsDefined(control);
    }
}
