# 这个脚本是干嘛的：用 /export/skeleton 导出的骨架 JSON 生成一个"替身" glTF 模型——
# 101 根骨骼与游戏同名同层次（j_kosi 等），腰骨位置挂一个蒙皮方块。
# 用途：在 Meddle 导出真模型之前，先验证网页端"加载 glTF→按骨名驱动→蒙皮"整条管线。
# 用法：powershell -File scripts\make-standin-model.ps1 [骨架JSON路径] [输出gltf路径]
# 默认：骨架取 %TEMP%\skl-live.json，输出 web\model-standin.gltf
param(
  [string]$SkelJson = (Join-Path $env:TEMP 'skel-live.json'),
  [string]$OutGltf  = (Join-Path $PSScriptRoot '..\web\model-standin.gltf')
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public class StandinGen {
  // ---- 极简四元数（x,y,z,w），避免依赖 System.Numerics.Vectors ----
  static float[] QMul(float[] a, float[] b) {
    return new float[] {
      a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
      a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
      a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
      a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
    };
  }
  static float[] QRotate(float[] q, float[] v) {
    float qx=q[0],qy=q[1],qz=q[2],qw=q[3];
    float a1x=qy*v[2]-qz*v[1]+qw*v[0], a1y=qz*v[0]-qx*v[2]+qw*v[1], a1z=qx*v[1]-qy*v[0]+qw*v[2];
    return new float[] {
      v[0]+2*(qy*a1z-qz*a1y), v[1]+2*(qz*a1x-qx*a1z), v[2]+2*(qx*a1y-qy*a1x)
    };
  }
  static float QNorm(float[] q) {
    return (float)Math.Sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
  }

  public static string Run(string skelJsonPath, string outPath) {
    var ser = new JavaScriptSerializer();
    var root = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(skelJsonPath));
    var bones = (ArrayList)root["bones"];
    int n = bones.Count;

    var names = new string[n]; var parent = new int[n];
    var localT = new float[n][]; var localQ = new float[n][];
    for (int i = 0; i < n; i++) {
      var b = (Dictionary<string, object>)bones[i];
      names[i] = (string)b["n"];
      parent[i] = Convert.ToInt32(b["p"]);
      var t = (ArrayList)b["t"]; var q = (ArrayList)b["q"];
      localT[i] = new float[]{ Convert.ToSingle(t[0]), Convert.ToSingle(t[1]), Convert.ToSingle(t[2]) };
      localQ[i] = new float[]{ Convert.ToSingle(q[0]), Convert.ToSingle(q[1]), Convert.ToSingle(q[2]), Convert.ToSingle(q[3]) };
      float m = QNorm(localQ[i]);
      for (int k = 0; k < 4; k++) localQ[i][k] /= m;
    }

    // 世界旋转/位置（与 Three.js 层级一致）
    var worldQ = new float[n][]; var worldP = new float[n][];
    for (int i = 0; i < n; i++) {
      if (parent[i] < 0) { worldQ[i] = localQ[i]; worldP[i] = localT[i]; }
      else {
        var off = QRotate(worldQ[parent[i]], localT[i]);
        worldP[i] = new float[3];
        for (int k = 0; k < 3; k++) worldP[i][k] = worldP[parent[i]][k] + off[k];
        var wq = QMul(worldQ[parent[i]], localQ[i]);
        float m = QNorm(wq);
        for (int k = 0; k < 4; k++) wq[k] /= m;
        worldQ[i] = wq;
      }
    }

    int kosi = Array.IndexOf(names, "j_kosi");
    if (kosi < 0) throw new Exception("骨架里找不到 j_kosi");

    // ---- 方块网格：中心=腰骨世界位置，半边长 0.25 骨架单位，蒙皮全绑 j_kosi ----
    float e = 0.25f;
    float cx = worldP[kosi][0], cy = worldP[kosi][1], cz = worldP[kosi][2];
    var pos = new List<float>(); var nrm = new List<float>(); var idx = new List<ushort>();
    int[][,] faceDefs = new int[6][,] {
      new int[,] { { 1,0,0 }, { 0,1,0 }, { 0,0,1 } },
      new int[,] { { -1,0,0 }, { 0,1,0 }, { 0,0,1 } },
      new int[,] { { 0,1,0 }, { 1,0,0 }, { 0,0,1 } },
      new int[,] { { 0,-1,0 }, { 1,0,0 }, { 0,0,1 } },
      new int[,] { { 0,0,1 }, { 1,0,0 }, { 0,1,0 } },
      new int[,] { { 0,0,-1 }, { 1,0,0 }, { 0,1,0 } }
    };
    int[] su4 = { -1, 1, 1, -1 }, sv4 = { -1, -1, 1, 1 };
    foreach (var fd in faceDefs) {
      int nx=fd[0,0], ny=fd[0,1], nz=fd[0,2];
      int ux=fd[1,0], uy=fd[1,1], uz=fd[1,2];
      int vx=fd[2,0], vy=fd[2,1], vz=fd[2,2];
      int baseI = pos.Count / 3;
      for (int c = 0; c < 4; c++) {
        int su = su4[c], sv = sv4[c];
        pos.Add(cx + nx*e + ux*e*su + vx*e*sv);
        pos.Add(cy + ny*e + uy*e*su + vy*e*sv);
        pos.Add(cz + nz*e + uz*e*su + vz*e*sv);
        nrm.Add(nx); nrm.Add(ny); nrm.Add(nz);
      }
      idx.Add((ushort)(baseI)); idx.Add((ushort)(baseI+1)); idx.Add((ushort)(baseI+2));
      idx.Add((ushort)(baseI)); idx.Add((ushort)(baseI+2)); idx.Add((ushort)(baseI+3));
    }
    int vertCount = pos.Count / 3;
    var joints0 = new ushort[vertCount*4];
    var weights0 = new float[vertCount*4];
    for (int v = 0; v < vertCount; v++) {
      for (int k = 0; k < 4; k++) joints0[v*4+k] = (ushort)(kosi+1);
      weights0[v*4] = 1f;
    }

    // ---- 逆绑定矩阵：j_kosi 用真实世界逆变换，其余恒等（无权重，不参与） ----
    var invQ = new float[]{ -worldQ[kosi][0], -worldQ[kosi][1], -worldQ[kosi][2], worldQ[kosi][3] };
    float iq = QNorm(invQ);
    for (int k = 0; k < 4; k++) invQ[k] /= iq;
    var rt = QRotate(invQ, worldP[kosi]);
    float x=invQ[0], y=invQ[1], z=invQ[2], w=invQ[3];
    float m00=1-2*(y*y+z*z), m01=2*(x*y-w*z), m02=2*(x*z+w*y);
    float m10=2*(x*y+w*z), m11=1-2*(x*x+z*z), m12=2*(y*z-w*x);
    float m20=2*(x*z-w*y), m21=2*(y*z+w*x), m22=1-2*(x*x+y*y);
    var ibm = new float[n*16];
    for (int i = 0; i < n; i++) {
      int o = i*16;
      if (i == kosi) {
        ibm[o]=m00; ibm[o+1]=m10; ibm[o+2]=m20; ibm[o+3]=0;
        ibm[o+4]=m01; ibm[o+5]=m11; ibm[o+6]=m21; ibm[o+7]=0;
        ibm[o+8]=m02; ibm[o+9]=m12; ibm[o+10]=m22; ibm[o+11]=0;
        ibm[o+12]=-rt[0]; ibm[o+13]=-rt[1]; ibm[o+14]=-rt[2]; ibm[o+15]=1;
      } else {
        ibm[o]=1; ibm[o+5]=1; ibm[o+10]=1; ibm[o+15]=1;
      }
    }

    // ---- 拼二进制 buffer（float 段在前保证 4 字节对齐，ushort 段在后） ----
    var bytes = new List<byte>();
    Action<float> wf = v => bytes.AddRange(BitConverter.GetBytes(v));
    Action<ushort> wh = v => bytes.AddRange(BitConverter.GetBytes(v));

    int posOff = bytes.Count; foreach (var v in pos) wf(v);
    int nrmOff = bytes.Count; foreach (var v in nrm) wf(v);
    int ibmOff = bytes.Count; foreach (var v in ibm) wf(v);
    int wgtOff = bytes.Count; foreach (var v in weights0) wf(v);
    int jntOff = bytes.Count; foreach (var v in joints0) wh(v);
    int idxOff = bytes.Count; foreach (var v in idx) wh(v);

    // ---- glTF JSON ----
    var ci = CultureInfo.InvariantCulture;
    var sb = new StringBuilder();
    sb.Append("{\"asset\":{\"version\":\"2.0\",\"generator\":\"choreohelper-standin\"},");
    sb.Append("\"scene\":0,\"scenes\":[{\"nodes\":[0]}],");

    var childrenOf = new List<int>[n];
    for (int i = 0; i < n; i++) childrenOf[i] = new List<int>();
    var rootChildren = new List<int>();
    for (int i = 0; i < n; i++) {
      if (parent[i] < 0) rootChildren.Add(i+1);
      else childrenOf[parent[i]].Add(i+1);
    }
    rootChildren.Add(n+1);
    sb.Append("\"nodes\":[{\"name\":\"scene_root\",\"children\":[" + string.Join(",", rootChildren) + "]}");
    for (int i = 0; i < n; i++) {
      sb.Append(",{\"name\":\"" + names[i] + "\"");
      if (childrenOf[i].Count > 0) sb.Append(",\"children\":[" + string.Join(",", childrenOf[i]) + "]");
      sb.Append(",\"translation\":[" + localT[i][0].ToString("R",ci) + "," + localT[i][1].ToString("R",ci) + "," + localT[i][2].ToString("R",ci) + "]");
      sb.Append(",\"rotation\":[" + localQ[i][0].ToString("R",ci) + "," + localQ[i][1].ToString("R",ci) + "," + localQ[i][2].ToString("R",ci) + "," + localQ[i][3].ToString("R",ci) + "]}");
    }
    sb.Append(",{\"name\":\"standin_mesh\",\"mesh\":0,\"skin\":0}");
    sb.Append("],");

    var joints = new int[n]; for (int i = 0; i < n; i++) joints[i] = i+1;
    sb.Append("\"skins\":[{\"joints\":[" + string.Join(",", joints) + "],\"skeleton\":1,\"inverseBindMatrices\":2}],");
    sb.Append("\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,\"NORMAL\":1,\"JOINTS_0\":4,\"WEIGHTS_0\":3},\"indices\":5,\"material\":0}]}],");
    sb.Append("\"materials\":[{\"pbrMetallicRoughness\":{\"baseColorFactor\":[0.72,0.74,0.8,1],\"metallicFactor\":0,\"roughnessFactor\":0.9}}],");

    float minX=pos[0],maxX=pos[0],minY=pos[1],maxY=pos[1],minZ=pos[2],maxZ=pos[2];
    for (int p = 0; p < pos.Count; p += 3) {
      if (pos[p]<minX) minX=pos[p]; if (pos[p]>maxX) maxX=pos[p];
      if (pos[p+1]<minY) minY=pos[p+1]; if (pos[p+1]>maxY) maxY=pos[p+1];
      if (pos[p+2]<minZ) minZ=pos[p+2]; if (pos[p+2]>maxZ) maxZ=pos[p+2];
    }
    sb.Append("\"accessors\":[");
    sb.Append("{\"bufferView\":0,\"componentType\":5126,\"count\":" + vertCount + ",\"type\":\"VEC3\",\"min\":[" + minX.ToString("R",ci) + "," + minY.ToString("R",ci) + "," + minZ.ToString("R",ci) + "],\"max\":[" + maxX.ToString("R",ci) + "," + maxY.ToString("R",ci) + "," + maxZ.ToString("R",ci) + "]},");
    sb.Append("{\"bufferView\":1,\"componentType\":5126,\"count\":" + vertCount + ",\"type\":\"VEC3\"},");
    sb.Append("{\"bufferView\":2,\"componentType\":5126,\"count\":" + n + ",\"type\":\"MAT4\"},");
    sb.Append("{\"bufferView\":3,\"componentType\":5126,\"count\":" + vertCount + ",\"type\":\"VEC4\"},");
    sb.Append("{\"bufferView\":4,\"componentType\":5123,\"count\":" + vertCount + ",\"type\":\"VEC4\"},");
    sb.Append("{\"bufferView\":5,\"componentType\":5123,\"count\":" + idx.Count + ",\"type\":\"SCALAR\"}");
    sb.Append("],");
    sb.Append("\"bufferViews\":[");
    sb.Append("{\"buffer\":0,\"byteOffset\":" + posOff + ",\"byteLength\":" + (vertCount*12) + ",\"target\":34962},");
    sb.Append("{\"buffer\":0,\"byteOffset\":" + nrmOff + ",\"byteLength\":" + (vertCount*12) + ",\"target\":34962},");
    sb.Append("{\"buffer\":0,\"byteOffset\":" + ibmOff + ",\"byteLength\":" + (n*64) + "},");
    sb.Append("{\"buffer\":0,\"byteOffset\":" + wgtOff + ",\"byteLength\":" + (vertCount*16) + ",\"target\":34962},");
    sb.Append("{\"buffer\":0,\"byteOffset\":" + jntOff + ",\"byteLength\":" + (vertCount*8) + ",\"target\":34962},");
    sb.Append("{\"buffer\":0,\"byteOffset\":" + idxOff + ",\"byteLength\":" + (idx.Count*2) + ",\"target\":34963}");
    sb.Append("],");
    sb.Append("\"buffers\":[{\"uri\":\"data:application/octet-stream;base64," + Convert.ToBase64String(bytes.ToArray()) + "\",\"byteLength\":" + bytes.Count + "}]}");

    File.WriteAllText(outPath, sb.ToString());
    return "bones=" + n + " verts=" + vertCount + " kosiWorld=(" + cx.ToString("0.###",ci) + "," + cy.ToString("0.###",ci) + "," + cz.ToString("0.###",ci) + ") binBytes=" + bytes.Count + " -> " + outPath;
  }
}
'@ -ReferencedAssemblies 'System.Web.Extensions'

$outAbs = Join-Path (Resolve-Path (Split-Path $OutGltf -Parent)).Path (Split-Path $OutGltf -Leaf)
Write-Output ([StandinGen]::Run($SkelJson, $outAbs))
