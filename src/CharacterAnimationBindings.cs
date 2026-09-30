// 人物动画资源只读索引：读取当前模型已绑定的 PAP/SKLB 路径，不调用未知参数的路径解析或加载函数。
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;
using FFXIVClientStructs.FFXIV.Client.Graphics.Scene;
using FFXIVClientStructs.FFXIV.Client.System.Resource.Handle;
using FFXIVClientStructs.Interop;
using FFXIVClientStructs.STD;

namespace ChoreoHelper;

internal static unsafe class CharacterAnimationBindings
{
    public static object Read(IObjectTable objects, IDataManager data, string? selectedPath = null)
    {
        if (selectedPath != null && (!selectedPath.StartsWith("chara/human/", StringComparison.Ordinal)
            || !(selectedPath.EndsWith(".pap", StringComparison.Ordinal) || selectedPath.EndsWith(".sklb", StringComparison.Ordinal))
            || !SkillResourcePath.TryTimeline(selectedPath[..selectedPath.LastIndexOf('.')], out _)))
            throw new ArgumentException("只允许读取当前人物实际绑定的 PAP 或基础骨架相对路径");
        var player = objects.LocalPlayer;
        if (player == null || !player.IsValid() || player.Address == 0) throw new InvalidOperationException("本地角色尚未准备好");
        var character = (Character*)player.Address;
        var draw = character->GameObject.DrawObject;
        if (draw == null || draw->GetObjectType() != ObjectType.CharacterBase) throw new InvalidOperationException("人物模型尚未加载");
        var model = (CharacterBase*)draw;
        if (model->GetModelType() != CharacterBase.ModelType.Human || model->Skeleton == null)
            throw new InvalidOperationException("当前人物骨架不可读");
        var rows = new List<object>();
        bool selectedBound = false;
        void Add(ResourceHandle* handle, int slot, string group)
        {
            if (handle == null) return;
            if (rows.Count >= 256 || handle->FileName.LongCount is < 1 or > 259)
                throw new InvalidOperationException("人物资源索引数量或路径长度超限");
            var path = handle->FileName.ToString();
            // PAP 条目数标注（单/多 entry，供 UI 标记）：仅对 pap 组、经与 selectedPath 分支同一
            // proven 的 DataManager.GetFile 读 10 字节头解析；任何失败只省略字段，不影响列表。
            int? papEntries = null;
            if (group.StartsWith("pap", StringComparison.Ordinal))
            {
                try
                {
                    var b = data.GetFile(path)?.Data;
                    if (b is { Length: >= 10 } && b[0] == (byte)'p' && b[1] == (byte)'a' && b[2] == (byte)'p' && b[3] == (byte)' ')
                        papEntries = BitConverter.ToInt16(b, 8);
                }
                catch { /* 计数标注失败不阻断枚举 */ }
            }
            rows.Add(new { slot, group, path, loadState = handle->LoadState, byteLength = handle->FileSize, papEntries });
            if (path == selectedPath && (group.StartsWith("pap", StringComparison.Ordinal) || group == "skeleton" && slot == 0))
                selectedBound = true;
        }
        void List(ref StdVector<Pointer<ResourceHandle>> vector, int slot, string group)
        {
            var count = vector.LongCount;
            if (count is < 0 or > 256) throw new InvalidOperationException("人物动画资源列表长度无效");
            for (var i = 0; i < count; i++) Add(vector[i].Value, slot, group);
        }
        var containers = model->SkeletonAnimationContainers;
        for (var slot = 0; slot < containers.Length; slot++)
        {
            ref var container = ref containers[slot];
            Add((ResourceHandle*)container.PartialSkeleton, slot, "skeleton");
            List(ref container.PapVector1, slot, "pap1");
            List(ref container.PapVector2, slot, "pap2");
            List(ref container.PapVector3, slot, "pap3");
            Add(container.AnimationExchangeTable, slot, "animation-exchange");
        }
        object? resource = null;
        if (selectedPath != null)
        {
            if (!selectedBound) throw new ArgumentException("资源不是当前人物已绑定的动画包或基础骨架");
            var bytes = data.GetFile(selectedPath)?.Data;
            if (bytes == null || bytes.Length is < 16 or > 8 * 1024 * 1024)
                throw new ArgumentException("人物绑定资源不存在或超过单文件读取上限");
            resource = new { path = selectedPath, byteLength = bytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                base64 = Convert.ToBase64String(bytes), modifiedGameData = data.HasModifiedGameDataFiles };
        }
        return new { schemaVersion = 1, available = true, source = "current-model-bound-resources",
            actorId = player.GameObjectId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            sourceSkeletonCode = "c" + ((Human*)model)->RaceSexId.ToString("D4"), animationVariant = model->AnimationVariant,
            resources = rows, resource, outputEnabled = false,
            message = "当前模型已绑定路径；仅按明确请求读取单个绑定文件，尚未证明其包含指定技能；不替换动画数据" };
    }
}
