# 临时脚本：还原并置前 FF14 主窗口（用完即删）
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -Name R -Namespace W
$h = (Get-Process -Id 42376).MainWindowHandle
[W.R]::ShowWindow($h, 9) | Out-Null
Start-Sleep -Milliseconds 600
[W.R]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 900
$fg = [W.R]::GetForegroundWindow()
Write-Host ("ForegroundMatch=" + ($fg -eq $h))
