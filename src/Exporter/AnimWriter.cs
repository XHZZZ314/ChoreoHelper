using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChoreoHelper.Exporter;

/// <summary>
/// 动画数据模型（与网页引擎 ENGINE.md 契约完全一致）。
/// q = 四元数关键帧 [t,x,y,z,w]（局部旋转），t = 位移关键帧 [t,x,y,z]。
/// 骨骼名约定：pap 解析路线用 .sklb 原始名；录制路线用 "bone_N"（骨架索引），
/// skeleton.json 提供映射 —— 引擎只做名称透传，保证一致即可。
/// </summary>
public sealed class AnimClipData
{
    public string name { get; set; } = "";
    public float duration { get; set; }
    public string type { get; set; } = "once";       // once | loop | chain
    public string? chainNext { get; set; }
    public float? chainAt { get; set; }
    public Dictionary<string, BoneChannel> bones { get; set; } = new();
}

public sealed class BoneChannel
{
    public List<float[]>? q { get; set; }   // [t,x,y,z,w]
    public List<float[]>? t { get; set; }   // [t,x,y,z]
}

/// <summary>AnimClipData → 契约 JSON（引擎直接消费）。</summary>
public static class AnimWriter
{
    private static readonly JsonSerializerOptions Opts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string ToJson(AnimClipData clip) => JsonSerializer.Serialize(clip, Opts);

    public static void WriteFile(AnimClipData clip, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // 原子落盘（2026-08-31 审计 P0）：先写同目录 .committing 临时文件再 Replace/Move——
        // 任何时刻崩溃，最终路径上要么是旧完整文件要么是新完整文件，绝不出现半写 JSON。
        // 直写版曾让批量录制中途崩溃留下半写文件，被"已存在即跳过"的续录永久保留。
        // .committing 孤儿由 ExportServer 启动/关闭时的过期清理兜底（与 commit 暂存同后缀）。
        var tmp = path + ".committing";
        File.WriteAllText(tmp, ToJson(clip));
        if (File.Exists(path)) File.Replace(tmp, path, null);
        else File.Move(tmp, path);
    }

    /// <summary>从录制采样序列构建 clip（录制的关键帧频率 = 采样率，等间隔存储）。</summary>
    public static AnimClipData FromSamples(
        string name, float duration, string type,
        Dictionary<string, List<(float T, Quaternion Q)>> rotSamples,
        Dictionary<string, List<(float T, Vector3 P)>>? posSamples = null)
    {
        var clip = new AnimClipData { name = name, duration = duration, type = type };
        foreach (var (boneName, samples) in rotSamples)
        {
            var ch = new BoneChannel { q = new List<float[]>() };
            foreach (var (t, q) in samples)
                ch.q.Add(new[] { t, q.X, q.Y, q.Z, q.W });
            if (posSamples != null && posSamples.TryGetValue(boneName, out var ps))
            {
                ch.t = new List<float[]>();
                foreach (var (t, p) in ps)
                    ch.t.Add(new[] { t, p.X, p.Y, p.Z });
            }
            clip.bones[boneName] = ch;
        }
        return clip;
    }
}