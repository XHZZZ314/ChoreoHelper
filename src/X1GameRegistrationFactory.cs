// 这个文件是干嘛的：框架线程整包登记工厂；所有候选先校验、映射、建表，采用前不改共享输入或原场次。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Dalamud.Plugin.Services;

namespace ChoreoHelper;

public sealed class X1GameRegistrationFactory
{
    private readonly GameCommandExecutor _executor;
    private readonly IObjectTable _objects;
    private readonly ICondition _conditions;
    private readonly X1GameAbilityAdapters _ability;
    private readonly X1GameSinkAdapters _sinks;
    private readonly IShowDispatcher _production;
    private readonly X1InputPreparation _preparation;
    private readonly Func<X1GameInputSnapshot> _read;
    private readonly Func<bool> _frameworkThread, _busy;

    public X1GameRegistrationFactory(IObjectTable objects, ICondition conditions,
        X1GameAbilityAdapters ability, X1GameSinkAdapters sinks, IShowDispatcher production,
        X1InputPreparation preparation, Func<X1GameInputSnapshot> read, Func<bool> frameworkThread, Func<bool> busy, GameCommandExecutor executor)
    { _executor=executor; _objects = objects; _conditions = conditions; _ability = ability; _sinks = sinks; _production = production;
      _preparation = preparation; _read = read; _frameworkThread = frameworkThread; _busy = busy; }

