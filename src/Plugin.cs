// 这个文件是干嘛的：插件服务装配、生命周期与本机显式操作入口。
using System;
using Dalamud.Plugin.Services;
using Dalamud.Game.ClientState.Objects;
using Dalamud.Game.Command;
using Dalamud.Game.Gui;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Game;

namespace ChoreoHelper;

public sealed class Plugin : IDalamudPlugin
{
    [PluginService] public static IDataManager DataManager { get; private set; } = null!;
    [PluginService] public static IPluginLog Log { get; private set; } = null!;
    [PluginService] public static IChatGui Chat { get; private set; } = null!;
    [PluginService] public static IObjectTable ObjectTable { get; private set; } = null!;
    [PluginService] public static ICommandManager CommandManager { get; private set; } = null!;
    [PluginService] public static IFramework Framework { get; private set; } = null!;
    [PluginService] public static IGameInteropProvider GameInterop { get; private set; } = null!;
    [PluginService] public static IGameGui GameGui { get; private set; } = null!;
    [PluginService] public static ISigScanner SigScanner { get; private set; } = null!;
    [PluginService] public static IDalamudPluginInterface PluginInterface { get; private set; } = null!;
    [PluginService] public static IClientState ClientState { get; private set; } = null!;
    [PluginService] public static ICondition Condition { get; private set; } = null!;
    [PluginService] public static ITargetManager TargetManager { get; private set; } = null!;
    [PluginService] public static IGameConfig GameConfig { get; private set; } = null!;

    public string Name => "ChoreoHelper";

    private HttpServer? _httpServer;
    private GlobalStopCoordinator? _globalStop;
    private ActionPreviewer? _previewer;
    private PlaybackManager? _playback;
    private GameCommandExecutor? _executor;
    private AnimationPoseFreezer? _freezer;
    private Exporter.RecorderService? _v3Recorder;
    private Exporter.ExportServer? _v3Server;
    // EXEC-CORE：演出执行器（独立安全链路）+ 游戏适配器。与 PlaybackManager（网页逐帧驱动的
    // 预览链路）职责分离，见 docs/DESIGN-game-executor.md。
    private GameShowDispatcher? _showDispatcher;
    // X1-ADAPTERS-1：休眠复合接线（生产半 + X1 核心 + 游戏槽适配器）。守卫采集仍归生产半；
    // 能力使能、校准与部署另行主人授权，本包生产零 X1 事件。
    private X1GameSinkAdapters? _x1Sinks;
    // X1-ABILITY-ADAPTER r3（休眠）：技能槽游戏适配器（写入边界 + 同步聊天命令道 + 七条件供给工厂）。
    // 准入关闭期间 X1 束零事件，本适配器零调用；未来使能包仅开准入与登记，不再改接线。
    private X1GameAbilityAdapters? _x1Ability;
    private X1CompositeShowDispatcher? _x1Composite;
    private X1InputPreparation? _x1Preparation;
    private ShowRunner? _showRunner;
    private string _pairingCode = "";
    private StageGamePanel? _stagePanel;
    private string _stageMappingText = "";
    private StagePathMappingReview? _stageReview;
    // TASK-20260908：清理恰一次/异常隔离由 PluginCleanup 状态机承担（旧 _disposed 防卫位
    // 会在 ctor 失败路径压制首清理，且无隔离的单步异常会截断后续清理——均已入夹具回归）
    private readonly PluginCleanup _cleanup = new();

