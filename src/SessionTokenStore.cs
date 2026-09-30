// 本地会话令牌存储：Phase 1 写会话的内存令牌（与持久配对码配合双接受）。
using System;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace ChoreoHelper;

/// <summary>
/// Phase 1 会话令牌：内存常驻、重启/卸载即忘；与签发时的配对码绑定，
/// 配对码一换全部失效；绝对 12h + 空闲 30min 双过期（capabilities 广告）。
/// 令牌为 32 位无歧义 ASCII（与 PairingStore 同字母表），写接口双接受
/// （配对码或活令牌），配对读仍只认配对码。时钟可注入供单测。
/// </summary>
internal static class SessionTokenStore
{
    public const int TokenLength = 32;
    public const int AbsoluteMinutes = 720;
    public const int IdleMinutes = 30;

    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    private sealed record Entry(string PairingCode, DateTimeOffset MintedAt, DateTimeOffset LastSeen);

    private static readonly Dictionary<string, Entry> Live = new(StringComparer.Ordinal);
    private static readonly object Gate = new();

    /// <summary>单测可注入的时钟；生产默认 UtcNow。</summary>
    public static Func<DateTimeOffset> Clock = () => DateTimeOffset.UtcNow;

    public static int Count
    {
        get { lock (Gate) return Live.Count; }
    }

    /// <summary>单测隔离：清空内存会话（模拟重启/卸载撤销）。</summary>
    public static void Clear()
    {
        lock (Gate) Live.Clear();
    }

    /// <summary>签发：需非空配对码；返回 32 位令牌，无游戏副作用。</summary>
    public static string Mint(string pairingCode)
    {
        if (string.IsNullOrEmpty(pairingCode)) throw new InvalidOperationException("pairing required");
        var token = RandomToken();
        var now = Clock();
        lock (Gate) Live[token] = new Entry(pairingCode, now, now);
        return token;
    }

    /// <summary>校验：活令牌且绑定码与当前配对码一致；成功刷新空闲戳。</summary>
    public static bool Validate(string? token, string currentPairingCode)
    {
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(currentPairingCode)) return false;
        if (token.Length != TokenLength || !IsUnambiguous(token)) return false;
        var now = Clock();
        lock (Gate)
        {
            if (!Live.TryGetValue(token, out var e)) return false;
            if (!string.Equals(e.PairingCode, currentPairingCode, StringComparison.Ordinal)) return false;
            if ((now - e.MintedAt).TotalMinutes >= AbsoluteMinutes) { Live.Remove(token); return false; }
            if ((now - e.LastSeen).TotalMinutes >= IdleMinutes) { Live.Remove(token); return false; }
            Live[token] = e with { LastSeen = now };
            return true;
        }
    }

    internal static bool IsUnambiguous(string s)
    {
        foreach (var c in s)
            if (Alphabet.IndexOf(c) < 0) return false;
        return true;
    }

    private static string RandomToken()
    {
        var chars = new char[TokenLength];
        var bytes = new byte[TokenLength];
        RandomNumberGenerator.Fill(bytes);
        for (var i = 0; i < chars.Length; i++)
            chars[i] = Alphabet[bytes[i] % Alphabet.Length];
        return new string(chars);
    }
}