    public PreparedShowRegistration Prepare(ShowPackage package, string packageId, string clientLoadId)
    {
        if (!_frameworkThread()) throw new InvalidOperationException("X1 整包登记须在游戏框架线程进行");
        if (StageShowContract.IsStage(package)) return PrepareStagePath(package,packageId,clientLoadId);
        var game = _read();
        var result = X1PreparedPackage.TryPrepare(package, packageId, clientLoadId,
            ownsMovementFacing: game.Bindings[X1Control.StrafeLeft] == 0 || game.Bindings[X1Control.StrafeRight] == 0);
        if (!result.Ok || result.Prepared == null) throw new InvalidOperationException(result.Error);
        var prepared = result.Prepared;
        var binding = prepared.LocalBinding;
        var keyIdentity = game.Bindings.Identity;
        var inputOwner = packageId + ":" + clientLoadId;
        var needsMovementResponse = prepared.Events.Any(e => e.Kind is "movement" or "facing");
        void CheckBinding()
        {
            if (!_frameworkThread()) throw new InvalidOperationException("X1 只能在游戏框架线程检查或执行");
            var current = _read();
            if (current.Pose.ActorId.ToString(CultureInfo.InvariantCulture) != binding.ActorId)
                throw new InvalidOperationException("本地角色身份与演出绑定不同，请重新登记当前角色");
            if (current.Pose.Territory != binding.TerritoryId)
                throw new InvalidOperationException("当前区域与舞台绑定不同，请重新确认舞台坐标");
            if (current.Bindings.Identity != keyIdentity)
                throw new InvalidOperationException("装载后的游戏键位已改变，本次输入准备失效");
        }
        CheckBinding();
        PreparedShowRegistration? registration = null;
        void CheckCurrent()
        {
            if (registration?.IsCurrent != true) throw new InvalidOperationException("本次输入登记已取消或被新场替换");
            CheckBinding();
            _preparation.CheckExecutionSafety(inputOwner);
        }
        var stageSinks = new X1StageExecutionSinks(binding.Stage, _sinks, _sinks, CheckCurrent);
        var core = new X1ShowDispatcher(binding.PerformerId)
        {
            AbilitySink = _ability, MovementSink = stageSinks, FacingSink = stageSinks,
            ObservedProvider = () =>
            {
                CheckCurrent();
                var pose = _read().Pose;
                return binding.Stage.ToStage(pose.X, pose.Z);
            },
            OtherActorPositionProvider = performerId =>
            {
                CheckCurrent();
                var target = prepared.Bindings.SingleOrDefault(b => b.PerformerId == performerId);
                if (target == null || target.TerritoryId != binding.TerritoryId)
                    throw new InvalidOperationException("目标演员没有同区域的明确角色绑定，无法观测朝向目标");
                foreach (var actor in _objects)
                    if (actor != null && actor.IsValid() && actor.GameObjectId.ToString(CultureInfo.InvariantCulture) == target.ActorId)
                        return binding.Stage.ToStage(actor.Position.X, actor.Position.Z);
                throw new InvalidOperationException("明确绑定的目标演员当前不可见，不能用名字或其他角色替代");
            }
        };
        var conditions = new List<(string Id, Func<X1AbilityConditions?> Read)>();
        foreach (var e in prepared.Events)
        {
            (bool Ok, string Error) added;
            if (e.Kind == "ability")
            {
                var input = e.Input.CreateAbilityInput(e.EventId, e.PerformerId);
                added = _ability.RegisterLiveAbility(core, _objects, _conditions, input, e.Input.TargetId);
                conditions.Add((e.EventId, _ability.CreateGameConditionProvider(_objects, _conditions, input, e.Input.TargetId)));
            }
            else if (e.Kind == "movement") added = core.AddMovement(e.Input.CreateMovementInput(e.EventId, e.PerformerId));
            else if (e.Kind == "facing") added = core.AddFacing(e.Input.CreateFacingInput(e.EventId, e.PerformerId));
            else continue;
            if (!added.Ok) throw new InvalidOperationException(added.Error);
        }
        // 这里仍是私有候选，坏的最后一条事件不会留下半套共享登记。
        void CheckReady()
        {
            CheckBinding();
            if (_busy()) throw new InvalidOperationException("本机仍在预览或录制，请先停止后就绪");
            _preparation.CheckReadyForExecution(needsMovementResponse);
            foreach (var condition in conditions)
            {
                var c = condition.Read();
                if (c == null) throw new InvalidOperationException("技能「" + condition.Id + "」实时条件不可读");
                var checks = new (string Name, bool? Value)[] { ("职业", c.JobMatches), ("等级", c.LevelMeets),
                    ("明确目标", c.TargetValid), ("咏唱状态", c.NotCasting), ("冷却", c.CooldownReady),
                    ("移动许可 MovementAllowed", c.MovementAllowed), ("可控性", c.Controllable) };
                var blocked = checks.Where(c => c.Value != true).Select(c => c.Name + (c.Value == null ? "未知" : "不满足")).ToArray();
                if (blocked.Length != 0) throw new InvalidOperationException("技能「" + condition.Id + "」：" + string.Join("、", blocked));
            }
            if (prepared.Events.Any(e => e.Kind == "movement"))
                throw new InvalidOperationException("路径输入已登记；步行／跑步状态、镜头控制模式与路径到达尚未实测确认，暂不能输出移动");
            if (prepared.Events.Any(e => e.Kind == "facing"))
                throw new InvalidOperationException("朝向输入已登记；镜头控制模式与独立转向输出尚未实测确认，暂不能输出转向");
        }
        var dispatcher = new X1RegisteredShowDispatcher(new X1CompositeShowDispatcher(_production, core),
            () => registration?.IsCurrent == true, CheckReady, CheckCurrent,
            () => _preparation.ArmForExecution(inputOwner, needsMovementResponse), () => _preparation.EndExecution(inputOwner));
        registration = new PreparedShowRegistration(prepared.CreatePackageSnapshot(), dispatcher, CheckReady,
            new { inputProtocol = 1, packageId, clientLoadId, performerId = binding.PerformerId,
                actorId = binding.ActorId, territoryId = binding.TerritoryId, stageId = binding.Stage.Id,
                abilities = core.RegisteredAbilityCount, movements = core.RegisteredMovementCount, facings = core.RegisteredFacingCount,
                executionEnabled = false });
        return registration;
    }

