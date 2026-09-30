// 插件内 XAT 缝后置（TASK-20260917-PLUGIN-XAT-INVOCATION）：把 XAT 输出的 FBX 动作转成网页
// 关键帧剪辑与骨架 JSON，等价移植 scripts/local-action-assets/fbx_clip.py 的已用子集。
// 非通用 FBX 导入器：无枢轴/无预旋转/欧拉序非默认/缺通道一律显式拒绝，绝不猜测补全。
// 与 Python 版的有意差异：不导出探针用 glTF（产品消费端只需 clip+骨架 JSON）。
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;

namespace ChoreoHelper;

internal static class XatFbxClipReader
{
    private const double FbxTimePerSecond = 46186158000.0;
    private const int MaxArrayElements = 10_000_000;

    public sealed record FbxNode(string Name, List<object> Values, List<FbxNode> Children);

    public sealed record FbxClipResult(string ClipJson, string SkeletonJson, int Bones, int Frames, double Duration);

    /// <summary>FBX Binary 窄解析（版本 7100–7499）。所有长度先校验后使用，坏结构抛 FormatException。</summary>
    public static List<FbxNode> ReadFbx(byte[] data)
    {
        if (data.Length < 27 || !data.AsSpan(0, 23).SequenceEqual("Kaydara FBX Binary  \u0000\u001a\u0000"u8))
            throw new FormatException("Invalid FBX header");
        var version = BitConverter.ToUInt32(data, 23);
        if (version is < 7100 or >= 7500)
            throw new FormatException($"unsupported FBX version {version}");
        var nodes = new List<FbxNode>();
        var offset = 27;
        while (true)
        {
            var (node, next) = ParseNode(data, offset);
            if (node == null) break;
            nodes.Add(node);
            offset = next;
        }
        return nodes;
    }

    private static (FbxNode? Node, int Next) ParseNode(byte[] data, int offset)
    {
        if (offset + 13 > data.Length) throw new FormatException("truncated FBX node header");
        var end = BitConverter.ToUInt32(data, offset);
        var count = BitConverter.ToUInt32(data, offset + 4);
        var propsize = BitConverter.ToUInt32(data, offset + 8);
        var nlen = data[offset + 12];
        if (end == 0) return (null, offset + 13);
        if (!(offset < end && end <= data.Length && count < 10000))
            throw new FormatException("invalid FBX node bounds");
        offset += 13;
        if (offset + nlen > data.Length) throw new FormatException("truncated FBX node name");
        var name = Encoding.UTF8.GetString(data, offset, nlen);
        offset += nlen;
        var values = new List<object>((int)count);
        var propEnd = offset + propsize;
        if (propEnd > data.Length) throw new FormatException("invalid FBX property block size");
        for (var i = 0; i < count; i++)
        {
            if (offset >= data.Length) throw new FormatException("truncated FBX property");
            var kind = (char)data[offset];
            offset += 1;
            if (kind is 'f' or 'd' or 'l' or 'i' or 'b' or 'c')
            {
                // 数组属性：size/encoding/nbytes 三元组 + 原样或 zlib 载荷
                if (offset + 12 > data.Length) throw new FormatException("truncated FBX array header");
                var size = BitConverter.ToUInt32(data, offset);
                var encoding = BitConverter.ToUInt32(data, offset + 4);
                var nbytes = BitConverter.ToUInt32(data, offset + 8);
                offset += 12;
                if (size > MaxArrayElements || encoding is not (0 or 1) || offset + nbytes > data.Length)
                    throw new FormatException("invalid FBX array property");
                var buf = new byte[nbytes];
                Array.Copy(data, offset, buf, 0, (int)nbytes);
                offset += (int)nbytes;
                if (encoding == 1) buf = InflateZlib(buf);
                var elemSize = kind is ('f' or 'i') ? 4 : kind is ('d' or 'l') ? 8 : 1;
                if (buf.Length != (long)size * elemSize) throw new FormatException("FBX array payload length mismatch");
                values.Add(kind switch
                {
                    'f' => DecodeArray(buf, size, b => BitConverter.ToSingle(b, 0)),
                    'd' => DecodeArray(buf, size, b => BitConverter.ToDouble(b, 0)),
                    'l' => DecodeArray(buf, size, b => BitConverter.ToInt64(b, 0)),
                    'i' => DecodeArray(buf, size, b => BitConverter.ToInt32(b, 0)),
                    'b' => DecodeArray(buf, size, b => b[0] != 0),
                    _ => DecodeArray(buf, size, b => (sbyte)b[0]),
                });
            }
            else
            {
                switch (kind)
                {
                    case 'Y': Need(data, offset, 2); values.Add(BitConverter.ToInt16(data, offset)); offset += 2; break;
                    case 'C': values.Add(data[offset] != 0); offset += 1; break;
                    case 'I': Need(data, offset, 4); values.Add(BitConverter.ToInt32(data, offset)); offset += 4; break;
                    case 'F': Need(data, offset, 4); values.Add(BitConverter.ToSingle(data, offset)); offset += 4; break;
                    case 'D': Need(data, offset, 8); values.Add(BitConverter.ToDouble(data, offset)); offset += 8; break;
                    case 'L': Need(data, offset, 8); values.Add(BitConverter.ToInt64(data, offset)); offset += 8; break;
                    case 'S':
                    case 'R':
                        Need(data, offset, 4);
                        var size = BitConverter.ToUInt32(data, offset);
                        offset += 4;
                        if (offset + size > data.Length) throw new FormatException("truncated FBX string/raw property");
                        var raw = new byte[size];
                        Array.Copy(data, offset, raw, 0, (int)size);
                        offset += (int)size;
                        values.Add(kind == 'S' ? Encoding.UTF8.GetString(raw) : raw);
                        break;
                    default: throw new FormatException("unsupported FBX property " + kind);
                }
            }
        }
        if (offset != propEnd) throw new FormatException("FBX property block overrun");
        var children = new List<FbxNode>();
        while (offset < end)
        {
            var (child, next) = ParseNode(data, offset);
            if (child != null) children.Add(child);
            offset = next;
        }
        if (offset != end) throw new FormatException("FBX node bounds mismatch");
        return (new FbxNode(name, values, children), offset);
    }

