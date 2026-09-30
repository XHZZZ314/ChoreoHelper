// 这个脚本是干嘛的：离线分析 /export/skeleton 导出的骨架 JSON——
// 按"父旋转×子平移"逐级合成，算出 101 根骨骼在参考姿势下的世界坐标和包围盒，
// 用来确定骨骼数据的真实单位（厘米还是米）和正确的预览缩放。
// 用法：dotnet run scripts/analyze-skeleton.cs <skel.json 路径>
using System.Numerics;

var path = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "skel-live.json");
using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
var bones = doc.RootElement.GetProperty("bones");
var n = bones.GetArrayLength();
var names = new string[n];
var parent = new int[n];
var localT = new Vector3[n];
var localQ = new Quaternion[n];
var i = 0;
foreach (var b in bones.EnumerateArray())
{
    names[i] = b.GetProperty("n").GetString()!;
    parent[i] = b.GetProperty("p").GetInt32();
    var tArr = b.GetProperty("t").EnumerateArray().Select(x => x.GetSingle()).ToArray();
    var qArr = b.GetProperty("q").EnumerateArray().Select(x => x.GetSingle()).ToArray();
    localT[i] = new Vector3(tArr[0], tArr[1], tArr[2]);
    localQ[i] = new Quaternion(qArr[0], qArr[1], qArr[2], qArr[3]);
    i++;
}

// 世界变换：pos = 父pos + 父rot × localT；rot = 父rot × localQ（与 Three.js 一致）
var worldP = new Vector3[n];
var worldQ = new Quaternion[n];
for (var k = 0; k < n; k++)
{
    if (parent[k] < 0)
    {
        worldP[k] = localT[k];
        worldQ[k] = localQ[k];
    }
    else
    {
        worldP[k] = worldP[parent[k]] + Vector3.Transform(localT[k], worldQ[parent[k]]);
        worldQ[k] = Quaternion.Normalize(Quaternion.Concatenate(worldQ[parent[k]], localQ[k]));
    }
}

var minX = worldP.Min(v => v.X); var maxX = worldP.Max(v => v.X);
var minY = worldP.Min(v => v.Y); var maxY = worldP.Max(v => v.Y);
var minZ = worldP.Min(v => v.Z); var maxZ = worldP.Max(v => v.Z);
Console.WriteLine($"bones={n}");
Console.WriteLine($"bbox: X[{minX:F3}, {maxX:F3}] span={maxX - minX:F3}");
Console.WriteLine($"      Y[{minY:F3}, {maxY:F3}] span={maxY - minY:F3}   <-- 身高");
Console.WriteLine($"      Z[{minZ:F3}, {maxZ:F3}] span={maxZ - minZ:F3}");
int Idx(string nm) => Array.IndexOf(names, nm);
foreach (var nm in new[] { "n_root", "j_kosi", "j_kubi", "j_kao", "j_asi_e_l", "j_asi_e_r", "j_te_l", "n_hara" })
{
    var k = Idx(nm);
    if (k >= 0) Console.WriteLine($"  {nm,-16} world=({worldP[k].X:F3}, {worldP[k].Y:F3}, {worldP[k].Z:F3})");
}
