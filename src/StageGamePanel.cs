// 游戏内路径操作面板：只调用既有准备、映射、演出入口，不拥有播放时钟或输入。
using System;
using System.Numerics;
using System.Text.Json;
using Dalamud.Bindings.ImGui;

namespace ChoreoHelper;

public sealed record StageGamePanelView(string Identity, string InputJson, string ShowJson, string Mapping, bool Confirmed, long CountdownRemainingMs = 0);

public sealed class StageGamePanel
{
    private readonly Func<StageGamePanelView> _read;
    private readonly Action<string,string> _command;
    private readonly Action? _openWeb;
    public bool Open = true;
    public StageGamePanel(Func<StageGamePanelView> read, Action<string,string> command, Action? openWeb = null)
    { _read=read; _command=command; _openWeb=openWeb; }
    public void Draw()
    {
        if(!Open)return;
        ImGui.SetNextWindowSize(new Vector2(610,740),ImGuiCond.FirstUseEver);
        var visible=ImGui.Begin("ChoreoHelper · 短演出控制###ChoreoStageControl",ref Open);
        try
        {
            if(!visible)return;
            ImGui.SetWindowFontScale(1.25f);
            var view=_read();
            using var input=JsonDocument.Parse(view.InputJson);
            using var show=JsonDocument.Parse(view.ShowJson);
            var i=input.RootElement; var s=show.RootElement;
            var state=Text(s,"state"); var running=state is "playing" or "countdown" or "armed" or "stopping";
            var preparing=Flag(i.GetProperty("cameraPreparation"),"active")||Flag(i.GetProperty("automaticPreparation"),"active");
            {
                ImGui.SetWindowFontScale(2.5f);
                ImGui.TextColored(state=="playing"?new Vector4(.3f,1,.5f,1):new Vector4(1,.8f,.2f,1),
                    preparing?"准备中":state=="countdown"?"倒数 "+Math.Max(1,(long)Math.Ceiling(view.CountdownRemainingMs/1000d)):
                    state=="playing"?"正在演出":state=="completed"?"本场已结束":Text(s,"stopReason").Length>0?"已停止":state is "loaded" or "armed"?"尚未开始":"已停止");
                ImGui.SetWindowFontScale(1.25f);
                ImGui.TextWrapped(preparing?"别按键：这是三键准备，尚未开始路径。":state=="countdown"?"请保持键鼠全松，倒数结束才执行。":
                    state=="playing"?"按所选手动模式处理输入；随时可以停止。":"准备会短暂移动；确认并明确开始后才执行路径。");
                ImGui.Separator();
            }
            var cleanup=Flag(i,"cleanupFailed")||Flag(s,"cleanupFailed");
            var pending=Flag(i,"stageRequestPending");
            var busy=running||pending||Flag(i.GetProperty("coordinateFeedback"),"ownsInput")||Flag(i.GetProperty("cameraPreparation"),"active");
            var mode=i.GetProperty("stageManual");
            ImGui.TextWrapped("先网页审阅并登记本场 → 本面板准备 → 查看映射 → 确认 → 明确开始。停止后回网页保存结果到独立项目。");
            ImGui.TextWrapped("当前："+StateText(state)+" · "+Text(s,"showTimeMs")+" ms");
            ImGui.TextWrapped("插件 "+typeof(StageGamePanel).Assembly.GetName().Version?.ToString(3)+" · 本机面板已连接；网页版本/能力匹配请点网页重新连接。");
            if(_openWeb!=null && ImGui.Button("打开网页（编排 / 配对 / 结果）"))_openWeb();
            ImGui.TextWrapped("登记项目："+(Text(s,"projectId").Length==0?"无；请在网页读取角色并登记":Text(s,"name")+"（"+Text(s,"projectId")+"）"));
            if(Text(s,"stopReason").Length!=0)ImGui.TextWrapped("停止原因："+Text(s,"stopReason"));
            ImGui.Separator();
            ImGui.BeginDisabled(busy||cleanup);
            if(ImGui.RadioButton("手动打断自动",Text(mode,"mode")=="Interrupt"))_command("mode interrupt",view.Identity);
            ImGui.SameLine();
            if(ImGui.RadioButton("手动与自动协同",Text(mode,"mode")=="Cooperate"))_command("mode cooperate",view.Identity);
            ImGui.EndDisabled();
            ImGui.TextWrapped(Text(mode,"description"));
            ImGui.TextWrapped("协同可用键："+string.Join("、",mode.GetProperty("cooperativeKeys").EnumerateArray()));
            ImGui.TextWrapped("自动同键、未列出按键和鼠标会停止本场。手柄模式拒绝开始。失焦、清理失败或观测超时均停止。");
            Button("1 准备（会短距离移动）","prepare",view,busy||cleanup);
            ImGui.SameLine(); Button("2 查看当前位置映射","show-review",view,busy||cleanup);
            Button("3 确认此映射","show-confirm",view,busy||cleanup||view.Mapping.Length==0);
            ImGui.SameLine(); Button("4 明确开始一次","show-start",view,busy||cleanup||!view.Confirmed);
            Button("立即停止 / 取消准备","stop",view,false);
            ImGui.TextWrapped("准备：前进、左、右各150毫秒一次，总计≤3米/10秒。整场最长5分钟，每段路径≤1.5米/4秒；动作与自身技能按审阅时刻各一次；路径外独立朝向按原时钟调用身体朝向，实际效果须实机确认。原时序原节点不改写。失败不自动重试。");
            ImGui.Separator();
            if(i.TryGetProperty("actor",out var actor)&&actor.ValueKind==JsonValueKind.Object)
                ImGui.TextWrapped($"角色 #{Text(actor,"id")} / 区域 {Text(actor,"territoryId")} / 当前 ({Text(actor,"worldX")}, {Text(actor,"worldZ")})");
            ImGui.TextWrapped("映射确认："+(view.Confirmed?"已确认，等待明确开始":"未确认或已消费；角色、区域、位置、模式或登记变化后须重新审阅"));
            var mapping=view.Mapping;
            if(mapping.Length==0 && s.TryGetProperty("stageMapping",out var oldMapping) && oldMapping.ValueKind==JsonValueKind.Object) mapping="历史映射（无执行许可）：\n"+Text(oldMapping,"summary");
            ImGui.TextWrapped(mapping.Length==0?"尚未查看本次映射。":mapping);
            ImGui.Separator();
            ImGui.TextWrapped("演出状态："+StateText(state)+" / 原演出时钟："+Text(s,"showTimeMs")+" ms");
            ImGui.TextWrapped("当前反馈："+Text(i,"status"));
            ImGui.TextWrapped("停止/失败原因："+Text(s,"stopReason"));
            if(cleanup)ImGui.TextWrapped("清理未确认：禁止准备与开始。请明确点击立即停止重试清理。");
            var feedback=i.GetProperty("coordinateFeedback");
            if(feedback.TryGetProperty("lastReport",out var report)&&report.ValueKind==JsonValueKind.Object)
            {
                ImGui.TextWrapped("上次结果："+Text(report,"Status")+"；手动介入 "+Text(report,"ManualInterventions")+" / 续走 "+Text(report,"ManualResumptions"));
                ImGui.TextWrapped("有结果可供网页核对；是否属于本场及是否已保存，以网页身份校验和数据库回执为准。");
            }
            else ImGui.TextWrapped("当前无可读取结果；插件重载可能已清除未保存结果，不能自动恢复。");
            ImGui.TextWrapped("断线或重载：网页「游戏走位」→ 重新连接 / 刷新状态 → 重新审阅 → 重新登记。连接恢复不会准备或开始。");
            ImGui.TextWrapped("保存：停止后回网页「游戏走位」读取本次结果并保存。建议先从原项目建立独立副本；恢复历史结果只恢复记录，不恢复确认或执行许可。");
        }
        catch(Exception error){ImGui.TextWrapped("面板读取失败，未发送操作："+error.Message);}
        finally{ImGui.End();}
    }
    private void Button(string label,string command,StageGamePanelView view,bool disabled)
    { ImGui.BeginDisabled(disabled);if(ImGui.Button(label))_command(command,view.Identity);ImGui.EndDisabled(); }
    private static string StateText(string state)=>state switch {"idle"=>"等待网页登记","loaded"=>"已登记，待审阅确认","armed"=>"已准备开演","countdown"=>"倒数中，请保持全松","playing"=>"正在执行","stopping"=>"正在停止","completed"=>"本次已结束","faulted"=>"已停止：发生失败",_=>state};
    private static bool Flag(JsonElement e,string key)=>e.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.True;
    private static string Text(JsonElement e,string key)=>e.TryGetProperty(key,out var v)&&v.ValueKind!=JsonValueKind.Null?v.ToString():"";
}
