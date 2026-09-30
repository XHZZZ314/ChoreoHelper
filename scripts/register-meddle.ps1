# 这个脚本是干嘛的：等游戏完全退出后，把 devPlugins\Meddle\Meddle.Plugin.dll
# 登记进 dalamudConfig.json 的 DevPluginLoadLocations（和 ChoreoHelper 同样的登记制）。
# 原因：游戏运行中改配置会在退出时被 Dalamud 写回覆盖，必须等 ffxiv_dx11.exe 退出再改。
# 用法：powershell -File scripts\register-meddle.ps1 [等待分钟数，默认 9]
param([int]$WaitMinutes = 9)
$ErrorActionPreference = 'Stop'
$cfg  = Join-Path $env:AppData 'XIVLauncherCN\dalamudConfig.json'
$bak  = "$cfg.backup-before-meddle-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$dll  = "$env:AppData\XIVLauncherCN\devPlugins\Meddle\Meddle.Plugin.dll"

# 1) 等游戏退出（最多 WaitMinutes 分钟）
$deadline = (Get-Date).AddMinutes($WaitMinutes)
while (Get-Process -Name 'ffxiv_dx11' -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $deadline) { Write-Output 'RESULT=TIMEOUT 游戏还在运行，未登记（下次再跑即可）'; exit 2 }
  Start-Sleep -Seconds 3
}
Write-Output '游戏已退出，等 8 秒让 Dalamud 写完配置…'
Start-Sleep -Seconds 8

# 2) 字符串级手术插入（不用 ConvertTo-Json 重写，避免 JSON.NET 类型注解被改写）
$text = [IO.File]::ReadAllText($cfg)
if ($text.Contains('devPlugins\\Meddle\\Meddle.Plugin.dll')) {
  Write-Output 'RESULT=ALREADY 已登记过，无需重复'; exit 0
}
$anchor = $text.IndexOf('"DevPluginLoadLocations"')
if ($anchor -lt 0) { Write-Output 'RESULT=ERROR 找不到 DevPluginLoadLocations'; exit 1 }
$valuesIdx = $text.IndexOf('"$values"', $anchor)
if ($valuesIdx -lt 0) { Write-Output 'RESULT=ERROR 找不到 $values'; exit 1 }
$closeIdx = $text.IndexOf(']', $valuesIdx)
if ($closeIdx -lt 0) { Write-Output 'RESULT=ERROR 找不到数组结尾'; exit 1 }

$entry = ",`n      {`n        `"`$type`": `"Dalamud.Configuration.DevPluginLocationSettings, Dalamud`",`n        `"Path`": `"C:\\Users\\xhz\\AppData\\Roaming\\XIVLauncherCN\\devPlugins\\Meddle\\Meddle.Plugin.dll`",`n        `"IsEnabled`": true,`n        `"Nickname`": null`n      }"
$new = $text.Insert($closeIdx, $entry)

# 3) 备份 + 校验 + 落盘（校验失败回滚）
[IO.File]::Copy($cfg, $bak, $true)
try {
  $null = $new | ConvertFrom-Json   # JSON 语法校验
  $count = ([regex]::Matches($new, 'DevPluginLocationSettings, Dalamud')).Count
  if ($count -lt 2) { throw "登记条目数异常: $count" }
  [IO.File]::WriteAllText($cfg, $new, (New-Object System.Text.UTF8Encoding $false))
  Write-Output "RESULT=OK 已登记 Meddle（备份: $bak）"
} catch {
  Write-Output "RESULT=ERROR 校验失败已回滚: $_"
}
