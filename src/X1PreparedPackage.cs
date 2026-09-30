// 这个文件是干嘛的：先冻结并验证整包，返回无游戏写入的不可变登记材料，调用方才能原子采用。
using System;
using System.Collections.Generic;
using System.Linq;

namespace ChoreoHelper;

public sealed class X1PreparedEvent
{
    public string EventId { get; }
    public string PerformerId { get; }
    public string Kind { get; }
    public long StartMs { get; }
    public long DurationMs { get; }
    public X1EventInput Input { get; }
    internal X1PreparedEvent(ShowEvent value)
    {
        EventId = value.Id; PerformerId = value.PerformerId; Kind = value.Kind;
        StartMs = value.StartMs; DurationMs = value.DurationMs; Input = value.X1!;
    }
}

/// <summary>整包快照在验证前建立；请求、返回的 DTO 和执行器输入均不能修改此结果。</summary>
public sealed class X1PreparedPackage
{
    private readonly ShowPackage _snapshot;
    public string PackageId { get; }
    public string ClientLoadId { get; }
    public X1ActorBinding LocalBinding { get; }
    public IReadOnlyList<X1ActorBinding> Bindings => _snapshot.X1!.Bindings;
    public IReadOnlyList<X1PreparedEvent> Events { get; }

    private X1PreparedPackage(ShowPackage snapshot, string packageId, string clientLoadId)
    {
        _snapshot = snapshot; PackageId = packageId; ClientLoadId = clientLoadId;
        Events = Array.AsReadOnly(snapshot.Events.Where(e => e.X1 != null).Select(e => new X1PreparedEvent(e)).ToArray());
        LocalBinding = snapshot.X1!.Bindings.Single(b => b.PerformerId == Events[0].PerformerId);
    }

    public static (bool Ok, string Error, X1PreparedPackage? Prepared) TryPrepare(
        ShowPackage package, string packageId, string clientLoadId, bool ownsMovementFacing = true)
    {
        if (string.IsNullOrWhiteSpace(packageId) || string.IsNullOrWhiteSpace(clientLoadId))
            return (false, "X1 整包装载需要明确 packageId 和 clientLoadId，不能登记匿名请求", null);
        try
        {
            var snapshot = ClonePackage(package);
            var validation = ShowValidator.ValidateForPreparation(snapshot, ownsMovementFacing);
            if (!validation.Ok) return (false, validation.FirstError ?? "X1 整包校验失败", null);
            if (snapshot.X1 == null) return (false, "没有版本化 X1 输入可准备", null);
            return (true, "", new X1PreparedPackage(snapshot, packageId, clientLoadId));
        }
        catch (Exception ex) { return (false, "X1 整包准备失败：" + ex.Message, null); }
    }

    public ShowPackage CreatePackageSnapshot() => ClonePackage(_snapshot);

    /// <summary>旧 motion/cue/lyrics 元数据逐项复制；只共享已证明不可变的 X1 输入对象。</summary>
    public static ShowPackage ClonePackage(ShowPackage source)
    {
        if (source == null) throw new ArgumentNullException(nameof(source));
        var copy = new ShowPackage { ProtocolVersion = source.ProtocolVersion, Compiler = source.Compiler,
            ProjectId = source.ProjectId, Name = source.Name, DurationMs = source.DurationMs,
            TimelineRevision = source.TimelineRevision, ProjectHash = source.ProjectHash, X1 = source.X1 };
        foreach (var p in source.Performers) copy.Performers.Add(new ShowPerformer { Id = p.Id, Name = p.Name });
        foreach (var c in source.Capabilities) copy.Capabilities.Add(new ShowCapability { Name = c.Name, MinProtocol = c.MinProtocol });
        foreach (var e in source.Events) copy.Events.Add(new ShowEvent { Id = e.Id, PerformerId = e.PerformerId,
            Kind = e.Kind, StartMs = e.StartMs, DurationMs = e.DurationMs, Command = e.Command, Name = e.Name,
            PlayMode = e.PlayMode, X1 = e.X1 });
        return copy;
    }
}
