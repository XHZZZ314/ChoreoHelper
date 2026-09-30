// 这个文件是干嘛的：舞台原生技能执行适配（显式动作的原生提交尝试）。
// 每事件最多一次框架线程调用；原生返回和实际效果分别记录。
using System;
using Dalamud.Plugin.Services;
using Dalamud.Game.ClientState.Conditions;
using System.Collections.Generic;
using FFXIVClientStructs.FFXIV.Client.Game;

namespace ChoreoHelper;

internal sealed unsafe class AbilityNativeExecutionAdapter : IDisposable
{
    private readonly IObjectTable _objects;
    private readonly IClientState _client;
    private readonly ITargetManager _targets;
    private readonly IFramework _framework;
    private readonly Func<object?>? _check;
    private readonly HashSet<string> _attempted=new(StringComparer.Ordinal);
    private bool _disposed;
    public AbilityNativeExecutionAdapter(IDataManager data, IObjectTable objects, IClientState client,
        ITargetManager targets, ICondition? conditions, IFramework framework, IGameInteropProvider interop,
        GameOutputOwnership ownership, Func<object?>? readReport, Func<object, object?>? trialReport)
    {
        _objects=objects;_client=client;_targets=targets;_framework=framework;_check=readReport;
    }

    public void Dispose() { _disposed=true; }

    public AbilityExecutionResult? AttemptOnce(AbilityExecutionIdentity identity)
    {
        if(_disposed || !_framework.IsInFrameworkUpdateThread)throw new InvalidOperationException("技能尝试须在有效场次的框架线程");
        _check?.Invoke();
        if(identity.ActionId==0 || !_attempted.Add(identity.EventId))throw new InvalidOperationException("无效或重复技能事件，不重试");
        var now=Environment.TickCount64;
        var manager=ActionManager.Instance();
        var player=_objects.LocalPlayer;
        var target=identity.TargetId==identity.ActorId?player:_targets.Target;
        if(manager==null || player==null || target==null || !player.IsValid() || !target.IsValid()
            || player.GameObjectId!=identity.ActorId || player.EntityId!=identity.ActorEntityId
            || player.ClassJob.RowId!=identity.JobId || _client.TerritoryType!=identity.TerritoryId || _client.IsPvP
            || target.GameObjectId!=identity.TargetId)
            throw new InvalidOperationException("提交边界角色、职业、区域或明确目标已变化");
        var position=target.Position;
        if(!float.IsFinite(position.X)||!float.IsFinite(position.Y)||!float.IsFinite(position.Z))throw new InvalidOperationException("明确目标位置不可读");
        _check?.Invoke();
        var submitted=Environment.TickCount64;
        bool? returned=null; ushort? sequence=null; string? exception=null;
        try
        {
            returned=manager->UseActionLocation(ActionType.Action,identity.ActionId,identity.TargetId,&position);
            sequence=manager->LastUsedActionSequence;
        }
        catch(Exception error){exception=error.Message;}
        return new AbilityExecutionResult
        {
            Identity=identity, State=exception!=null?"uncertain":returned==true?"attempted":"rejected",
            Message=exception!=null?"原生调用异常，效果未知，不重试":returned==true?"已调用原生一次，实际效果未知":"原生拒绝，跳过且不重试",
            StartedAtMs=now, SubmittedAtMs=submitted, FinishedAtMs=Environment.TickCount64,
            NativeInvoked=true, NativeReturnValue=returned, NativeReturned=returned==true,
            SourceSequence=sequence, Exception=exception,
        };
    }
}
