// 这个文件是干嘛的：输入准备链读取的当前游戏输入快照（键位＋位姿＋移动参考＋安全判定）。
// R2 最小实现：09-12 捐赠定义（X1GameInputReader.cs）无 MovementReference 字段，与当前树
// 6 处 game.MovementReference 使用点不兼容；按 X1InputPreparation / X1GameRegistrationFactory
// 字段面逐字段对拍实现（见 R2 记录）。
using System;

namespace ChoreoHelper;

public sealed record X1GameInputSnapshot(
    X1KeyBindings Bindings,
    X1CalibrationPose Pose,
    bool TextInput,
    bool Safe,
    string Reason,
    uint? MovementMode = null,
    X1MovementReferenceSnapshot? MovementReference = null,
    bool GamepadActive = false);
