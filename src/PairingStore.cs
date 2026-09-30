using System;
using System.IO;
using System.Text.Json;

namespace ChoreoHelper;

/// <summary>
/// v0.6.7 网页配对码的生成与持久化：8 位大写字母数字（去掉易混字符），
/// 存在插件配置目录 pairing.json，首次生成后永久不变——
/// 主人一个浏览器只需粘贴一次，重开游戏配对码不变。
/// </summary>
internal static class PairingStore
{
    // 去掉 0/O、1/I/L 等易混字符
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    public static string LoadOrCreate()
    {
        try
        {
            var dir = Plugin.PluginInterface?.GetPluginConfigDirectory();
            if (string.IsNullOrEmpty(dir)) return GenerateEphemeral();
            var file = Path.Combine(dir, "pairing.json");
            if (File.Exists(file))
            {
                var doc = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(file));
                if (doc.TryGetProperty("code", out var c) && !string.IsNullOrEmpty(c.GetString()))
                    return c.GetString()!;
            }
            var code = RandomCode();
            Directory.CreateDirectory(dir);
            File.WriteAllText(file, JsonSerializer.Serialize(new { code }));
            return code;
        }
        catch
        {
            // 磁盘读写失败也不能让插件起不来：给个只在本次运行有效的临时码（重启会变，要重新粘贴）
            return GenerateEphemeral();
        }
    }

    private static string GenerateEphemeral() => RandomCode(); // 仅内存中的兜底码

    private static string RandomCode()
    {
        var chars = new char[8];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = Alphabet[Random.Shared.Next(Alphabet.Length)];
        return new string(chars);
    }
}
