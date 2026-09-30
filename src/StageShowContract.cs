// 短场次协议：多段链式路径（每段≤4秒/1.5米实测包络，编译器无损切分）、原事件身份和时刻；V2 技能只尝试一次，不做前置条件判断。
// 独立朝向（INT-20260915-STAGE-FACING-EXEC）：四键模式下不与任何路径段重叠的朝向事件可执行；本场结束由末段路径或末条朝向按原时序覆盖。
using System;
using System.Linq;
using System.Collections.Generic;

namespace ChoreoHelper;

public static class StageShowContract
{
    public const string MixedCompiler = "stage-show-review-v2";
    public const string FacingCapability = "stageFacingV1";
    /// <summary>按节点自动切换走/跑（TASK-20260919-PATH-LOCOMOTION）：宣告后网页按混合模式登记，插件在每段开始前自动切步态。</summary>
    public const string LocomotionCapability = "stageLocomotionAutoV1";
    /// <summary>整场上限（主人裁定 5 分钟）；每段路径仍限实测包络 4 秒，见 X1CameraFeedbackPolicy.MaxTotalMs。</summary>
    public const long MaxShowMs = 300000;
    public const int MaxEvents = 128;
    public static bool IsStage(ShowPackage p) => p.Compiler is "stage-path-review-v1" or MixedCompiler;
    /// <summary>校验并返回有序路径段（首段从 0 开始，段间不重叠；本场结束由末段路径或末条朝向按原时序覆盖）。</summary>
    public static List<ShowEvent> Paths(ShowPackage p)
    {
        if (!IsStage(p) || p.Performers.Count!=1 || p.X1?.Bindings.Count!=1)
            throw new InvalidOperationException("需要明确登记的单人短场次和当前角色映射");
        if(p.DurationMs<=0 || p.DurationMs>MaxShowMs)
            throw new InvalidOperationException("整场最长 "+(MaxShowMs/1000)+" 秒；不能裁剪或补时");
        var paths=p.Events.Where(e=>e.Kind=="movement").OrderBy(e=>e.StartMs).ToList();
        if(paths.Count<1 || paths[0].StartMs!=0)
            throw new InvalidOperationException("须有从0开始的路径段；不能裁剪或重定时");
        var facings=Facings(p,paths);
        var lastEnd=paths[^1].StartMs+paths[^1].DurationMs;
        if(facings.Count>0)lastEnd=Math.Max(lastEnd,facings.Max(f=>f.StartMs+f.DurationMs));
        if(lastEnd!=p.DurationMs)
            throw new InvalidOperationException(lastEnd>p.DurationMs?"本场事件越过演出时长；不能裁剪或补时":"本场结束须由末段路径或末条朝向按原时序覆盖；不能裁剪或补时");
        var ids=new HashSet<string>();var times=new HashSet<long>();
        for(var i=0;i<paths.Count;i++)
        {
            var seg=paths[i];
            if(seg.DurationMs<=0 || seg.DurationMs>X1CameraFeedbackPolicy.MaxTotalMs)
                throw new InvalidOperationException("每段路径仍限4秒内；超长路径须由编译器无损切分");
            if(i>0 && seg.StartMs<paths[i-1].StartMs+paths[i-1].DurationMs)
                throw new InvalidOperationException("路径段不得重叠");
            if(!ids.Add(seg.Id) || !X1ShowProtocol.IsIdentity(seg.Id) || seg.PerformerId!=p.Performers[0].Id
                || seg.StartMs>p.DurationMs || seg.DurationMs>p.DurationMs-seg.StartMs)
                throw new InvalidOperationException("本场路径段身份、演员或原时序无效");
        }
        if(p.Compiler=="stage-path-review-v1" && p.Events.Count!=1)
            throw new InvalidOperationException("原单路径版本不接受混排");
        if(p.Events.Count>MaxEvents)throw new InvalidOperationException("短场次最多"+MaxEvents+"条事件");
        foreach(var e in p.Events)
        {
            if(e.Kind=="movement")continue;
            if(!ids.Add(e.Id) || !X1ShowProtocol.IsIdentity(e.Id) || e.PerformerId!=p.Performers[0].Id
                || e.StartMs<0 || e.DurationMs<0 || e.StartMs>p.DurationMs || e.DurationMs>p.DurationMs-e.StartMs)
                throw new InvalidOperationException("本场事件身份、演员或原时序无效");
            if(e.Kind=="facing")continue; // 朝向专项（X1 输入、正时长、四键不重叠）已在 Facings 完成
            if(e.Kind is not ("motion" or "ability"))throw new InvalidOperationException("本场不支持其他轨道；须先明确审阅范围");
            if(e.StartMs==0 || e.StartMs>=p.DurationMs || !times.Add(e.StartMs))
                throw new InvalidOperationException("动作与技能须在场内有独立触发时刻；不能自动重排");
            if(e.Kind=="motion" && e.PlayMode is not ("" or "once"))
                throw new InvalidOperationException("本场仅支持原地单次动作，不能改写循环语义");
            if(e.Kind=="ability" && (e.X1==null || e.X1.TargetId!=p.X1.Bindings[0].ActorId || e.X1.FailurePolicy!=X1FailurePolicy.Skip))
                throw new InvalidOperationException("本场技能仅明确自身目标，失败继续且不重试");
        }
        return paths;
    }
    /// <summary>独立朝向专项校验：须有可解析 X1 输入、正时长、失败即停；沿用四键规则不得与任何路径段重叠。</summary>
    private static List<ShowEvent> Facings(ShowPackage p,List<ShowEvent> paths)
    {
        var facings=p.Events.Where(e=>e.Kind=="facing").ToList();
        foreach(var e in facings)
        {
            if(e.DurationMs<=0)throw new InvalidOperationException("本场独立朝向须有正持续时间；不能裁剪或重定时");
            if(e.X1==null)throw new InvalidOperationException("本场独立朝向缺少明确 X1 输入");
            X1FacingInput input;
            try{input=e.X1.CreateFacingInput(e.Id,e.PerformerId);}
            catch(Exception ex)when(ex is InvalidOperationException or ArgumentException)
            {throw new InvalidOperationException("本场朝向输入无效："+ex.Message);}
            if(input.FailurePolicy!=X1FailurePolicy.StopShow)
                throw new InvalidOperationException("本场独立朝向失败即整场停止；不支持静默跳过");
            foreach(var seg in paths)
                if(e.StartMs<seg.StartMs+seg.DurationMs && seg.StartMs<e.StartMs+e.DurationMs)
                    throw new InvalidOperationException("当前四键模式先转向再走，路径不能与独立朝向重叠；请把朝向移到路径外时段，不能裁剪或重定时");
        }
        return facings;
    }
    public static ShowEvent Path(ShowPackage p)=>Paths(p)[0];
}