    public Plugin()
    {
        try
        {
            _executor = new GameCommandExecutor(GameGui, SigScanner, Log, Framework);
            _cleanup.Register(PluginCleanupStep.DisposeExecutor, () => _executor?.Dispose());
            _previewer = new ActionPreviewer(ObjectTable, _executor, Log);
            _cleanup.Register(PluginCleanupStep.DisposePreviewer, () => _previewer?.Dispose());
            _freezer = new AnimationPoseFreezer(Log, ObjectTable, Framework, _executor, DataManager);
            _cleanup.Register(PluginCleanupStep.DisposeFreezer, () => _freezer?.Dispose());
            _playback = new PlaybackManager(Log, Framework, _executor, _freezer);
            _cleanup.Register(PluginCleanupStep.DisposePlayback, () => _playback?.Dispose());

            // EXEC-CORE：演出执行链路——纯核心 ShowRunner（状态机+单调时钟）+ 游戏适配器
            //（命令队列/定格解堵/守卫采集）。框架每帧 Tick 由 ShowRunner 自己兜异常。
            // X1-ADAPTERS-1（休眠接线，准入保持关闭）：纯复合分发器托管生产半
            //（GameShowDispatcher：motion/cue/lyrics）与 X1 核心（ability/movement/facing，
            // 槽/观测为游戏适配器；技能槽为 X1GameAbilityAdapters——提交护栏+聊天命令道，
            // live 七条件供给工厂随事件登记启用）。ShowValidator/ShowProtocol/HttpServer 未动，
            // X1 束生产零事件、槽零调用。
            _showDispatcher = new GameShowDispatcher(_executor, _freezer, ClientState, ObjectTable, Condition, Log);
            var x1Keys = new X1OsKeyWriter();
            _x1Preparation = new X1InputPreparation(() => X1GameInputReader.Read(ObjectTable, ClientState, Condition, GameConfig),
                () => _playback?.IsPlaying == true || _v3Recorder?.IsRecording == true
                    || _showRunner?.CleanupFailed == true
                    || _showRunner?.State is ShowState.Playing or ShowState.Countdown or ShowState.Armed or ShowState.Stopping,
                x1Keys, message => Chat.Print(message, "ChoreoHelper 输入准备"), null,
                () => _showRunner?.CaptureRegisteredPathTrial() ?? throw new InvalidOperationException("演出登记尚未就绪"),
                null, null, _executor.OutputOwnership,
                () => _freezer?.OutputCleanupFailed == true);
            _x1Sinks = new X1GameSinkAdapters(X1GameObservationAdapters.CreateRotationReader(ObjectTable), x1Keys);
            _x1Ability = new X1GameAbilityAdapters(_executor, ClientState, TargetManager, DataManager);
            var x1Core = new X1ShowDispatcher("local")
            {
                MovementSink = _x1Sinks,
                FacingSink = _x1Sinks,
                AbilitySink = _x1Ability,
                ObservedProvider = X1GameObservationAdapters.CreateOwnPositionProvider(ObjectTable),
                OtherActorPositionProvider = X1GameObservationAdapters.CreateOtherActorPositionProvider(ObjectTable),
            };
            _x1Composite = new X1CompositeShowDispatcher(_showDispatcher, x1Core);
            _showRunner = new ShowRunner(_x1Composite, () => Environment.TickCount64,
                msg => Log.Information("{msg}", msg));
            _showRunner.SetRunAdmissionCheck(() =>
            {
                _x1Preparation.CheckShowRunAdmission();
            });
            var gameGuard = _showDispatcher.CreateGuardProvider();
            _showRunner.SetGuardProvider(() => { var guard = gameGuard(); _x1Preparation?.ApplyGuard(guard); return guard; });
            var x1Registrations = new X1GameRegistrationFactory(ObjectTable, Condition, _x1Ability, _x1Sinks,
                _showDispatcher, _x1Preparation, () => X1GameInputReader.Read(ObjectTable, ClientState, Condition, GameConfig),
                () => Framework.IsInFrameworkUpdateThread,
                () => _playback?.IsPlaying == true || _v3Recorder?.IsRecording == true, _executor);
            _showRunner.SetRegistrationFactory(x1Registrations.Prepare);
            _x1Preparation.LocomotionSwitcher=new X1LocomotionSwitcher(X1LocomotionFrameworkAdapter.Read,walking=>
            {
                if(!Framework.IsInFrameworkUpdateThread)throw new InvalidOperationException("步态切换须在框架线程");
                X1LocomotionFrameworkAdapter.Write(walking);
            });
            _x1Preparation.CancelStageReview=()=>{_stageReview=null;_stageMappingText="";_showRunner.InvalidatePendingStageMapping();};
            _x1Preparation.ObserveStageReview=pose=>
            {
                _showRunner.ObserveStageMapping(pose);
                if(_stageReview!=null)try{_stageReview.Observe(pose);}catch{_stageReview=null;_stageMappingText="";}
            };
            _x1Preparation.CaptureStageReview=()=>
            {
                var captured=_showRunner.CaptureRegisteredPathTrial();
                return ()=>
                {
                    captured.CheckCurrent();_x1Preparation.CheckStageMappingReady();
                    var game=X1GameInputReader.Read(ObjectTable,ClientState,Condition,GameConfig);
                    var mode=_x1Preparation.ManualMode;var keys=game.Bindings.Identity;var movement=game.MovementMode;
                    // R2：确认消费后、执行接管前仍要复核的上下文见证（模式/键位/步态）；与审阅前
                    // 的整包检查分开——预约开演时登记仍有效，不能再要求「未启动」状态。
                    void CheckContext()
                    {
                        var current=X1GameInputReader.Read(ObjectTable,ClientState,Condition,GameConfig);
                        if(mode!=_x1Preparation.ManualMode||keys!=current.Bindings.Identity||movement!=current.MovementMode)
                            throw new InvalidOperationException("输入模式或键位已变化，请重新审阅");
                    }
                    _stageReview=StagePathMappingReview.Create(captured.Package,captured.PackageId,captured.ClientLoadId,game.Pose,()=>
                    {
                        captured.CheckCurrent();CheckContext();
                    },CheckContext);
                    _stageMappingText=_stageReview.Summary;
                };
            };
            _x1Preparation.CaptureStageConfirmation=()=>
            {
                var review=_stageReview ?? throw new InvalidOperationException("请先查看本次映射");
                return ()=>
                {
                    if(!ReferenceEquals(review,_stageReview))throw new InvalidOperationException("映射审阅已变化");
                    _x1Preparation.CheckStageMappingReady();
                    _showRunner.ConfirmStageMapping(review,X1GameInputReader.Read(ObjectTable,ClientState,Condition,GameConfig).Pose);
                    _stageReview=null;
                };
            };
            _x1Preparation.CaptureReviewedShowStart = () =>
            {
                var captured = _showRunner.CaptureRegisteredPathTrial();
                if (!StageShowContract.IsStage(captured.Package)) throw new InvalidOperationException("当前不是网页审阅的有界单路径");
                return () =>
                {
                    captured.CheckCurrent();
                    var arm=_showRunner.ArmBound(captured.PackageId,captured.ClientLoadId);
                    if(!arm.Ok)throw new InvalidOperationException(arm.Message);
                    var clock=_showRunner.GetScheduledStartClock();
                    var start=_showRunner.ScheduleStart(captured.PackageId,clock.ArmId,Guid.NewGuid().ToString("D"),_showRunner.Clock+3000);
                    if(!start.Ok)throw new InvalidOperationException(start.Message);
                };
            };
            _cleanup.Register(PluginCleanupStep.StopShow, () =>
            {
                var errors = new System.Collections.Generic.List<Exception>();
                // 先由当前输入 owner 确认停止；失败后生产清理仍可清命令/预览，但不能再碰同一批按键。
                try { _x1Preparation?.Dispose(); } catch (Exception error) { errors.Add(error); }
                try { _showRunner?.RequestStop("插件卸载"); } catch (Exception error) { errors.Add(error); }
                try { _showRunner?.Unload(); } catch (Exception error) { errors.Add(error); }
                if (errors.Count != 0) throw new AggregateException("插件输入或演出清理未确认", errors);
            });
            Framework.Update += OnFrameworkUpdate;
            _cleanup.Register(PluginCleanupStep.UnsubscribeFramework, () => Framework.Update -= OnFrameworkUpdate);

            // v0.6.7：网页配对码——写接口（播放/录制/复位等）必须带它，防止别的网页偷偷控制角色。
            // 码存插件配置目录、永久不变；/choreo pair 随时重看
            _pairingCode = PairingStore.LoadOrCreate();

            _globalStop = new GlobalStopCoordinator(_executor.OutputOwnership.SyncRoot, StopAllOutputs, InspectStoppedOutputs);
            _httpServer = new HttpServer(DataManager, Log, Framework, _previewer, _playback, _freezer, _pairingCode, _showRunner);
            _httpServer.InputStatus=()=>_x1Preparation.StatusJson();
            _stagePanel=new StageGamePanel(()=>new(StagePanelIdentity(),_x1Preparation.StatusJson(),_showRunner.StatusJson(),_stageMappingText,_showRunner.StageMappingConfirmed,_showRunner.CountdownRemainingMs),HandleStagePanelCommand,null);
            PluginInterface.UiBuilder.Draw+=DrawStagePanel;
            PluginInterface.UiBuilder.OpenMainUi+=OpenStagePanel;
            PluginInterface.UiBuilder.OpenConfigUi+=OpenStagePanel;
            _cleanup.Register(PluginCleanupStep.StopHttpServer, () =>
            {
                PluginInterface.UiBuilder.Draw-=DrawStagePanel;
                PluginInterface.UiBuilder.OpenMainUi-=OpenStagePanel;
                PluginInterface.UiBuilder.OpenConfigUi-=OpenStagePanel;
                _httpServer?.Dispose();
            });
            _httpServer.Start();

            // v3 导出管线：RecorderService + 独立端口 48795
            // v0.6.3：录制触发前先跑冻结器的卫生序列（解掉舞蹈循环绑死 slot0 的旧绑定，
            // 否则游戏内放过带舞时间轴后录制全是污染数据）
            _v3Recorder = new Exporter.RecorderService(Log, Framework, ObjectTable,
                cmd => _executor.ExecuteCommand(cmd),
                () => _freezer?.PrepareForExternalEmote(), outputOwnership: _executor.OutputOwnership,
                ownedTrigger: (cmd, lease) => _executor.ExecuteCommand(cmd, lease),
                cancellableTrigger: (cmd, valid) => _executor.ExecuteCommand(cmd, originGuard: valid));
            _cleanup.Register(PluginCleanupStep.StopRecorder, () => _v3Recorder?.Dispose());
            _v3Server = new Exporter.ExportServer(Log, Framework, _v3Recorder, _pairingCode);
            _v3Server.Start();
            _cleanup.Register(PluginCleanupStep.StopV3Server, () => _v3Server?.Dispose());

            CommandManager.AddHandler("/choreo", new CommandInfo(OnChoreoCommand)
            {
                HelpMessage = "ChoreoHelper 命令。/choreo stop 紧急停止；/choreo pair 网页配对；/choreo x1 查看输入准备"
            });
            _cleanup.Register(PluginCleanupStep.RemoveCommand, () => CommandManager.RemoveHandler("/choreo"));

            // v0.6.6：版本号统一从程序集读取（csproj 的 <Version>），不再手写——
            // 曾经"代码是新版、日志报旧版"的混乱就是手写漏改造成的
            var ver = typeof(Plugin).Assembly.GetName().Version?.ToString(3) ?? "?";
            Log.Information("ChoreoHelper v{0} started. API: 48794 + Export: 48795", ver);
            Chat.Print($"ChoreoHelper v{ver} 已启动（+导出管线）", "队列执行模式 + 手动 Utf8String");
            Chat.Print($"网页配对码：{_pairingCode}（用 /choreo pair 随时重看）", "ChoreoHelper 配对");
            // 安装自检：只丢 DLL 没带 dist 网页文件时，启动即给出期望路径，不等到玩家找不到网页。
        }
        catch (Exception ex)
        {
            // 构造失败也要回收半成品（2026-08-31 审计 P0：旧实现只记日志时，已 Start 的两个
            // HTTP 服务、已订阅的框架 Update 全部残留）。TASK-20260908（AC-1）：清理入口不预置
            // 任何完成标志——恰一次语义由 PluginCleanup 内部闸门承担，首个清理不被压制，
            // 之后 Dalamud 卸载失败插件再调 Dispose 也不会二次拆解。
            Log.Error(ex, "Failed to start ChoreoHelper");
            _cleanup.RunConstructionCleanup();
            LogCleanupFailures();
        }
    }

