// 这个文件是干嘛的：X1 技能聊天命令构造（进 datalayertest）——/ac 包裹格式唯一定义点。
// r3 起提交护栏职责移交 X1AbilityWriteBoundary（规范十进制身份 + 运行代见证 + 同步边界）：
// 本类型只保留命令文本构造，入参为行解析得到的本地动作名；目标标识永不进命令文本（无注入面）。
namespace ChoreoHelper;

/// <summary>聊天命令构造（纯函数，datalayertest 直测）：/ac "&lt;动作名&gt;" &lt;t&gt; —— 动作名来自
/// 行解析（显式请求的 Action.RowId 所在行的本地名），目标用固定占位 &lt;t&gt;（提交护栏已核当前
/// 目标 GameObjectId 与显式请求 id 相等）。</summary>
public static class X1AbilityAdapterPolicy
{
    /// <summary>聊天命令构造：/ac "&lt;显式动作名&gt;" &lt;t&gt;。命令级安全（字节上限/控制字符/分号）
    /// 由共享执行器的 ChatCommandPolicy 闸承担。</summary>
    public static string BuildChatCommand(string actionName) => "/ac \"" + actionName + "\" <t>";
}
