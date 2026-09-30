using System;
using System.Text;

namespace ChoreoHelper;

/// <summary>
/// 这个文件是干嘛的：游戏聊天命令进 Utf8String 缓冲前的纯受管辅助判定。
/// 不引用任何 Dalamud/游戏 DLL，可被数据层测试工程（datalayertest）直接编译，
/// 用来把「UTF-8 字节长度边界」钉进单测（63/64/70/71 字节 + 长中文），防止以后
/// 有人用 C# 字符数代替字节数造成内联/堆路径误判（AUD-001 修复配套）。
/// </summary>
internal static class ChatCommandBuffer
{
    /// <summary>内联缓冲容量（字节）。达到即走堆缓冲路径——与 GameCommandExecutor
    /// 手工构造 Utf8String 的 ABI 约定一致，不可随意改动。</summary>
    public const int InlineCapacity = 0x40;

    /// <summary>命令的 UTF-8 字节长度（不含结束符）。中文等多字节字符按字节计。</summary>
    public static int Utf8ByteLength(string command) =>
        string.IsNullOrEmpty(command) ? 0 : Encoding.UTF8.GetByteCount(command);

    /// <summary>是否走堆缓冲：UTF-8 字节长度 ≥ 内联容量。内联路径只装得下
    /// InlineCapacity-1 字节 + 结束符，超了会越出结构内联区。</summary>
    public static bool UsesHeap(string command) => Utf8ByteLength(command) >= InlineCapacity;

    /// <summary>编码为带结束符的 UTF-8 字节（游戏缓冲里实际存放的内容）。
    /// 日志/校验解码一律用这份受管字节，不要从非托管内联区读长命令。</summary>
    public static byte[] ToUtf8WithNull(string command)
    {
        var body = Encoding.UTF8.GetBytes(command ?? "");
        var buf = new byte[body.Length + 1];
        Array.Copy(body, buf, body.Length);
        return buf;
    }

    /// <summary>从带结束符的 UTF-8 字节解码回字符串（不含结束符）。</summary>
    public static string FromUtf8WithNull(byte[] utf8WithNull)
    {
        var len = utf8WithNull.Length;
        if (len > 0 && utf8WithNull[len - 1] == 0) len--;
        return Encoding.UTF8.GetString(utf8WithNull, 0, len);
    }
}