    private static void Need(byte[] data, int offset, int size)
    {
        if (offset < 0 || offset + size > data.Length) throw new FormatException("truncated FBX property");
    }

    private static T[] DecodeArray<T>(byte[] buf, uint size, Func<byte[], T> read)
    {
        var elemSize = buf.Length / Math.Max(size, 1);
        var result = new T[size];
        var scratch = new byte[8];
        for (var i = 0; i < size; i++)
        {
            Array.Copy(buf, i * elemSize, scratch, 0, elemSize);
            result[i] = read(scratch);
        }
        return result;
    }

    private static byte[] InflateZlib(byte[] input)
    {
        try
        {
            using var ms = new MemoryStream(input);
            using var zs = new ZLibStream(ms, CompressionMode.Decompress);
            using var output = new MemoryStream(input.Length * 2 + 64);
            zs.CopyTo(output);
            return output.ToArray();
        }
        catch (InvalidDataException e)
        {
            throw new FormatException("FBX array zlib payload corrupt: " + e.Message);
        }
    }

    private static FbxNode Child(FbxNode n, string name)
    {
        foreach (var c in n.Children)
            if (c.Name == name) return c;
        throw new FormatException($"missing FBX node {name}");
    }

    private static long IdOf(object v) => v switch
    {
        long l => l,
        int i => i,
        _ => throw new FormatException("FBX object id expected"),
    };

    /// <summary>XAT 用 EulOrdXYZs（固定轴 X,Y,Z = qz*qy*qx）从角度构造四元数；输入为度。</summary>
    public static double[] EulerXyzStatic(double[] degrees)
    {
        var x = degrees[0] * Math.PI / 360;
        var y = degrees[1] * Math.PI / 360;
        var z = degrees[2] * Math.PI / 360;
        var sx = Math.Sin(x); var cx = Math.Cos(x);
        var sy = Math.Sin(y); var cy = Math.Cos(y);
        var sz = Math.Sin(z); var cz = Math.Cos(z);
        return new[]
        {
            sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz,
        };
    }

    private static double Num(object v) => v switch
    {
        double d => d,
        float f => f,
        int i => i,
        long l => l,
        short s => s,
        _ => throw new FormatException("FBX scalar expected"),
    };

    private static double[] Vec(IReadOnlyList<object> values)
        => new[] { Num(values[0]), Num(values[1]), Num(values[2]) };

