// 这个文件是干嘛的：框架线程只读镜头原始方向和步行状态；不推定移动相位，不修改镜头或游戏设置。
using System;
using FFXIVClientStructs.FFXIV.Client.Game.Control;

namespace ChoreoHelper;

public static unsafe class X1MovementReferenceReader
{
    /// <summary>调用者须已确认游戏框架线程及当前本地角色。每次读取重新取指针，失败不沿用旧值。</summary>
    public static X1MovementReferenceSnapshot Read()
    {
        var result = new X1MovementReferenceSnapshot { AtMs = Environment.TickCount64 };
        try
        {
            var control = Control.Instance();
            if (control == null) return result with { Reason = "游戏移动控制模块不可读" };
            var manager = &control->CameraManager;
            result = result with { ActiveCameraIndex = manager->ActiveCameraIndex,
                IsWalking = control->IsWalking, IsWalkingDuringAutorun = control->IsWalkingDuringAutorun };
            if (manager->ActiveCameraIndex != 0)
                return result with { Reason = "当前不是普通游戏镜头，移动参考不可采用" };
            var camera = manager->Camera;
            if (camera == null) return result with { Reason = "普通游戏镜头不可读" };
            var position = camera->SceneCamera.Position;
            var lookAt = camera->SceneCamera.LookAtVector;
            result = result with { CameraDirH = camera->DirH, CameraDirV = camera->DirV,
                CameraControlMode = (int)camera->ControlMode, CameraZoomMode = (int)camera->ZoomMode,
                EventCameraAutoControl = camera->IsEventCameraAutoControl,
                CameraPosition = new(position.X, position.Y, position.Z),
                CameraLookAt = new(lookAt.X, lookAt.Y, lookAt.Z), Reason = "" };
            if (result.Readable) return result;
            // 非有限读数保留未知；不能让诊断 JSON 序列化失败，也不能填零冒充真实读数。
            return result with { CameraDirH = result.CameraDirH is double dirH && double.IsFinite(dirH) ? dirH : null,
                CameraDirV = result.CameraDirV is double dirV && double.IsFinite(dirV) ? dirV : null,
                CameraPosition = result.CameraPosition is { IsFinite: true } ? result.CameraPosition : null,
                CameraLookAt = result.CameraLookAt is { IsFinite: true } ? result.CameraLookAt : null,
                Reason = "镜头原始方向或位置不是有限观测" };
        }
        catch
        {
            // 不将部分读数或上次成功结果作为本帧可用状态。
            return new X1MovementReferenceSnapshot { AtMs = result.AtMs, Reason = "镜头或步行状态读取失败" };
        }
    }
}
