// 整场动作与技能适配：共用走位输出租约与原生一次提交，不开第二个播放器。
using System;
using System.Globalization;
using System.Linq;

namespace ChoreoHelper;

internal sealed class NativeStageEvents : IDisposable
{
    private readonly X1InputPreparation _input;
    private readonly GameCommandExecutor _executor;
    private readonly string _owner;
    private readonly ulong _actor;
    private readonly uint _entity, _job, _territory;
    private readonly AbilityNativeExecutionAdapter _ability;
    public NativeStageEvents(ShowPackage package, string owner, X1InputPreparation input, GameCommandExecutor executor)
    {
        _input=input;_executor=executor;_owner=owner;
        var player=Plugin.ObjectTable.LocalPlayer ?? throw new InvalidOperationException("本地角色不可读");
        _actor=ulong.Parse(package.X1!.Bindings.Single().ActorId,CultureInfo.InvariantCulture);
        _entity=player.EntityId;_job=player.ClassJob.RowId;_territory=package.X1.Bindings.Single().TerritoryId;
        _input.ShowPathLease(owner);Check();
        _ability=new(Plugin.DataManager,Plugin.ObjectTable,Plugin.ClientState,Plugin.TargetManager,Plugin.Condition,
            Plugin.Framework,Plugin.GameInterop,executor.OutputOwnership,()=>{Check();return null;},_=>{Check();return null;});
    }
    private void Check()
    {
        _input.ShowPathLease(_owner);
        var player=Plugin.ObjectTable.LocalPlayer;
        if(player==null || !player.IsValid() || player.GameObjectId!=_actor || player.EntityId!=_entity
            || player.ClassJob.RowId!=_job || Plugin.ClientState.TerritoryType!=_territory || Plugin.ClientState.IsPvP)
            throw new InvalidOperationException("本场角色、职业、区域或场景已变化");
    }
    public ShowDispatchResult Dispatch(ShowEvent e)
    {
        Check();var lease=_input.ShowPathLease(_owner);
        if(e.Kind=="motion")return SkillMotionCommands.IsKnown(Plugin.DataManager,e.Command)&&_executor.SubmitBoundedPlayback(e.Command,lease)
            ? new ShowDispatchResult{Ok=true,Reason="普通动作已提交；实际效果须观察"}:ShowDispatchResult.Fail("普通动作提交未确认；不重试");
        if(e.Kind!="ability" || e.X1!.TargetId!=_actor.ToString(CultureInfo.InvariantCulture))return ShowDispatchResult.Fail("事件不属于本场明确范围");
        var action=uint.Parse(e.X1.CreateAbilityInput(e.Id,e.PerformerId).ActionId,CultureInfo.InvariantCulture);
        AbilityExecutionResult? result=null;
        if(!lease.TryRun(()=>{Check();result=_ability.AttemptOnce(new(e.Id,action,_actor,_entity,_actor,_job,_territory));return true;}))
            return ShowDispatchResult.Fail("输出租约已取消");
        var message=$"Action{action} → #{_actor}：{result!.Message}；原生返回 {result.NativeReturned}；提交时间 {result.SubmittedAtMs}；效果未独立确认";
        var dispatched=result.Exception!=null ? ShowDispatchResult.Fail(message)
            : result.NativeReturned ? new ShowDispatchResult{Ok=true,Reason=message}:ShowDispatchResult.Skip(message,"ability-attempt","未确认，不重试");
        dispatched.AbilityAttempt=result;
        return dispatched;
    }
    public void Dispose()=>_ability.Dispose();
}
