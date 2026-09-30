// 技能资源只读桥：按真实 Action 行引用读取 TMB；不扫描目录、不接受任意文件路径、不写入游戏资源。
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using Dalamud.Plugin.Services;
using Lumina.Excel;
using Lumina.Excel.Sheets;
using ActionRow = Lumina.Excel.Sheets.Action;

namespace ChoreoHelper;

internal static class SkillResourceReader
{
    public static object Read(IDataManager data, int actionId, bool includeEffects = true)
    {
        if (actionId <= 0) throw new ArgumentException("需要真实技能编号");
        var row = data.GetExcelSheet<ActionRow>()?.GetRowOrDefault((uint)actionId);
        if (row == null || !row.Value.IsPlayerAction || row.Value.IsPvP)
            throw new ArgumentException("当前真实 Action 不属于受支持的非 PvP 玩家技能");
        var action = row.Value;
        var timelines = new List<object>();
        var dependencies = new Dictionary<string, object>(StringComparer.Ordinal);
        var textures = new Dictionary<string, object>(StringComparer.Ordinal);
        int dependencyBytes = 0;
        int textureBytes = 0;
        void Add(string role, RowRef<ActionTimeline> reference)
        {
            if (reference.RowId == 0 || !reference.IsValid)
            { timelines.Add(new { role, rowId = reference.RowId, state = "absent" }); return; }
            var timeline = reference.Value;
            var key = timeline.Key.ToString();
            if (!SkillResourcePath.TryTimeline(key, out var path))
            { timelines.Add(new { role, rowId = reference.RowId, key, state = "invalid-path" }); return; }
            var bytes = data.GetFile(path)?.Data;
            if (bytes == null)
            { timelines.Add(new { role, rowId = reference.RowId, key, path, state = "missing" }); return; }
            if (bytes.Length > 2 * 1024 * 1024 || bytes.Length < 12 || Encoding.ASCII.GetString(bytes, 0, 4) != "TMLB")
            { timelines.Add(new { role, rowId = reference.RowId, key, path, state = "unsupported-container" }); return; }
            var references = TmbResourceReferences.Read(bytes);
            foreach (var dependency in references)
            {
                if (!includeEffects) break; // 网页动作准备只读 TMB/动画引用，不再提取特效和纹理。
                if (dependency.Kind != "vfx" || dependencies.ContainsKey(dependency.Path)) continue;
                if (dependencies.Count >= 8) throw new ArgumentException("单技能 VFX 引用超过本次读取上限");
                if (!SkillResourcePath.TryVfx(dependency.Path, out var vfxPath))
                    throw new ArgumentException("技能 VFX 引用路径无效");
                var vfx = data.GetFile(vfxPath)?.Data;
                if (vfx == null)
                { dependencies.Add(vfxPath, new { kind = "vfx", path = vfxPath, state = "missing" }); continue; }
                if (vfx.Length > 8 * 1024 * 1024 - dependencyBytes)
                    throw new ArgumentException("技能 VFX 总资源超过本次读取上限");
                dependencyBytes += vfx.Length;
                AvfxIndex? index = null;
                string? indexError = null;
                try { index = AvfxResourceIndex.Read(vfx); }
                catch (ArgumentException ex) { indexError = ex.Message; }
                if (index != null)
                {
                    foreach (var texturePath in index.Textures)
                    {
                        if (textures.ContainsKey(texturePath)) continue;
                        if (textures.Count >= 64) throw new ArgumentException("单技能纹理引用超过本次读取上限");
                        var texture = data.GetFile(texturePath)?.Data;
                        if (texture == null)
                        { textures.Add(texturePath, new { kind = "texture", path = texturePath, state = "missing" }); continue; }
                        if (texture.Length > 16 * 1024 * 1024 - textureBytes)
                            throw new ArgumentException("技能纹理总资源超过本次读取上限");
                        textureBytes += texture.Length;
                        textures.Add(texturePath, new { kind = "texture", path = texturePath, state = "read", byteLength = texture.Length,
                            sha256 = Convert.ToHexString(SHA256.HashData(texture)).ToLowerInvariant(), base64 = Convert.ToBase64String(texture) });
                    }
                }
                dependencies.Add(vfxPath, new { kind = "vfx", path = vfxPath, state = "read", byteLength = vfx.Length,
                    sha256 = Convert.ToHexString(SHA256.HashData(vfx)).ToLowerInvariant(), base64 = Convert.ToBase64String(vfx),
                    index, indexState = index == null ? "unsupported" : "indexed", indexError });
            }
            timelines.Add(new { role, rowId = reference.RowId, key, path, state = "read",
                timeline.Type, timeline.Slot, timeline.Stance, timeline.LoadType, timeline.ResidentPap,
                byteLength = bytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                references, base64 = Convert.ToBase64String(bytes) });
        }
        Add("hit", action.ActionTimelineHit);
        Add("execution", action.AnimationEnd);
        if (action.AnimationStart.RowId != 0 && action.AnimationStart.IsValid)
            Add("cast", action.AnimationStart.Value.Name);
        return new { schemaVersion = 1, actionId, name = action.Name.ToString(), type = "action",
            source = "local-game-action-references", modifiedGameData = data.HasModifiedGameDataFiles,
            staticMetadata = new { castMs = action.Cast100ms * 100, recastMs = action.Recast100ms * 100,
                requiredLevel = action.ClassJobLevel, action.MaxCharges, action.Range, action.EffectRange,
                castVfxRowId = action.VFX.RowId, castTimelineRowId = action.AnimationStart.RowId },
            timelines, dependencies = dependencies.Values, textures = textures.Values, outputEnabled = false,
            message = "按 Action 原始引用读取；命中、施放和咏唱资源分别保留，尚未证明已正确解析或还原技能" };
    }
}