    private PreparedShowRegistration PrepareStagePath(ShowPackage package,string packageId,string clientLoadId)
    {
        package=X1PreparedPackage.ClonePackage(package);
        var pathEvents=StageShowContract.Paths(package);
        foreach(var e in package.Events.Where(e=>e.Kind=="motion"))
            if(!SkillMotionCommands.IsKnown(Plugin.DataManager,e.Command))throw new InvalidOperationException("本场动作不是本机真实普通动作："+e.Command);
        PreparedShowRegistration? registration=null;
        var owner=packageId+":"+clientLoadId;
        var expectedJob=_objects.LocalPlayer?.ClassJob.RowId;
        if(package.Events.Any(e=>e.Kind=="ability"&&e.X1!.RequiredJobId!=expectedJob?.ToString(CultureInfo.InvariantCulture)))throw new InvalidOperationException("网页审阅后职业已变化，请重新审阅登记");
        void Check()
        {
            if(!_frameworkThread() || registration is { IsCurrent:false })
                throw new InvalidOperationException("路径场次已失效或不在框架线程");
            var b=package.X1!.Bindings.Single();var current=_read();
            if(_objects.LocalPlayer?.ClassJob.RowId!=expectedJob)throw new InvalidOperationException("本场登记后职业已变化");
            if(current.Pose.ActorId.ToString(CultureInfo.InvariantCulture)!=b.ActorId || current.Pose.Territory!=b.TerritoryId)
                throw new InvalidOperationException("路径角色或区域与审阅映射不同");
        }
        var plans=pathEvents.Select(e=>new X1CameraPathPlan(package,e.Id,Check,packageId,clientLoadId)).ToArray();
        // 独立朝向执行链（INT-20260915-STAGE-FACING-EXEC）：复用休眠 X1 核与既有键位/校准槽，
        // 只经四键合同（不与任何路径段重叠）接入本场；不新增播放器、时钟或控制台。
        var facingEvents=package.Events.Where(e=>e.Kind=="facing").ToArray();
        X1ShowDispatcher? facingCore=null;
        StageNativeFacingSink? nativeFacing=null;
        if(facingEvents.Length>0)
        {
            var binding=package.X1!.Bindings.Single();
            void CheckFacing(){Check();_preparation.CheckShowPath(owner);}
            nativeFacing=new StageNativeFacingSink(facingEvents.Select(e=>e.Id),CheckFacing, radians=>
            {
                CheckFacing();
                var player=_objects.LocalPlayer;
                if(player==null || !player.IsValid() || player.Address==IntPtr.Zero)
                    throw new InvalidOperationException("本场本地角色原生地址不可读");
                unsafe { ((FFXIVClientStructs.FFXIV.Client.Game.Object.GameObject*)player.Address)->SetRotation(radians); }
            });
            var stageSinks=new X1StageExecutionSinks(binding.Stage,_sinks,nativeFacing,CheckFacing);
            facingCore=new X1ShowDispatcher(binding.PerformerId)
            {
                MovementSink=stageSinks,FacingSink=stageSinks,
                ObservedProvider=()=>{Check();var pose=_read().Pose;return binding.Stage.ToStage(pose.X,pose.Z);}
            };
            foreach(var e in facingEvents)
            {
                var added=facingCore.AddFacing(e.X1!.CreateFacingInput(e.Id,e.PerformerId));
                if(!added.Ok)throw new InvalidOperationException(added.Error);
            }
        }
        void Ready(){Check();if(_busy())throw new InvalidOperationException("其他播放或录制尚未结束");_preparation.CheckReadyForShowPath(plans[0],_busy);
            // TASK-20260919-PATH-LOCOMOTION：含跑步段时校准须在跑步状态完成——脉冲限幅按校准速度上限防过冲，
            // 跑步校准对走/跑两档都是安全上界；步行校准遇跑步段会低估速度导致按键过冲。
            if(plans.Any(p=>p.Locomotion==X1Locomotion.Run)&&_preparation.CalibrationWhileWalking==true)
                throw new InvalidOperationException("本场包含跑步节点：校准须在跑步状态下完成（按最快档校准防过冲）；请在跑步状态下重新 /choreo x1 prepare");
            }
        var dispatcher=new StagePathShowDispatcher(plans,()=>_preparation.ArmShowPath(owner,plans[0],Check,_busy),
            ()=>_preparation.CheckShowPath(owner),()=>_preparation.StopShowPath(owner),
            (i,start)=>_preparation.BeginShowPath(owner,plans[i],start),()=>_preparation.TickShowPath(owner),()=>_preparation.StopSnapshot().CleanupFailed);
        IShowDispatcher finalDispatcher=dispatcher;
        if(package.Compiler==StageShowContract.MixedCompiler)
        {
            NativeStageEvents? native=null;
            finalDispatcher=new StageShowDispatcher(package,dispatcher,facingCore,()=>_preparation.CheckShowPath(owner),
                e=>(native??throw new InvalidOperationException("本场适配器未就绪")).Dispatch(e),()=>Environment.TickCount64,
                ()=>{native=new NativeStageEvents(package,owner,_preparation,_executor);nativeFacing?.Begin();},
                ()=>{nativeFacing?.Stop();native?.Dispose();native=null;});
        }
        registration=new PreparedShowRegistration(X1PreparedPackage.ClonePackage(package),finalDispatcher,Ready,
            new { packageId,clientLoadId,performerId=plans[0].PerformerId,actorId=plans[0].ActorId,stageId=plans[0].StageId,
                boundedStagePathV1=true,executionEnabled=true,independentFacing=facingCore!=null,mixedShow=package.Compiler==StageShowContract.MixedCompiler });
        return registration;
    }
}
