// 这个文件是干嘛的：舞台路径映射审阅（站位确认用的映射快照）。
// 来源登记、站位和运行条件绑定；确认只能消费一次，失效后不能恢复。
using System;
using System.Linq;
using System.Globalization;

namespace ChoreoHelper;

internal sealed class StagePathMappingReview
{
    private X1CalibrationPose _pose;
    private bool _consumed;
    private Action? _check;
    private Action? _preStartContext;
    private bool _preStartFailed;
    /// <summary>Create 的 preStartContext 是「模式/键位/角色」等上下文复读委托：一次性确认消费后
    /// 仍须在开演前复核（R2）；缺省表示没有额外上下文见证，站位本身由 ShowRunner 见证。</summary>
    public static StagePathMappingReview Create(ShowPackage source, string packageId, string loadId,
        X1CalibrationPose pose, Action check, Action? preStartContext = null)
    {
        if (!pose.IsFinite) throw new InvalidOperationException("角色站位不可读");
        var package=X1PreparedPackage.ClonePackage(source);
        var first=StageShowContract.Paths(package)[0].X1!.CreateMovementInput("mapping",package.Performers.Single().Id).Points[0];
        var old=package.X1!.Bindings.Single();
        if(old.ActorId!=pose.ActorId.ToString(CultureInfo.InvariantCulture)||old.TerritoryId!=pose.Territory)
            throw new InvalidOperationException("网页审阅后角色或区域已变化，请重新登记");
        var yaw=pose.RotationRad*180/Math.PI;
        var rotation=new X1StageTransform(old.Stage.Id,0,0,yaw);
        var offset=rotation.ToWorldVector(first.X,first.Z);
        package.X1=new X1PackageInput(new[]{new X1ActorBinding(old.PerformerId,old.ActorId,pose.Territory,
            new X1StageTransform(old.Stage.Id,pose.X-offset.X,pose.Z-offset.Z,yaw))});
        return new StagePathMappingReview(package,packageId,loadId,
            $"角色 #{pose.ActorId} / 区域 {pose.Territory}；路径起点映射到 ({pose.X:F3}, {pose.Z:F3})，正面 {yaw:F2}°；原节点和时刻不变。")
            {_pose=pose,_check=check,_preStartContext=preStartContext};
    }
    public StagePathMappingReview(ShowPackage package, string sourcePackageId, string sourceClientLoadId, string summary)
    {
        Package = package;
        SourcePackageId = sourcePackageId;
        SourceClientLoadId = sourceClientLoadId;
        Summary = summary;
    }

    public ShowPackage Package { get; }
    public string SourcePackageId { get; }
    public string SourceClientLoadId { get; }
    public string Summary { get; }

    public static bool SamePosition(X1CalibrationPose a, X1CalibrationPose b)
        => a.IsFinite && b.IsFinite && a.ActorId == b.ActorId && a.Territory == b.Territory
            && a.X == b.X && a.Y == b.Y && a.Z == b.Z && a.RotationRad == b.RotationRad;

    public ShowPackage Consume(X1CalibrationPose pose)
    {
        Observe(pose); _consumed=true;
        return X1PreparedPackage.ClonePackage(Package);
    }
    public void Observe(X1CalibrationPose pose)
    {
        try
        {
            if(_consumed || _check==null || !SamePosition(_pose,pose))throw new InvalidOperationException("映射已消费或站位方向变化，请重新审阅");
            _check();
        }
        catch{_consumed=true;throw;}
    }

    /// <summary>开演前上下文见证（R2）：一次性确认被消费后、执行接管前，复核已绑定的模式/键位等
    /// 上下文；不重新授权、不恢复一次性确认；一旦失败永久失效（回到旧站位也不恢复）。</summary>
    public void CheckPreStart()
    {
        if(_preStartFailed || _preStartContext==null)
            throw new InvalidOperationException("站位确认后的上下文见证不可用，请重新审阅并确认");
        try { _preStartContext(); }
        catch { _preStartFailed=true; throw; }
    }
}