    private void OnFrameworkUpdate(IFramework framework)
    {
        _x1Ability?.MarkFrameworkThread(); // 框架线程 stamp（先于 Tick：技能提交护栏线程门基准）
        try { _x1Preparation?.Tick(); }
        catch (Exception error) { Log.Error(error, "X1 input preparation cleanup unconfirmed"); }
        _showRunner?.Tick();
    }

    private void DrawStagePanel()=>_stagePanel?.Draw();
    private void OpenStagePanel(){if(_stagePanel!=null)_stagePanel.Open=true;}


    private string StagePanelIdentity()
    {
        var clock=_showRunner!.GetScheduledStartClock();
        return clock.PackageId+"|"+clock.ClientLoadId;
    }
    private void HandleStagePanelCommand(string command,string identity)
    {
        if(command=="stop"){OnChoreoCommand("/choreo","stop");return;}
        var generation=_globalStop!.CaptureGeneration();
        _=Framework.RunOnFrameworkThread(()=>
        {
            try
            {
                _globalStop.RunCurrent(generation,()=>
                {
                    if(StagePanelIdentity()!=identity)throw new InvalidOperationException("面板旧登记已变化，请查看新映射后操作");
                    _x1Preparation!.HandleCommand(command);return true;
                });
            }
            catch(Exception error){Chat.Print("路径操作已取消："+error.Message,"ChoreoHelper");}
        });
    }
    private void OnChoreoCommand(string command, string args)
    {
        if(args.Trim() is "" or "stage") { OpenStagePanel(); return; }
        if (args.Trim().Equals("stop", StringComparison.OrdinalIgnoreCase))
        {
            var request = _globalStop?.RequestStop();
            if (request is { Dispatch: true } stop)
                _ = Framework.RunOnFrameworkThread(() => Chat.Print(_globalStop!.ExecuteStop(stop.Generation).Message, "ChoreoHelper"));
        }
        else if (args.Trim().StartsWith("x1", StringComparison.OrdinalIgnoreCase)
            && (args.Trim().Length == 2 || args.Trim()[2] == ' '))
        {
            var generation = _globalStop?.CaptureGeneration() ?? 0;
            _ = Framework.RunOnFrameworkThread(() =>
            {
                try
                {
                    if (_globalStop == null) throw new GlobalStopCancelledException();
                    _globalStop.RunCurrent(generation, () =>
                    {
                        var subcommand = args.Trim()[2..];
                        _x1Preparation?.HandleCommand(subcommand);
                        return true;
                    });
                }
                catch (GlobalStopCancelledException)
                { Chat.Print("旧输入命令已被立即停止取消；若清理失败，请 /choreo stop 明确重试。", "ChoreoHelper"); }
            });
        }
        else if (args.Trim() == "pair")
            Chat.Print($"网页配对码：{_pairingCode}", "ChoreoHelper 配对");
        else
            Chat.Print("用法：/choreo stop 紧急停止；/choreo pair 网页配对；/choreo x1 查看输入准备", "ChoreoHelper");
    }


