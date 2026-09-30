// 这个文件是干嘛的：朝向绑定候选读取（诊断 JSON 用）。
// R2 原则最小实现：全部捐赠池无定义；按 X1InputPreparation:861 使用面实现
// （无参 Read，返回值仅被序列化）。返回空候选（见 R2 记录）。
using System;

namespace ChoreoHelper;

public static class X1FacingBindingReader
{
    public static string[] Read() => Array.Empty<string>();
}
