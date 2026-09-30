// 这个文件是干嘛的：VFX（avfx）资源索引（纹理清单提取）。
// R2 原则最小实现：全部捐赠池无定义；按 SkillResourceReader 使用面实现
// （Read 返回索引或 null；Textures 纹理路径清单）。解析器缺失时返回 null，
// 调用方走既有的 "unsupported" 降级分支（见 R2 记录）。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class AvfxIndex
{
    public List<string> Textures { get; } = new();
}

public static class AvfxResourceIndex
{
    public static AvfxIndex? Read(byte[] vfx) => null;
}