    private string? CheckAbilityTrialSafety()
    {
        if (_playback?.IsPlaying == true || _v3Recorder?.IsRecording == true || _freezer?.IsPreviewMode == true
            || _executor?.PendingCount != 0 || _showRunner?.CleanupFailed == true
            || _showRunner?.State is ShowState.Playing or ShowState.Countdown or ShowState.Armed or ShowState.Stopping)
            return "当前播放、录制、预览、命令队列或演出未空闲";
        return _x1Preparation?.CheckIsolatedAbilitySafety() ?? (_x1Preparation == null ? "输入观察未就绪" : null);
    }

    private System.Collections.Generic.IReadOnlyList<string> StopAllOutputs()
    {
        var failures = new System.Collections.Generic.List<string>();
        var retryFailedPreview = _freezer?.OutputCleanupFailed == true;
        foreach (var stop in new Action[] {
            () => _freezer?.StopAllOutputSessions(retryFailedPreview),
            () => _v3Recorder?.CancelPending(),
            () => _x1Preparation?.Stop(),
            () => _showRunner?.RequestStop("本人立即停止本机输出"),
            () => _playback?.Stop(), () => _executor?.Clear(), () => _freezer?.StopPreview()
        })
        {
            try { stop(); }
            catch (Exception ex) { failures.Add(ex.Message); Log.Error(ex, "Choreo emergency stop cleanup failed"); }
        }
        return failures;
    }