public sealed class StageShowDispatcher : IShowDispatcher, IX1ActiveUpdater, IShowClockBinding
{
    private readonly StagePathShowDispatcher _path;
    private readonly X1ShowDispatcher? _facing;
    private readonly ShowPackage _package;
    private readonly Action _check, _open, _close;
    private readonly Func<ShowEvent,ShowDispatchResult> _dispatch;
    private readonly Func<long> _clock;
    private readonly HashSet<string> _sent=new();
    private long? _start;
    private bool _active;
    private bool _cleanupPending;
    public StageShowDispatcher(ShowPackage package, StagePathShowDispatcher path, Action check,
        Func<ShowEvent,ShowDispatchResult> dispatch, Func<long> clock, Action open, Action close)
        : this(package,path,null,check,dispatch,clock,open,close){ }
    /// <summary>facing 为已登记独立朝向的 X1 核（可空）；只复用本场时钟与既有朝向执行链，不新增播放器。</summary>
    public StageShowDispatcher(ShowPackage package, StagePathShowDispatcher path, X1ShowDispatcher? facing, Action check,
        Func<ShowEvent,ShowDispatchResult> dispatch, Func<long> clock, Action open, Action close)
    { StageShowContract.Paths(package);_package=X1PreparedPackage.ClonePackage(package);_path=path;_facing=facing;_check=check;_dispatch=dispatch;_clock=clock;_open=open;_close=close; }
    public void OnShowStart(){_path.OnShowStart();_active=true;_cleanupPending=true;try{_check();_open();_facing?.OnShowStart();_sent.Clear();_start=null;}catch{OnStop();throw;}}
    public void BindShowClock(long start){_path.BindShowClock(start);_start=start;}
    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        _check();
        if(!_active||!_start.HasValue||!_sent.Add(e.Id))return ShowDispatchResult.Fail("旧场次或重复事件已拒绝");
        var own=_package.Events.SingleOrDefault(x=>x.Id==e.Id);
        if(own==null || own.Kind!=e.Kind || own.StartMs!=e.StartMs || own.DurationMs!=e.DurationMs || own.Command!=e.Command)
            return ShowDispatchResult.Fail("事件与冻结的整场审阅不一致");
        if(e.Kind=="movement")return _path.Dispatch(own);
        var elapsed=_clock()-_start.Value;
        if(elapsed<own.StartMs || elapsed-own.StartMs>100 || elapsed>=_package.DurationMs)
            return ShowDispatchResult.Fail("本场事件错过原时刻；不追赶、不重试");
        if(e.Kind=="facing")return _facing==null
            ? ShowDispatchResult.Fail("本场未接入独立朝向执行链")
            : _facing.Dispatch(own);
        return _dispatch(own);
    }
    public (bool Ok,string Error,List<X1SkipRecord>? Skips,string FailedEventId) UpdateActive(long time)
    {
        // 先推进路径再推进朝向：边界相接的同一帧内先释放路径反馈，再让朝向取得输入安全检查。
        var pathResult=_path.UpdateActive(time);
        if(!_active)return (true,"",null,"");
        if(!pathResult.Ok)return pathResult;
        if(_facing==null)return pathResult;
        var facingResult=_facing.UpdateActive(time);
        if(!facingResult.Ok)return facingResult;
        if(facingResult.Skips==null)return pathResult;
        if(pathResult.Skips==null)return facingResult;
        var merged=new List<X1SkipRecord>(pathResult.Skips);
        merged.AddRange(facingResult.Skips);
        return (true,"",merged,"");
    }
    public void OnStop(){if(!_cleanupPending)return;_active=false;_start=null;Exception? failure=null;
        try{_facing?.OnStop();}catch(Exception ex){failure=ex;}
        try{_path.OnStop();}catch(Exception ex){failure??=ex;}
        finally{try{_close();}catch(Exception ex){failure??=ex;}}
        if(failure!=null)throw new InvalidOperationException(failure.Message);_cleanupPending=false;}
}
