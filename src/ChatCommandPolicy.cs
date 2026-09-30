// 这个文件是干嘛的：游戏命令的安全边界纯策略（FIX-B / AUD2-005）。
// 背景：FIX-1 修掉了长命令的缓冲区越界和内存泄漏，但 3MB 文本仍会把游戏聊天
// 处理卡死（CONTINUITY FIX-1 事故记录）——问题不在 C# 解码，而在游戏本身
// 处理超长输入。这里在「交给游戏之前」统一拒绝危险输入，所有把命令送进游戏
// 的入口（/preview、/playback/start、/playback/timeline、/playback/freeze、
// 录制触发、GameCommandExecutor 队列）都必须先过它。
// 无 Dalamud 依赖，进 datalayertest（同 ChatCommandBuffer/ClipPathPolicy 惯例）。
namespace ChoreoHelper;

public static class ChatCommandPolicy
{
    /// <summary>单条命令 UTF-8 字节上限。正常命令（/bow motion、/e 歌词、切职业）
    /// 都在几十字节量级；1000 字节远小于 4MB 请求体上限，也给歌词类文本留足余量。</summary>
    public const int MaxCommandBytes = 1000;

    /// <summary>校验一条要交给游戏聊天系统的命令。返回 true=放行；false 时 reason 为中文原因。
    /// 规则：非空、必须以 / 开头（产品里所有进游戏的都是聊天指令）、
    /// UTF-8 字节数不超上限、不含控制字符（NUL/CR/LF/TAB 等）、不含分号拼接。</summary>
    public static bool TryValidate(string? command, out string reason)
    {
        reason = "";
        if (string.IsNullOrWhiteSpace(command))
        {
            reason = "命令为空";
            return false;
        }
        if (!command.StartsWith('/'))
        {
            reason = "命令必须以 / 开头";
            return false;
        }
        var byteLen = System.Text.Encoding.UTF8.GetByteCount(command);
        if (byteLen > MaxCommandBytes)
        {
            reason = "命令过长（" + byteLen + " 字节，上限 " + MaxCommandBytes + "）";
            return false;
        }
        foreach (var ch in command)
        {
            if (ch < (char)0x20)
            {
                reason = ch == '\n' || ch == '\r'
                    ? "命令不能包含换行"
                    : "命令包含控制字符";
                return false;
            }
        }
        if (command.Contains(';'))
        {
            reason = "命令不能包含分号拼接";
            return false;
        }
        return true;
    }

    // 文本通道前缀：这些命令携带的是歌词/台词等个人文本，日志只记形状不记内容
    private static readonly string[] TextChannelPrefixes = { "/e ", "/p ", "/echo ", "/emote ", "/em " };

    /// <summary>命令的日志呈现（纯函数，datalayertest 直测）：文本通道命令只记通道与长度，
    /// 不把歌词明文打进日志（歌词多在 60 字符内，截断挡不住）；其余命令照旧记前 60 字符。
    /// 诊断需要明文时看 Debug 级日志（执行器 Pre-call 记录）。</summary>
    public static string DescribeForLog(string? command)
    {
        if (string.IsNullOrEmpty(command)) return "";
        foreach (var p in TextChannelPrefixes)
        {
            if (command.StartsWith(p, StringComparison.OrdinalIgnoreCase))
                return p.TrimEnd() + " …(文本 " + command.Length + " 字符，不落明文)";
        }
        return command.Length <= 60 ? command : command.Substring(0, 60) + "…(" + command.Length + "字符)";
    }
}
