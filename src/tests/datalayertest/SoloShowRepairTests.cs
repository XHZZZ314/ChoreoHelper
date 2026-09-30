// 单人整场修复回归：身份、取消、映射、原时钟、接管与完整结果；纯离线，不写游戏。
using ChoreoHelper;
using System.Reflection;
using System.Text.Json;

internal static class SoloShowRepairTests
{
    public static int Run()
    {
        int failed=0,total=0;
        void Check(string name,bool yes){total++;if(!yes){failed++;Console.WriteLine("FAIL "+name);}else Console.WriteLine("OK "+name);}
        void Reject(string name,Action action){try{action();Check(name,false);}catch(InvalidOperationException){Check(name,true);}}
        var angles=new List<float>();bool faceSafe=true;
        var nativeFace=new StageNativeFacingSink(new[]{"f"},()=>{if(!faceSafe)throw new InvalidOperationException();},angles.Add);
        Reject("facing before start refused",()=>nativeFace.EmitFacing("f",90,0));
        nativeFace.Begin();nativeFace.EmitFacing("f",450,100);
        Check("native facing angle converted",angles.Count==1&&Math.Abs(angles[0]-Math.PI/2)<1e-6);
        Reject("nonfinite native facing refused",()=>nativeFace.EmitFacing("f",double.NaN,100));
        Reject("foreign facing event refused",()=>nativeFace.EmitFacing("old",90,100));
        faceSafe=false;Reject("native facing guard before every write",()=>nativeFace.EmitFacing("f",90,101));faceSafe=true;
        nativeFace.ReleaseFacing("f");Reject("released facing refuses writes",()=>nativeFace.EmitFacing("f",90,102));
        nativeFace.Stop();Reject("stopped facing refuses writes",()=>nativeFace.EmitFacing("f",90,103));
        Check("rejected facing never writes",angles.Count==1);
        var a=Guid.NewGuid().ToString("D");var b=Guid.NewGuid().ToString("D");
        var own=new OwnedShowLoadPolicy();
        Check("cancel before arrival",own.Cancel(a)&&!own.CanLoad(a));
        Check("new registration allowed",own.CanLoad(b));own.Loaded(b);
        Check("old cancellation preserves current",own.Cancel(a)&&!own.Cancelled&&own.ClientLoadId==b);
        Check("duplicate load rejected",!own.CanLoad(b));
        Check("malformed nonce rejected",!own.Cancel("bad")&&!own.CanLoad("bad"));
        var full=new OwnedShowLoadPolicy();var currentId=Guid.NewGuid().ToString("D");full.Loaded(currentId);
        for(int i=0;i<4096;i++)full.Cancel(Guid.NewGuid().ToString("D"));
        Check("capacity blocks new load but permits current stop",!full.CanLoad(Guid.NewGuid().ToString("D"))&&full.Cancel(currentId)&&full.Cancelled);
        var json="""
        {"protocolVersion":1,"projectId":"project","name":"test","compiler":"stage-show-review-v2","durationMs":2000,
        "capabilities":[{"name":"x1-input-v1","minProtocol":1}],"performers":[{"id":"p","name":"one"}],"events":[
        {"id":"path","performerId":"p","kind":"movement","startMs":0,"durationMs":1000,"x1":{"version":1,"failurePolicy":"stopShow","locomotion":"walk","arrivalToleranceM":0.12,"maxCorrectionM":0.05,"points":[{"tMs":0,"x":0,"z":0},{"tMs":1000,"x":0,"z":0}]}},
        {"id":"turn","performerId":"p","kind":"facing","startMs":1000,"durationMs":1000,"x1":{"version":1,"failurePolicy":"stopShow","mode":"transition","transitionFromDeg":350,"transitionToDeg":370}}],
        "x1":{"version":1,"bindings":[{"performerId":"p","actorId":"123","territoryId":816,"stage":{"id":"stage","originX":0,"originZ":0,"yawDeg":0}}]}}
        """;
        using var doc=JsonDocument.Parse(json);var parsed=ShowProtocolParser.Parse(doc.RootElement);
        Check("wire parses",parsed.Package!=null);if(parsed.Package==null){Console.WriteLine(parsed.Error);return 1;}
        var pkg=parsed.Package;
        Check("transition preparation accepted",ShowValidator.ValidateForPreparation(pkg).Ok);
        var pose=new X1CalibrationPose(100,123,816,10,0,20,0);
        var valid=true;var review=StagePathMappingReview.Create(pkg,"source",a,pose,()=>{if(!valid)throw new InvalidOperationException();});
        Reject("rotation invalidates review",()=>review.Consume(pose with{RotationRad=0.1}));
        Reject("returning to old pose does not restore review",()=>review.Consume(pose));
        review=StagePathMappingReview.Create(pkg,"source",a,pose,()=>{});
        var mapped=review.Consume(pose);Check("mapping anchored",mapped.X1!.Bindings[0].Stage.OriginX==10&&mapped.X1.Bindings[0].Stage.OriginZ==20);
        Reject("confirmation consumed once",()=>review.Consume(pose));
        var stale=StagePathMappingReview.Create(pkg,"source",a,pose,()=>{if(!valid)throw new InvalidOperationException();});valid=false;
        Reject("old registration invalidates review",()=>stale.Consume(pose));
        var plan=new X1CameraPathPlan(pkg,"path",()=>{},"package",a);
        var bindings=new X1KeyBindings(new byte[]{87,83,65,68,81,69});
        X1ReferenceDiagnosticObservation Observation(long at)=>new(bindings,new(at,123,816,0,0,0,0),
            new X1MovementReferenceSnapshot{AtMs=at,CameraDirH=0,CameraDirV=0,CameraControlMode=1,CameraZoomMode=1,ActiveCameraIndex=0,
                EventCameraAutoControl=false,IsWalking=true,IsWalkingDuringAutorun=false,CameraPosition=new(0,0,0),CameraLookAt=new(0,0,1),Reason=""},
            0,new(true,true,true,true,false,false,true,"",0,0,0),true,"");
        var observation=Observation(50);
        var ctor=typeof(X1CameraRelativeProfile).GetConstructors(System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Single();
        var profile=(X1CameraRelativeProfile)ctor.Invoke(new object[]{observation,new[]{new X1CameraControlResponse(X1Control.Forward,0,0,0,0,1,3)},0d});
        var feedback=new X1CameraFeedbackSession(_=>{},()=>{},()=>false,()=>observation);
        feedback.BeginPath(profile,observation,plan,0,false,false);
        for(long t=100;t<=1000;t+=50){observation=Observation(t);feedback.Tick(observation);}
        Check("six-argument path keeps original epoch",feedback.LastReport?.Completed==true&&feedback.LastReport.PathStartedAtMs==0&&feedback.LastReport.AtMs==1000);
        Check("first sample preserves lateness",feedback.LastReport?.PathSamples?[0].LocalMs==50);
        Reject("expired path cannot restart clock",()=>feedback.BeginPath(profile,Observation(1000),plan,0,false,false));
        Check("cooperation excludes automatic keys",StageManualControl.SupportedKeys(bindings).SequenceEqual(new byte[]{83,65,68}));
        long bound=0;int arms=0,stops=0,opens=0,closes=0;
        var path=new StagePathShowDispatcher(plan,()=>arms++,()=>{},()=>stops++,t=>bound=t,()=> (false,true,""));
        var mixed=new StageShowDispatcher(pkg,path,()=>{},e=>ShowDispatchResult.Success(),()=>5000,()=>opens++,()=>closes++);
        mixed.OnShowStart();mixed.BindShowClock(5000);Check("path dispatch",mixed.Dispatch(pkg.Events[0]).Ok);
        Check("path clock bound to show origin",mixed.UpdateActive(0).Ok&&bound==5000);
        mixed.OnStop();mixed.OnStop();Check("lifecycle exactly once",arms==1&&stops==1&&opens==1&&closes==1);
        var policy=new X1ManualTakeoverPolicy();policy.Enable(new byte[]{65,66},0);policy.Heartbeat(0,true,true,true);
        policy.SetCooperativeKeys(new byte[]{66});Check("arm physical policy",policy.TryArm(0,out _));policy.ActivateCooperation();
        policy.ObserveKey(66,true,false,true);Check("independent cooperative key",policy.Snapshot(0).CooperativeHeld&&!policy.Snapshot(0).ManualTakeover);
        policy.ObserveKey(65,true,false,true);policy.ObserveKey(65,false,false,true);policy.ObserveKey(66,false,false,true);
        Check("automatic same key permanently interrupts",policy.Snapshot(0).ManualTakeover&&!policy.TryArm(0,out _));
        Check("clock/status private",ReadAuthPolicy.IsPairedPlayRead("/shows/clock")&&ReadAuthPolicy.IsPairedPlayRead("/x1/status"));
        Check("method constraints",PlaybackApiPolicy.OtherMethodAllow("/shows/stop-owned")=="POST"&&PlaybackApiPolicy.PostWrongMethodAllow("/shows/clock")=="GET, HEAD");
        long clock=1000;var dispatcher=new FakeShowDispatcher();var runner=new ShowRunner(dispatcher,()=>clock);
        var motions=new ShowPackage{ProtocolVersion=1,ProjectId="project",Name="many",DurationMs=2000};
        motions.Performers.Add(new ShowPerformer{Id="p",Name="one"});
        for(int i=0;i<40;i++)motions.Events.Add(new ShowEvent{Id="e"+i,Kind="cue",PerformerId="p",StartMs=i*10,DurationMs=0});
        runner.Load(motions);runner.SetGuardProvider(()=>new GuardSnapshot());runner.Arm();runner.Start(0);runner.Tick();clock+=400;runner.Tick();
        using var status=JsonDocument.Parse(runner.StatusJson(true));Check("all event identities retained",status.RootElement.GetProperty("events").GetArrayLength()==40);
        runner.RequestStop("manual");clock+=100;runner.Tick();Check("stop blocks future output",runner.DispatchedCount==40);
        // —— 独立验收返工 R1：旧无身份停止不得影响带归属的新场次；旧口径与定向停止保留。 ——
        long r1clock=1000;var r1sink=new Sink();var r1=new ShowRunner(r1sink,()=>r1clock);r1.SetGuardProvider(()=>new GuardSnapshot());
        var ownedPkg=new ShowPackage{ProtocolVersion=1,ProjectId="p",Name="owned",DurationMs=2000};
        ownedPkg.Performers.Add(new ShowPerformer{Id="p",Name="one"});
        ownedPkg.Events.Add(new ShowEvent{Id="e",Kind="cue",PerformerId="p",StartMs=100,DurationMs=0});
        var ownedId=Guid.NewGuid().ToString("D");
        Check("R1 owned load",r1.Load(ownedPkg,ownedId,true).Ok);
        var r1c=r1.GetScheduledStartClock();Check("R1 owned arm",r1.ArmBound(r1c.PackageId,ownedId).Ok);
        r1c=r1.GetScheduledStartClock();Check("R1 owned schedule",r1.ScheduleStart(r1c.PackageId,r1c.ArmId!,Guid.NewGuid().ToString("D"),2000).Ok);
        var stopLegacy=r1.StopLegacy("旧无身份停止");
        Check("R1 legacy stop refused for owned show",!stopLegacy.Ok&&r1.State==ShowState.Countdown&&r1sink.Stops==0&&r1.GetScheduledStartClock().ClientLoadId==ownedId);
        var wrongStop=r1.StopOwnedLoad(Guid.NewGuid().ToString("D"),reason:"错误身份");
        Check("R1 wrong owned stop does not alter new show",!wrongStop.MatchedCurrent&&r1.State==ShowState.Countdown&&r1sink.Stops==0);
        r1.StopLegacy("重试旧停止");
        Check("R1 repeated legacy stop still no effect",r1.State==ShowState.Countdown&&r1sink.Stops==0);
        var ownedStop=r1.StopOwnedLoad(ownedId,reason:"装载页面定向停止");
        Check("R1 owned targeted stop works",ownedStop.Ok&&ownedStop.MatchedCurrent&&r1.State!=ShowState.Countdown&&r1sink.Stops==1);
        var legacySink=new Sink();var legacyRunner=new ShowRunner(legacySink,()=>r1clock);legacyRunner.SetGuardProvider(()=>new GuardSnapshot());
        legacyRunner.Load(ownedPkg);legacyRunner.Arm();legacyRunner.Start(0);legacyRunner.Tick();
        var legacyStop=legacyRunner.StopLegacy("网页请求停止");
        Check("R1 legacy stop still stops legacy show",legacyStop.Ok&&legacySink.Stops==1);
        // —— 返工 R2：Arm 消费一次性确认后，开演前上下文见证仍须复核且不回退。 ——
        var runnerType=typeof(ShowRunner);
        long r2clock=1000;
        var r2pose=new X1CalibrationPose(100,123,816,10,0,20,0);
        ShowRunner R2Runner(bool regReady,out Action<bool> setReg){var valid=regReady;setReg=v=>valid=v;
            var r=new ShowRunner(new Sink(),()=>r2clock);
            r.SetRegistrationFactory((p,pid,lid)=>new PreparedShowRegistration(p,new Sink(),()=>{if(!valid)throw new InvalidOperationException("登记已取消");},null));
            return r;}
        void R2Confirm(ShowRunner r,string load,Func<bool> context){r.SetGuardProvider(()=>new GuardSnapshot());
            var rev=StagePathMappingReview.Create(pkg,"source",load,r2pose,()=>{},()=>{if(!context())throw new InvalidOperationException("输入模式或键位已变化");});
            runnerType.GetMethod("ConfirmStageMapping",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(r,new object[]{rev,r2pose});}
        void R2Observe(ShowRunner r,X1CalibrationPose pose)=>runnerType.GetMethod("ObserveStageMapping",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(r,new object[]{pose});
        var r2=R2Runner(true,out _);var r2load=Guid.NewGuid().ToString("D");var r2context=true;
        Check("R2 stage owned load",r2.Load(pkg,r2load,true).Ok);R2Confirm(r2,r2load,()=>r2context);
        var r2c=r2.GetScheduledStartClock();Check("R2 arm consumes one-use confirmation",r2.ArmBound(r2c.PackageId,r2c.ClientLoadId!).Ok&&!r2.StageMappingConfirmed);
        R2Observe(r2,r2pose with{RotationRad=.5});R2Observe(r2,r2pose);
        r2c=r2.GetScheduledStartClock();var r2poseReject=r2.ScheduleStart(r2c.PackageId,r2c.ArmId!,Guid.NewGuid().ToString("D"),2000);
        Check("R2 changed pose after arm rejects and return does not restore",!r2poseReject.Ok&&r2poseReject.Message.Contains("上下文见证"));
        var r2b=R2Runner(true,out _);var r2bload=Guid.NewGuid().ToString("D");var r2bcontext=true;
        Check("R2b stage load",r2b.Load(pkg,r2bload,true).Ok);R2Confirm(r2b,r2bload,()=>r2bcontext);
        r2c=r2b.GetScheduledStartClock();Check("R2b arm",r2b.ArmBound(r2c.PackageId,r2c.ClientLoadId!).Ok);r2bcontext=false;
        r2c=r2b.GetScheduledStartClock();var r2contextReject=r2b.ScheduleStart(r2c.PackageId,r2c.ArmId!,Guid.NewGuid().ToString("D"),2000);
        Check("R2 mode/key change after arm rejects schedule",!r2contextReject.Ok&&r2contextReject.Message.Contains("模式或键位"));
        r2c=r2b.GetScheduledStartClock();var r2contextRetry=r2b.ScheduleStart(r2c.PackageId,r2c.ArmId!,Guid.NewGuid().ToString("D"),2000);
        Check("R2 failed witness stays failed",!r2contextRetry.Ok&&r2contextRetry.Message.Contains("上下文见证"));
        var r2cRunner=R2Runner(false,out var r2cSetReg);var r2cload=Guid.NewGuid().ToString("D");
        r2cSetReg(true);Check("R2c stage load",r2cRunner.Load(pkg,r2cload,true).Ok);R2Confirm(r2cRunner,r2cload,()=>true);
        r2c=r2cRunner.GetScheduledStartClock();Check("R2c arm",r2cRunner.ArmBound(r2c.PackageId,r2c.ClientLoadId!).Ok);r2cSetReg(false);
        r2c=r2cRunner.GetScheduledStartClock();var r2regReject=r2cRunner.ScheduleStart(r2c.PackageId,r2c.ArmId!,Guid.NewGuid().ToString("D"),2000);
        Check("R2 registration invalidation rejects schedule",!r2regReject.Ok&&r2regReject.Message.Contains("登记已取消"));
        var r2d=R2Runner(true,out _);var r2dload=Guid.NewGuid().ToString("D");
        Check("R2d stage load",r2d.Load(pkg,r2dload,true).Ok);R2Confirm(r2d,r2dload,()=>true);
        r2c=r2d.GetScheduledStartClock();Check("R2d arm",r2d.ArmBound(r2c.PackageId,r2c.ClientLoadId!).Ok);
        r2c=r2d.GetScheduledStartClock();Check("R2 valid witness still schedules",r2d.ScheduleStart(r2c.PackageId,r2c.ArmId!,Guid.NewGuid().ToString("D"),2000).Ok);
        var r2e=R2Runner(true,out _);var r2eload=Guid.NewGuid().ToString("D");
        Check("R2e stage load",r2e.Load(pkg,r2eload,true).Ok);R2Confirm(r2e,r2eload,()=>true);
        r2c=r2e.GetScheduledStartClock();r2e.ArmBound(r2c.PackageId,r2c.ClientLoadId!);
        r2c=r2e.GetScheduledStartClock();r2e.ScheduleStart(r2c.PackageId,r2c.ArmId!,Guid.NewGuid().ToString("D"),3000);
        R2Observe(r2e,r2pose with{X=11});r2clock=3000;r2e.Tick();
        Check("R2 countdown pose change stops before output",r2e.State==ShowState.Faulted&&r2e.StopReason.Contains("上下文"));
        // —— 返工 R3：活动更新失败绑定到具体事件结果；登记/失败证据分离，不声称效果。 ——
        var r3pkg=new ShowPackage{ProtocolVersion=1,ProjectId="p",Name="active",DurationMs=1500};
        r3pkg.Performers.Add(new ShowPerformer{Id="p",Name="one"});
        r3pkg.Events.Add(new ShowEvent{Id="f",Kind="facing",PerformerId="p",StartMs=0,DurationMs=1000});
        long r3clock=2000;
        ShowRunner R3Runner(ActiveSink sink){var r=new ShowRunner(sink,()=>r3clock);r.SetGuardProvider(()=>new GuardSnapshot());
            r.Load(r3pkg);r.Arm();r.Start(0);r.Tick();return r;}
        var firstSink=new ActiveSink{FailOnUpdate=1};var first=R3Runner(firstSink);first.Tick();
        Check("R3 first-update failure faults before effect claim",first.State==ShowState.Faulted&&firstSink.Writes==1);
        using(var d=JsonDocument.Parse(first.StatusJson(true))){var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");
            Check("R3 first-update failure bound to event result",!o.GetProperty("Ok").GetBoolean()&&o.GetProperty("Reason").GetString()!.Contains("native write rejected")
                &&o.GetProperty("EvidenceState").GetString()=="active-update-failed"&&o.GetProperty("DispatchedShowMs").GetInt64()==0&&o.GetProperty("EvidenceMonoMs").GetInt64()>0);}
        r3clock=2000;var delayedSink=new ActiveSink{FailOnUpdate=3};var delayed=R3Runner(delayedSink);
        r3clock=2100;delayed.Tick();r3clock=2300;delayed.Tick();r3clock=2600;delayed.Tick();
        Check("R3 delayed failure faults",delayed.State==ShowState.Faulted&&delayedSink.Writes==3);
        using(var d=JsonDocument.Parse(delayed.StatusJson(true))){var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");
            Check("R3 delayed failure bound with time and reason",!o.GetProperty("Ok").GetBoolean()&&o.GetProperty("EvidenceMonoMs").GetInt64()==2600
                &&o.GetProperty("DispatchedShowMs").GetInt64()==100&&o.GetProperty("Reason").GetString()!.Contains("活动更新失败"));}
        r3clock=2000;var normalSink=new ActiveSink{FailOnUpdate=0};var normal=R3Runner(normalSink);
        r3clock=2100;normal.Tick();r3clock=2500;normal.Tick();r3clock=3600;normal.Tick();
        Check("R3 normal updates complete without failure evidence",normal.State==ShowState.Completed&&normalSink.Writes>=3);
        using(var d=JsonDocument.Parse(normal.StatusJson(true))){var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");
            Check("R3 normal release keeps admission only",o.GetProperty("Ok").GetBoolean()&&o.GetProperty("EvidenceState").GetString()=="");}
        r3clock=2000;var reentrantSink=new ActiveSink{FailOnUpdate=1};
        var reentrant=R3Runner(reentrantSink);reentrantSink.OnUpdate=()=>reentrant.RequestStop("人工接管");r3clock=2100;reentrant.Tick();
        Check("R3 reentrant takeover before failure leaves no fake failure",reentrant.State==ShowState.Loaded&&reentrantSink.Writes==1);
        using(var d=JsonDocument.Parse(reentrant.StatusJson(true))){var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");
            Check("R3 interruption keeps admission without failure claim",o.GetProperty("Ok").GetBoolean()&&o.GetProperty("EvidenceState").GetString()=="");}
        // R3-EX: real path callbacks, explicit ownership, and stop reentrancy.
        foreach(var mode in new[]{"begin","tick","check","stop-begin","stop-tick","stop-begin-cleanup"})
        {
            long t=1000;int ticks=0;bool throwCheck=false;ShowRunner? r=null;
            var ps=new StagePathShowDispatcher(plan,()=>{},()=>{if(throwCheck)throw new InvalidOperationException("check failed");},()=>{if(mode=="stop-begin-cleanup")throw new InvalidOperationException("cleanup failed");},
                _=>{if(mode=="begin")throw new InvalidOperationException("begin failed");if(mode.StartsWith("stop-begin"))r!.RequestStop("manual");},
                ()=>{ticks++;if(mode=="stop-tick"){r!.RequestStop("manual");throw new InvalidOperationException("after stop");}
                    if(mode=="tick"&&ticks==2)throw new InvalidOperationException("tick failed");return (true,false,"");});
            r=new ShowRunner(ps,()=>t);r.SetGuardProvider(()=>new GuardSnapshot());
            r.SetRegistrationFactory((p,pid,lid)=>new PreparedShowRegistration(p,ps,()=>{},null));
            var lid=Guid.NewGuid().ToString("D");r.Load(pkg,lid,true);
            var rev=StagePathMappingReview.Create(pkg,"source",lid,pose,()=>{},()=>{});
            runnerType.GetMethod("ConfirmStageMapping",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(r,new object[]{rev,pose});
            var c=r.GetScheduledStartClock();Check("R3-EX "+mode+" arm",r.ArmBound(c.PackageId,c.ClientLoadId!).Ok);
            c=r.GetScheduledStartClock();Check("R3-EX "+mode+" schedule",r.ScheduleStart(c.PackageId,c.ArmId!,Guid.NewGuid().ToString("D"),2000).Ok);
            t=2000;r.Tick();if(mode=="check")throwCheck=true;t=2100;r.Tick();
            using var d=JsonDocument.Parse(r.StatusJson(true));var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");
            if(mode.StartsWith("stop")){
                Check("R3-EX "+mode+" no false failure",r.State==(mode=="stop-begin-cleanup"?ShowState.Faulted:ShowState.Loaded)&&o.GetProperty("Ok").GetBoolean());
                Check("R3-EX "+mode+" no update after stop",ticks==(mode.StartsWith("stop-begin")?0:1));
            }else{
                Check("R3-EX "+mode+" bound failure",r.State==ShowState.Faulted&&!o.GetProperty("Ok").GetBoolean()&&o.GetProperty("EvidenceState").GetString()=="active-update-failed");
                Check("R3-EX "+mode+" retained registration timestamp",o.GetProperty("DispatchedShowMs").GetInt64()==0&&o.GetProperty("EvidenceMonoMs").GetInt64()==(mode=="begin"?2000:2100));
            }
        }
        foreach(var throws in new[]{false,true}){
            r3clock=2000;var ambiguous=new ActiveSink{FailOnUpdate=1,FailureId="",ThrowOnFailure=throws};var ar=R3Runner(ambiguous);ar.Tick();
            using var d=JsonDocument.Parse(ar.StatusJson(true));var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");
            Check("R3-EX ambiguous "+throws+" never guesses nearby event",ar.State==ShowState.Faulted&&o.GetProperty("Ok").GetBoolean()&&o.GetProperty("EvidenceState").GetString()=="");
        }
        var fsink=new ThrowFacing();var faceDispatcher=new X1ShowDispatcher("p"){MovementSink=new NoMovement(),FacingSink=fsink};
        Check("R3-EX facing registration",faceDispatcher.AddFacing(new X1FacingInput{EventId="f",PerformerId="p",FacingMode=X1FacingMode.FixedAngle,FixedAngleDeg=90}).Ok);
        r3clock=2000;var fr=new ShowRunner(faceDispatcher,()=>r3clock);fr.SetGuardProvider(()=>new GuardSnapshot());fr.Load(r3pkg);fr.Arm();fr.Start(0);fr.Tick();fr.Tick();
        using(var d=JsonDocument.Parse(fr.StatusJson(true))){var o=d.RootElement.GetProperty("events")[0].GetProperty("outcome");Check("R3-EX facing throw bound",fr.State==ShowState.Faulted&&!o.GetProperty("Ok").GetBoolean()&&o.GetProperty("EvidenceState").GetString()=="active-update-failed");}
        Console.WriteLine($"solo-show {total-failed}/{total}, failed={failed}");return failed==0?0:1;
    }
    private sealed class ThrowFacing : IX1FacingSink
    {
        public void EmitFacing(string id,double angle,long time)=>throw new InvalidOperationException("facing failed");
        public void ReleaseFacing(string id){}
    }
    private sealed class NoMovement : IX1MovementSink
    {
        public void EmitCorrection(string id,double dx,double dz,double x,double z,long t){}
        public void ReleaseMovement(string id){}
    }
    private sealed class Sink : IShowDispatcher
    {
        public int Stops;
        public void OnShowStart(){}
        public void OnStop(){Stops++;}
        public ShowDispatchResult Dispatch(ShowEvent e)=>ShowDispatchResult.Success();
    }
    private sealed class ActiveSink : IShowDispatcher,IX1ActiveUpdater
    {
        public int Stops,Writes;public int FailOnUpdate;public Action? OnUpdate;public string FailureId="f";public bool ThrowOnFailure;
        public void OnShowStart(){}
        public void OnStop(){Stops++;}
        public ShowDispatchResult Dispatch(ShowEvent e)=>ShowDispatchResult.Success();
        public (bool Ok,string Error,List<X1SkipRecord>? Skips,string FailedEventId) UpdateActive(long t)
        {
            Writes++;OnUpdate?.Invoke();
            if(FailOnUpdate>0&&Writes>=FailOnUpdate){if(ThrowOnFailure)throw new InvalidOperationException("unknown owner");return (false,"native write rejected",null,FailureId);}
            return (true,"",null,"");
        }
    }
}
