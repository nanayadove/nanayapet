param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    [string]$Notes = ""
)

$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Error "没有找到 .env 文件，请在项目根目录创建并填入 GH_TOKEN=你的token"
    exit 1
}

Get-Content $envFile | Where-Object { $_ -match '^\s*([^#].+?)\s*=\s*(.+?)\s*$' } | ForEach-Object {
    $name = $Matches[1]
    $value = $Matches[2]
    Set-Item -Path "env:$name" -Value $value
}

$zip = Get-ChildItem -Path (Join-Path $PSScriptRoot "dist") -Filter "*.zip" | Select-Object -First 1
if (-not $zip) {
    Write-Error "dist 目录下没有 zip 文件，请先 npm run dist"
    exit 1
}

$gh = Join-Path $PSScriptRoot "tools\gh\bin\gh.exe"
if (-not (Test-Path $gh)) {
    Write-Error "gh CLI 未找到，请先放入 tools\gh\"
    exit 1
}

Write-Output "发布 $Version ..."
& $gh release create "v$Version" $zip.FullName --title "v$Version" --notes $Notes --repo nanayadove/nanayapet

if ($LASTEXITCODE -eq 0) {
    Write-Output "发布成功: https://github.com/nanayadove/nanayapet/releases/tag/v$Version"
}
