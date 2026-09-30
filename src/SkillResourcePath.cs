// 技能资源路径边界：只从原始时间轴键构造游戏相对路径，拒绝逃逸与任意文件读取。
using System;

namespace ChoreoHelper;

public static class SkillResourcePath
{
    public static bool TryTexture(string reference, out string path)
    {
        path = "";
        if (reference == null || !reference.StartsWith("vfx/", StringComparison.Ordinal)
            || !reference.EndsWith(".atex", StringComparison.Ordinal) || reference.Length <= 9) return false;
        if (!TryTimeline(reference[4..^5], out _)) return false;
        path = reference; return true;
    }
    public static bool TryVfx(string reference, out string path)
    {
        path = "";
        if (reference == null || !reference.StartsWith("vfx/", StringComparison.Ordinal)
            || !reference.EndsWith(".avfx", StringComparison.Ordinal) || reference.Length <= 9) return false;
        if (!TryTimeline(reference[4..^5], out _)) return false;
        path = reference; return true;
    }
    public static bool TryTimeline(string key, out string path)
    {
        path = "";
        if (string.IsNullOrEmpty(key) || key.Length > 240) return false;
        foreach (var part in key.Split('/'))
        {
            if (part.Length == 0) return false;
            foreach (var c in part)
                if (!(c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '_' or '-')) return false;
        }
        path = "chara/action/" + key + ".tmb";
        return true;
    }
}
