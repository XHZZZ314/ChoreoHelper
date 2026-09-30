// 插件内 XAT 缝前置（TASK-20260917-PLUGIN-XAT-INVOCATION）：严格解析 PAP/SKLB 容器头并
// 切出 Havok tagfile 载荷，等价移植 scripts/local-action-assets/resource_container.py 的已用
// 子集；容器不支持（多 entry/错版本/坏偏移）一律显式拒绝，绝不猜测切分。
using System;
using System.Buffers.Binary;

namespace ChoreoHelper;

internal static class XatHavokUnwrap
{
    /// <summary>PAP 头字段（偏移 8 起，&lt;hiiii）：count/skeleton/info/start/end。</summary>
    public readonly record struct PapHeader(short Count, int Skeleton, int Info, int Start, int End);

    /// <summary>读 PAP 头但不校验容器形态；供调用方先判定 count&gt;1（多 entry 显式报缺）。</summary>
    public static PapHeader ReadPapHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < 26 || !data[..4].SequenceEqual("pap "u8))
            throw new FormatException("Invalid PAP header");
        return new PapHeader(
            BinaryPrimitives.ReadInt16LittleEndian(data.Slice(8, 2)),
            BinaryPrimitives.ReadInt32LittleEndian(data.Slice(10, 4)),
            BinaryPrimitives.ReadInt32LittleEndian(data.Slice(14, 4)),
            BinaryPrimitives.ReadInt32LittleEndian(data.Slice(18, 4)),
            BinaryPrimitives.ReadInt32LittleEndian(data.Slice(22, 4)));
    }

    /// <summary>PAP → animation.hkt 载荷。只接受单 entry 且偏移自洽的容器（与 Python 口径一致）。</summary>
    public static byte[] UnwrapPap(ReadOnlySpan<byte> data, int expectedSkeleton)
    {
        var h = ReadPapHeader(data);
        if (h.Count != 1 || h.Skeleton != expectedSkeleton || !(26 <= h.Info && h.Info < h.Start && h.Start < h.End && h.End <= data.Length))
            throw new FormatException("Unsupported PAP container");
        return data.Slice(h.Start, h.End - h.Start).ToArray();
    }

    /// <summary>SKLB → skeleton.hkt 载荷。支持版本 0x3132/0x3133 两种头型（与 Python 口径一致）。</summary>
    public static byte[] UnwrapSklb(ReadOnlySpan<byte> data)
    {
        if (data.Length < 16 || !data[..4].SequenceEqual("blks"u8))
            throw new FormatException("Invalid SKLB header");
        var v = BinaryPrimitives.ReadUInt16LittleEndian(data.Slice(6, 2));
        if (v is not (0x3132 or 0x3133))
            throw new FormatException("Unsupported SKLB version");
        var start = v == 0x3132
            ? BinaryPrimitives.ReadUInt16LittleEndian(data.Slice(10, 2))
            : BinaryPrimitives.ReadInt32LittleEndian(data.Slice(12, 4));
        var end = data.Length;
        if (!(12 <= start && start < end))
            throw new FormatException("Unsupported SKLB payload offsets");
        return data.Slice(start, end - start).ToArray();
    }
}
