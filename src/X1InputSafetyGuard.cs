// 这个文件是干嘛的：演出/输入链丢失的配套类型声明（捐赠原文提取）。
// 捐赠源：C:\choreohelper-recovery\_merge\src\X1ShowDispatcher.cs.lf。
using System;

namespace ChoreoHelper;

/// <summary>真实输入槽的逐帧安全检查；纯记录槽不需要实现。失败必须释放持有输入并抛出。</summary>
public interface IX1InputSafetyGuard
{
    void CheckInputSafety();
}
