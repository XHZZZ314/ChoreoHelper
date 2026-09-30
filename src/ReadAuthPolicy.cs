using System;
using System.Collections.Generic;

namespace ChoreoHelper;

/// <summary>
/// SEC-1 私有读保护纯策略：判定 48794/48795 上的 GET/HEAD 读请求哪些必须带配对码。
/// 背景：配对码原本只护写（POST、/debug/poke），所有读都匿名；而 CORS 允许表里的 "null"
/// 是任意不透明来源（沙箱框架、别的本地文件页）都能发的，实测 Origin: null 可匿名枚举
/// 全部 264 条个人动作、读骨骼和模型。规矩：授权只认配对头不认来源——个人动作/骨架/
/// 模型/角色与会话状态一律要配对；capabilities/health/version/公共动作目录/歌词搜索
/// 保持匿名。模型文件判定必须用"解析后的文件名"（ServeStatic 里 GetFullPath 之后），
/// OrdinalIgnoreCase——裸路径字符串判定会被 /./ 与大小写绕过。无 Dalamud 依赖
/// （进 datalayertest，同 ClipPathPolicy 惯例）。
/// </summary>
internal static class ReadAuthPolicy
{
    /// <summary>48794 上需配对的读端点：角色数据、会话状态、游戏调试信息；
    /// /debug/poke 原本就当写管（会让角色做动作），一并收进同一张表。</summary>
    private static readonly HashSet<string> PairedPlayReads = new(StringComparer.Ordinal)
    {
        "/dancers", "/playback/status", "/gpose/state",
        "/debug/animstate", "/debug/diag", "/debug/tlinfo", "/debug/emotefamily",
        "/debug/poke",
        "/shows/status", "/shows/clock", "/x1/status",
    };

    /// <summary>48795 静态服务里的个人模型文件（主人 Meddle 导出）。
    /// model-standin.gltf 是公共替代内容，不在此列。</summary>
    private static readonly HashSet<string> PairedModelFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "model.gltf", "model.glb", "model.bin",
    };

    /// <summary>48794 的 GET/HEAD 是否要配对码。</summary>
    public static bool IsPairedPlayRead(string? absolutePath) =>
        absolutePath != null && PairedPlayReads.Contains(absolutePath);

    /// <summary>48795 的 /export/* 是否要配对码：全部个人动作、骨架与录制/批量状态，
    /// GET 和 POST 同标准（POST 原本就查，这里只管 GET 的判定）。</summary>
    public static bool IsPairedExportRead(string? absolutePath) =>
        absolutePath != null && absolutePath.StartsWith("/export/", StringComparison.Ordinal);

    /// <summary>48795 静态文件是否个人模型。参数必须是解析后的最终文件名
    /// （ServeStatic 里 Path.GetFullPath 之后的 Path.GetFileName）。</summary>
    public static bool IsPairedModelFile(string? resolvedFileName) =>
        resolvedFileName != null && PairedModelFiles.Contains(resolvedFileName);
}