    /// <summary>FBX → (clip JSON, skeleton JSON)。clip 满足 DECODE-FEASIBILITY §4 网页剪辑契约；
    /// 骨架 JSON 与历史链 cXXXX-skeleton.json 同形（i/n/p/t/q/s）。</summary>
    public static FbxClipResult Convert(byte[] fbx, string clipName, string skeletonName)
    {
        var tree = ReadFbx(fbx);
        FbxNode? objects = null, connections = null;
        foreach (var n in tree)
        {
            if (n.Name == "Objects") objects = n;
            else if (n.Name == "Connections") connections = n;
        }
        if (objects == null || connections == null) throw new FormatException("FBX missing Objects/Connections");
        var objs = objects.Children;
        var conns = connections.Children;

        var byId = new Dictionary<long, FbxNode>();
        foreach (var o in objs) byId[IdOf(o.Values[0])] = o;
        var parents = new Dictionary<long, long>();
        foreach (var c in conns)
        {
            if ((c.Values[0] as string) != "OO") continue;
            var childId = IdOf(c.Values[1]);
            if (byId.TryGetValue(childId, out var target) && target.Name == "Model")
                parents[childId] = IdOf(c.Values[2]);
        }

        var skeleton = new List<(int Index, string Name, long ParentId, double[] T, double[] Q, double[] S)>();
        var clips = new JsonObject();
        var idToIndex = new Dictionary<long, int>();
        var frames = 0;
        foreach (var model in objs)
        {
            if (model.Name != "Model") continue;
            var mid = IdOf(model.Values[0]);
            var boneName = ((string)model.Values[1]).Split('\0')[0];
            var props = new Dictionary<string, List<object>>();
            foreach (var p in Child(model, "Properties70").Children)
                props[(string)p.Values[0]] = p.Values.Skip(4).ToList();
            // XAT 输出无枢轴/预后旋转；出现即超出已证缝，显式拒绝而不是错误换算
            foreach (var key in new[] { "PreRotation", "PostRotation", "RotationOffset", "RotationPivot", "ScalingOffset", "ScalingPivot" })
                if (props.TryGetValue(key, out var pivot) && pivot.Any(v => Num(v) != 0))
                    throw new FormatException($"unsupported {key}");
            if (props.TryGetValue("RotationOrder", out var order) && Num(order[0]) != 0)
                throw new FormatException("unsupported RotationOrder");
            var index = skeleton.Count;
            idToIndex[mid] = index;
            var translation = props.TryGetValue("Lcl Translation", out var t) ? Vec(t) : new double[] { 0, 0, 0 };
            var rotation = props.TryGetValue("Lcl Rotation", out var r) ? Vec(r) : new double[] { 0, 0, 0 };
            var scale = props.TryGetValue("Lcl Scaling", out var s) ? Vec(s) : new double[] { 1, 1, 1 };
            if (scale.Any(v => !double.IsFinite(v) || v <= 0)) throw new FormatException($"invalid reference scale {boneName}");
            skeleton.Add((index, boneName, parents.TryGetValue(mid, out var pid) ? pid : 0, translation, EulerXyzStatic(rotation), scale));

            var channels = new Dictionary<string, List<double[]>>();
            foreach (var conn in conns)
            {
                if (conn.Values.Count < 4 || (conn.Values[0] as string) != "OP" || IdOf(conn.Values[2]) != mid) continue;
                var nodeId = IdOf(conn.Values[1]);
                if (!byId.TryGetValue(nodeId, out var curveNodeParent) || curveNodeParent.Name != "AnimationCurveNode") continue;
                var prop = (string)conn.Values[3];
                var axes = new Dictionary<char, (long[] Times, float[] Values)>();
                foreach (var c in conns)
                {
                    if (c.Values.Count < 4 || (c.Values[0] as string) != "OP" || IdOf(c.Values[2]) != nodeId) continue;
                    if (!byId.TryGetValue(IdOf(c.Values[1]), out var curve) || curve.Name != "AnimationCurve")
                        throw new FormatException("FBX animation channel is not an AnimationCurve");
                    var times = (long[])Child(curve, "KeyTime").Values[0];
                    var keyValues = (float[])Child(curve, "KeyValueFloat").Values[0];
                    if (times.Length != keyValues.Length || times.Length < 2)
                        throw new FormatException($"incomplete keyframes {boneName}");
                    axes[((string)c.Values[3])[^1]] = (times, keyValues);
                }
                if (!(axes.Count == 3 && axes.ContainsKey('X') && axes.ContainsKey('Y') && axes.ContainsKey('Z')))
                    throw new FormatException($"incomplete channel {boneName} {prop}");
                var ts = axes['X'].Times;
                if (!ts.SequenceEqual(axes['Y'].Times) || !ts.SequenceEqual(axes['Z'].Times))
                    throw new FormatException($"channel key times differ {boneName}");
                for (var k = 1; k < ts.Length; k++)
                    if (ts[k] <= ts[k - 1]) throw new FormatException($"key times not increasing {boneName}");
                var key = prop switch
                {
                    "Lcl Rotation" => "q",
                    "Lcl Translation" => "t",
                    "Lcl Scaling" => "s",
                    _ => throw new FormatException($"unsupported property {prop}"),
                };
                var rows = new List<double[]>(ts.Length);
                for (var j = 0; j < ts.Length; j++)
                {
                    var vector = new[] { (double)axes['X'].Values[j], axes['Y'].Values[j], axes['Z'].Values[j] };
                    rows.Add(key == "q"
                        ? Prepend(ts[j] / FbxTimePerSecond, EulerXyzStatic(vector))
                        : Prepend(ts[j] / FbxTimePerSecond, vector));
                }
                channels[key] = rows;
                frames = Math.Max(frames, ts.Length);
            }
            if (channels.Count != 3 || !channels.ContainsKey("q") || !channels.ContainsKey("t") || !channels.ContainsKey("s"))
                throw new FormatException($"incomplete bone {boneName}");
            var bone = new JsonObject();
            foreach (var key in new[] { "q", "t", "s" })
            {
                var arr = new JsonArray();
                foreach (var row in channels[key]) arr.Add(RowJson(row));
                bone[key] = arr;
            }
            clips["bone_" + index] = bone;
        }

        // 父级解析与 Python 口径一致：构建期记父模型 id（无父记 0），收尾统一映射为骨架索引，缺失落 -1
        var skeletonOut = skeleton.Select(b => new
        {
            i = b.Index,
            n = b.Name,
            p = idToIndex.TryGetValue(b.ParentId, out var parentIndex) ? parentIndex : -1,
            t = b.T,
            q = b.Q,
            s = b.S,
        }).ToList();

        var duration = 0.0;
        foreach (var (_, boneNode) in clips)
            foreach (var (_, channel) in (JsonObject)boneNode!)
                if (((JsonArray)channel!).Count > 0)
                    duration = Math.Max(duration, (double)((JsonArray)channel)[^1]![0]!);

        var clip = new JsonObject
        {
            ["name"] = clipName,
            ["duration"] = duration,
            ["type"] = "loop",
            ["bones"] = clips,
            ["offlinePrototype"] = new JsonObject
            {
                ["requiredChannels"] = new JsonArray("q", "t", "s"),
                ["sourceSkeleton"] = skeletonName,
                ["productionImportApproved"] = false,
            },
        };
        ValidateClip(clips, duration);

        var skeletonJson = new JsonObject
        {
            ["count"] = skeletonOut.Count,
            ["bones"] = new JsonArray(skeletonOut.Select(b => (JsonNode?)new JsonObject
            {
                ["i"] = b.i,
                ["n"] = b.n,
                ["p"] = b.p,
                ["t"] = RowJson(b.t),
                ["q"] = RowJson(b.q),
                ["s"] = RowJson(b.s),
            }).ToArray()),
        };
        return new FbxClipResult(clip.ToJsonString(), skeletonJson.ToJsonString(), skeleton.Count, frames, duration);
    }