    private GlobalStopInspection InspectStoppedOutputs()
    {
        var errors = new System.Collections.Generic.List<string>();
        var input = _x1Preparation?.StopSnapshot();
        var recorder = _v3Recorder?.StopSnapshot();
        if (input?.CleanupFailed == true) errors.Add("输入释放或观察关闭未确认");
        if (recorder?.CleanupFailed == true || recorder?.Held == true) errors.Add("旧录制复位按键释放未确认");
        if (_freezer?.OutputCleanupFailed == true) errors.Add("预览原生清理失败，输出租约已保留");
        if (_showRunner?.CleanupFailed == true) errors.Add("演出清理失败：" + _showRunner.StopReason);
        var output = _executor?.OutputOwnership.Snapshot();
        var busy = _playback?.IsPlaying == true || recorder?.Recording == true || input?.Pending == true
            || input?.Held == true || input?.Observing == true
            || _executor?.PendingCount > 0 || _freezer?.IsPreviewMode == true
            || _showRunner?.State is ShowState.Playing or ShowState.Countdown or ShowState.Armed or ShowState.Stopping;
        var pending = _freezer?.OutputCleanupPending == true
            || output?.ExclusiveOwner != null || output?.LegacyLeases > 0;
        return new(busy, pending, errors);
    }

    // TASK-20260908（AC-2）：清理序列交给 PluginCleanup——固定依赖序（序值即
    // PluginCleanupStep）、逐项隔离、失败进错误接收器、重复调用无副作用。FIX-E（AUD2-010）
    // 排序原则不变：先停外部入口（命令 + 两个 HTTP 服务），再停消费者（录制→演出→播放→
    // 定格→预览），最后解除框架订阅并释放执行器（playback 依赖 freezer/executor）。
    public void Dispose()
    {
        _globalStop?.CloseRequests(); // 在拆除服务之前使所有已接受但迟到的写入失效。
        _cleanup.Run();
        LogCleanupFailures();
    }

    private void LogCleanupFailures()
    {
        foreach (var f in _cleanup.Errors)
            Log.Error(f.Error, "Plugin cleanup step {step} failed", f.Step);
    }
}
