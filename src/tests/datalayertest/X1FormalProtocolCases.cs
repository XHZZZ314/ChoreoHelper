// 这个文件是干嘛的：X1 形式协议夹具（测试用标准包 JSON）。
// 捐赠源：x1-protocol-boundary-repair-20260912-161407-240/X1FormalProtocolTests.cs
// 的 Fixture()（逐字提取；该文件的其余用例未采用）。
using System;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChoreoHelper;

internal static class X1FormalProtocolCases
{
        internal static JsonObject Fixture() => JsonNode.Parse("""
        {"protocolVersion":1,"compiler":"formal-test","projectId":"project","name":"整包",
         "durationMs":2000,"timelineRevision":7,"projectHash":"hash",
         "performers":[{"id":"dancer-a","name":"本人"}],
         "capabilities":[{"name":"x1-input-v1","minProtocol":1},{"name":"ability-execution","minProtocol":1},{"name":"movement-control","minProtocol":1}],
         "x1":{"version":1,"bindings":[
           {"performerId":"dancer-a","actorId":"10001","territoryId":339,"stage":{"id":"stage-a","originX":10,"originZ":20,"yawDeg":90}},
           {"performerId":"dancer-b","actorId":"10002","territoryId":339,"stage":{"id":"stage-a","originX":10,"originZ":20,"yawDeg":90}}]},
         "events":[
           {"id":"skill","performerId":"dancer-a","kind":"ability","startMs":0,"durationMs":0,
            "x1":{"version":1,"failurePolicy":"skip","actionId":"31","requiredJobId":"21","requiredLevel":30,"targetId":"10002",
             "requiredConditions":["jobMatches","levelMeets","targetValid","notCasting","cooldownReady","movementAllowed","controllable"]}},
           {"id":"walk","performerId":"dancer-a","kind":"movement","startMs":0,"durationMs":1000,
            "x1":{"version":1,"failurePolicy":"stopShow","locomotion":"walk","arrivalToleranceM":0.25,"maxCorrectionM":1.5,
             "points":[{"tMs":0,"x":0,"z":0},{"tMs":1000,"x":0,"z":1}]}},
           {"id":"face","performerId":"dancer-a","kind":"facing","startMs":1000,"durationMs":1000,
            "x1":{"version":1,"failurePolicy":"skip","mode":"transition","transitionFromDeg":350,"transitionToDeg":370}},
           {"id":"bow","performerId":"dancer-a","kind":"motion","startMs":2000,"durationMs":0,"command":"/bow motion","name":"鞠躬","playMode":"once"}
         ]}
        """)!.AsObject();
}
