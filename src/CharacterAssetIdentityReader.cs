// 在框架线程读取当前人物的真实资源骨架编号，不凭职业、姓名或骨骼数量推测。
using System.Globalization;
using System.Text.Json;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.Game.Character;
using FFXIVClientStructs.FFXIV.Client.Graphics.Scene;

namespace ChoreoHelper;

internal static class CharacterAssetIdentityReader
{
    internal static unsafe string ReadJson(IObjectTable objects)
    {
        var player = objects.LocalPlayer;
        if (player == null || player.Address == 0) return Unavailable("请先登录游戏角色");
        var character = (Character*)player.Address;
        var draw = character->GameObject.DrawObject;
        if (draw == null || draw->GetObjectType() != ObjectType.CharacterBase)
            return Unavailable("当前角色模型尚未加载");
        var model = (CharacterBase*)draw;
        if (model->GetModelType() != CharacterBase.ModelType.Human)
            return Unavailable("当前模型不是可识别的人物骨架");
        var human = (Human*)model;
        var code = human->RaceSexId;
        if (code is < 1 or > 9999 || model->Skeleton == null)
            return Unavailable("当前角色骨架尚未准备好");
        return JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            available = true,
            sourceSkeletonCode = "c" + code.ToString("D4", CultureInfo.InvariantCulture),
        });
    }

    private static string Unavailable(string message) => JsonSerializer.Serialize(new
    {
        schemaVersion = 1, available = false, sourceSkeletonCode = "", message,
    });
}
