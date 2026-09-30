using System;
using System.Text.Json;
using System.Text;

namespace ChoreoHelper.Exporter;

/// <summary>
/// 骨架信息导出：骨名、父索引、参考姿势局部变换（hkaSkeleton.Parents + 首帧 pose）。
/// 网页渲染骨骼线框的必需数据。
/// </summary>
public unsafe sealed class RecorderServiceSkeletonHelper
{
    public string BuildSkeletonJson()
    {
        var local = Plugin.ObjectTable?[0];
        if (local == null) return "{\"error\":\"no player\"}";
        var character = (FFXIVClientStructs.FFXIV.Client.Game.Character.Character*)local.Address;
        var drawObj = character->GameObject.DrawObject;
        if (drawObj == null) return "{\"error\":\"no drawobj\"}";
        var cb = (FFXIVClientStructs.FFXIV.Client.Graphics.Scene.CharacterBase*)drawObj;
        if (cb->Skeleton == null || cb->Skeleton->PartialSkeletonCount < 1) return "{\"error\":\"no skeleton\"}";

        var partial = &cb->Skeleton->PartialSkeletons[0];
        var pose = partial->GetHavokPose(0);
        if (pose == null || pose->Skeleton == null) return "{\"error\":\"no pose\"}";
        var hkaSkeleton = pose->Skeleton;
        var ls = pose->GetSyncedPoseLocalSpace();
        if (ls == null || ls->Data == null) return "{\"error\":\"no locals\"}";

        var count = Math.Min(hkaSkeleton->Bones.Length, ls->Length);
        var sb = new StringBuilder();
        sb.Append("{\"count\":").Append(count).Append(",\"bones\":[");
        for (var i = 0; i < count; i++)
        {
            if (i > 0) sb.Append(',');
            var name = "";
            try { name = hkaSkeleton->Bones[i].Name.String?.ToString() ?? ""; } catch { }
            short parent = -1;
            try { parent = hkaSkeleton->ParentIndices.Data[i]; } catch { }
            var t = &ls->Data[i];
            sb.Append("{\"i\":").Append(i)
              .Append(",\"n\":\"").Append(name).Append("\"")
              .Append(",\"p\":").Append(parent)
              .Append(",\"t\":[").Append(t->Translation.X).Append(',').Append(t->Translation.Y).Append(',').Append(t->Translation.Z).Append(']')
              .Append(",\"q\":[").Append(t->Rotation.X).Append(',').Append(t->Rotation.Y).Append(',').Append(t->Rotation.Z).Append(',').Append(t->Rotation.W).Append(']')
              .Append('}');
        }
        sb.Append("]}");
        return sb.ToString();
    }
}