    private static double[] Prepend(double time, double[] components)
    {
        var row = new double[components.Length + 1];
        row[0] = time;
        Array.Copy(components, 0, row, 1, components.Length);
        return row;
    }

    private static JsonArray RowJson(double[] row)
    {
        var arr = new JsonArray();
        foreach (var v in row) arr.Add(v);
        return arr;
    }

    private static void ValidateClip(JsonObject clips, double duration)
    {
        if (duration <= 0 || !double.IsFinite(duration)) throw new FormatException("invalid clip duration");
        foreach (var (boneKey, boneNode) in clips)
        {
            var bone = (JsonObject)boneNode!;
            foreach (var (_, channel) in bone)
                foreach (var rowNode in (JsonArray)channel!)
                    foreach (var v in (JsonArray)rowNode!)
                        if (!double.IsFinite((double)v!)) throw new FormatException("non-finite keyframe value");
            foreach (var rowNode in (JsonArray)bone["q"]!)
            {
                var row = (JsonArray)rowNode!;
                var norm = 0.0;
                for (var i = 1; i < row.Count; i++) norm += (double)row[i]! * (double)row[i]!;
                if (Math.Abs(norm - 1) >= 1e-6)
                    throw new FormatException($"rotation quaternion not normalized: bone={boneKey} norm={norm}");
            }
        }
    }
}
