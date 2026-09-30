// TMB 资源引用解析：按已知条目布局读偏移和原始帧值；不扫描字符串池猜引用，不执行时间轴。
using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Text;

namespace ChoreoHelper;

public sealed record TmbResourceReference(string EntryType, int EntryOffset, short EntryId,
    short StartFrame, int DurationFrames, string Kind, string Path);

public static class TmbResourceReferences
{
    // 布局依据 VFXEditor Formats/TmbFormat 的 C002/C010/C012/C063 和 TmbReader。
    // 仅解读这些引用；未解读条目依然属于原始 TMB，不能据此宣称完整播放语义已还原。
    public static IReadOnlyList<TmbResourceReference> Read(byte[] data)
    {
        if (data.Length < 12 || data.Length > 2 * 1024 * 1024 || Encoding.ASCII.GetString(data, 0, 4) != "TMLB")
            throw new ArgumentException("TMB 容器标识或长度无效");
        int I32(int at) => BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(at, 4));
        short I16(int at) => BinaryPrimitives.ReadInt16LittleEndian(data.AsSpan(at, 2));
        if (I32(4) != data.Length || I32(8) is < 0 or > 4096) throw new ArgumentException("TMB 总长度或条目数量无效");
        var chunks = new List<(string Type, int At, int Size)>();
        int at = 12;
        for (var i = 0; i < I32(8); i++)
        {
            if (at > data.Length - 8) throw new ArgumentException("TMB 条目头被截断");
            var size = I32(at + 4);
            if (size < 8 || size > data.Length - at) throw new ArgumentException("TMB 条目长度越界");
            chunks.Add((Encoding.ASCII.GetString(data, at, 4), at, size)); at += size;
        }
        var references = new List<TmbResourceReference>();
        foreach (var chunk in chunks)
        {
            var layout = chunk.Type switch
            {
                "C002" => (Size: 28, Field: 24, Kind: "timeline"),
                "C010" => (Size: 40, Field: 32, Kind: "animation-name"),
                "C012" => (Size: 72, Field: 20, Kind: "vfx"),
                "C063" => (Size: 32, Field: 20, Kind: "sound"),
                _ => (Size: 0, Field: 0, Kind: ""),
            };
            if (layout.Size == 0) continue;
            if (chunk.Size != layout.Size) throw new ArgumentException("TMB 已知引用条目版本不受支持：" + chunk.Type);
            long start = (long)chunk.At + 8 + I32(chunk.At + layout.Field);
            if (start < at || start >= data.Length) throw new ArgumentException("TMB 字符串引用未指向数据区");
            var end = Array.IndexOf(data, (byte)0, (int)start);
            if (end < 0 || end - start is < 1 or > 512) throw new ArgumentException("TMB 资源字符串缺失终止符或超限");
            var path = new UTF8Encoding(false, true).GetString(data, (int)start, end - (int)start);
            references.Add(new(chunk.Type, chunk.At, I16(chunk.At + 8), I16(chunk.At + 10),
                I32(chunk.At + 12), layout.Kind, path));
        }
        return references.AsReadOnly();
    }
}
