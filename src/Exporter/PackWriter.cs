using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChoreoHelper.Exporter;

/// <summary>角色包（ENGINE.md 第二节）的目录与索引生成。纯数据，无游戏依赖，可完整实现。</summary>
public static class PackWriter
{
    public sealed class ClipEntry
    {
        public string file { get; set; } = "";
        public float duration { get; set; }
        public string type { get; set; } = "once";
        public int? jobId { get; set; }
        public int? weapon { get; set; }
        public string? chainNext { get; set; }
    }

    public sealed class PackIndex
    {
        public int version { get; set; } = 1;
        public int race { get; set; }
        public int gender { get; set; }
        public Dictionary<string, ClipEntry> clips { get; set; } = new();
    }

    private static readonly JsonSerializerOptions Opts = new() { WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    /// <summary>生成角色包目录骨架（不写模型，模型由 ModelExporter 写）。
    /// 2026-08-31 审计 P1：原版往 index 写过一条 "_meta" 占位，file 指向从未生成的
    /// jobs/{jobId}/_weapon_{weapon}.json（且缺 clips/ 前缀）——无任何消费方的悬空引用，
    /// 直接不再写。job/weapon 元数据本就落在每条 ClipEntry 上（AddClip）。</summary>
    public static string CreatePackRoot(string root, int race, int gender, int jobId, int weapon)
    {
        var dirs = new[] { "clips/emotes", "clips/jobs", "clips/generic" };
        foreach (var d in dirs)
            Directory.CreateDirectory(Path.Combine(root, d));

        var idx = new PackIndex { race = race, gender = gender };
        WriteIndex(root, idx);
        return Path.Combine(root, "index.json");
    }

    public static void AddClip(string root, string command, ClipEntry entry, AnimClipData clip)
    {
        // 命令 → 文件名：/ac "重斩" → heavy-swing；/bow → bow
        var safe = command.Trim().TrimStart('/').ToLowerInvariant();
        safe = string.Concat(safe.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
        if (safe.Length == 0) return;
        var dir = entry.jobId != null ? Path.Combine(root, "clips", "jobs", entry.jobId!.Value.ToString())
            : Path.Combine(root, "clips", "emotes");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, safe + ".json");
        clip.name = safe;
        AnimWriter.WriteFile(clip, file);

        // 更新 index
        var idxPath = Path.Combine(root, "index.json");
        var idx = LoadIndexFile(idxPath) ?? new PackIndex();
        entry.file = $"clips/{(entry.jobId != null ? $"jobs/{entry.jobId}" : "emotes")}/{safe}.json";
        idx.clips[safe] = entry;
        WriteIndex(root, idx);
    }

    public static PackIndex? LoadIndex(string root) => LoadIndexFile(Path.Combine(root, "index.json"));
    public static PackIndex? LoadIndexFile(string path) =>
        File.Exists(path) ? JsonSerializer.Deserialize<PackIndex>(File.ReadAllText(path), Opts) : null;

    private static void WriteIndex(string root, PackIndex idx)
        => File.WriteAllText(Path.Combine(root, "index.json"), JsonSerializer.Serialize(idx, Opts));
}