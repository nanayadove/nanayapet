# NetPet 调试模式 (PowerShell)
# PowerShell 原生支持 UTF-8，中文不会乱码
Set-Location -LiteralPath $PSScriptRoot
Write-Host "=== NetPet 调试模式 ===" -ForegroundColor Green
Write-Host "关闭此窗口 = 退出桌宠`n"
& ".\node_modules\electron\dist\electron.exe" .
