// 这个文件是干嘛的：技能动作命令已知性检查（motion 注册前验证）。
// R2 原则最小实现：全部捐赠池无定义；按两处调用面实现。检查口径 mirror 当前
// X1GameAbilityAdapters.ResolveActionName 的 Lumina 读取方式（行 id 解析＋名称比对）。
using System;
using Dalamud.Plugin.Services;
using Lumina.Excel.Sheets;
using Action = Lumina.Excel.Sheets.Action;

namespace ChoreoHelper;

internal static class SkillMotionCommands
{
    public static bool IsKnown(IDataManager data, string command)
    {
        if (data == null || string.IsNullOrWhiteSpace(command)) return false;
        try
        {
            var sheet = data.GetExcelSheet<Action>();
            if (sheet == null) return false;
            var cmd = command.Trim();
            if (uint.TryParse(cmd, out var id) && id != 0)
            {
                try { return !string.IsNullOrWhiteSpace(sheet.GetRow(id).Name.ToString()); }
                catch { return false; }
            }
            foreach (var row in sheet)
            {
                try { if (string.Equals(row.Name.ToString(), cmd, StringComparison.Ordinal)) return true; }
                catch { }
            }
            return false;
        }
        catch { return false; }
    }
}
