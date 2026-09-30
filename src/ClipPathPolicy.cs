using System;
using System.Collections.Generic;
using System.IO;

namespace ChoreoHelper;

/// <summary>
/// v0.7.1 AUD2-001（审计二轮 FIX-A）：动作文件路径策略——"游戏命令/动作名"到"磁盘文件名"的唯一收口。
/// 旧 ClipName 只去头斜杠换下划线，HandleGetClip 再补一刀 Replace("..","_")，但 Windows 上
/// Path.Combine(根目录, 盘符或根路径) 会整个丢弃根目录，免配对的 /export/getclip 因此能读到
/// ClipsDir 之外的任意 JSON（路径可预测的 pluginConfigs\ChoreoHelper\pairing.json 就是现成目标，
/// 拿到配对码后全部写接口的配对保护一并失守）。
/// 规矩：文件名先清洗（拒绝盘符/反斜杠/冒号/控制字符/保留设备名/过长/非法字符，兼容映射只保留
/// "剥 motion/loop/special 变体后缀"这一条），最终路径必须 GetFullPath 后落在规范化根目录内
/// （前缀带目录分隔符，防 clips2 冒充 clips）。读取(getclip)、单条保存、批量保存、旧 .bin 落盘
/// 全部走本类，不许再留旁路。无 Dalamud 依赖（进 datalayertest，同 ChatCommandBuffer/MotionDetect 惯例）。
/// </summary>
internal static class ClipPathPolicy
{
    /// <summary>动作名不会超过 60 字符；超长基本是逃逸/异常输入（上限给 .json 和深路径留足余量）。</summary>
    private const int MaxNameLength = 100;

    /// <summary>Windows 保留设备名：con.json 这类在 Win32 层仍会被解析成设备，照样拒绝。</summary>
    private static readonly HashSet<string> ReservedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    };

    /// <summary>
    /// 游戏命令或动作名 → 安全 clip 文件名（不含扩展名）。
    /// 兼容映射保持旧 ClipName 的变体剥离：/bow motion → bow（批量录制统一用 motion 变体触发，
    /// 存盘名要还原成基础名跟网页时间轴对得上）。不安全（空/盘符/反斜杠/冒号/内部斜杠/控制字符/
    /// 保留设备名/超长/非法字符）返回 false——调用方必须明确报错或跳过，不许静默写成奇怪文件。
    /// </summary>
    public static bool TryMakeFileName(string? raw, out string fileName)
    {
        fileName = "";
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var name = raw.Trim().TrimStart('/');
        foreach (var suffix in new[] { " motion", " loop", " special" })
        {
            if (name.EndsWith(suffix, StringComparison.Ordinal)) { name = name[..^suffix.Length]; break; }
        }
        name = name.Trim();

        if (name.Length == 0 || name.Length > MaxNameLength) return false;
        if (name == "." || name == "..") return false;
        // 反斜杠（UNC/相对路径逃逸）与冒号（盘符/NTFS 数据流）一律拒绝；
        // 内部 '/' 也拒绝——正常动作名不含它，旧的 '/'→'_' 映射正是逃逸入口之一
        if (name.Contains('\\') || name.Contains(':') || name.Contains('/')) return false;
        foreach (var ch in name)
            if (char.IsControl(ch)) return false;
        if (ReservedNames.Contains(name)) return false;
        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;

        fileName = name;
        return true;
    }

    /// <summary>
    /// 在根目录内解析 fileName + extension 的最终路径。双重约束：
    /// ①文件名本身不许含任何分隔符（GetFileName 校验，双保险）；
    /// ②GetFullPath 消解后必须以"规范化根目录 + 目录分隔符"开头——裸 StartsWith(root) 会被
    /// clips2 这种前缀目录骗过。
    /// </summary>
    public static bool TryResolvePath(string rootDir, string fileName, string extension, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(rootDir) || string.IsNullOrWhiteSpace(fileName)) return false;
        if (Path.GetFileName(fileName) != fileName) return false;
        string root, candidate;
        try
        {
            root = Path.GetFullPath(rootDir);
            candidate = Path.GetFullPath(Path.Combine(root, fileName + extension));
        }
        catch { return false; }
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) || root.EndsWith(Path.AltDirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
        fullPath = candidate;
        return true;
    }

    /// <summary>组合入口：命令/动作名 → 根目录内的最终文件路径。读取与保存共用这唯一一条路。</summary>
    public static bool TryGetPathForCommand(string rootDir, string? raw, string extension, out string fullPath, out string fileName)
    {
        fullPath = "";
        fileName = "";
        if (!TryMakeFileName(raw, out fileName)) return false;
        return TryResolvePath(rootDir, fileName, extension, out fullPath);
    }
}
