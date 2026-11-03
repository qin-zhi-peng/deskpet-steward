# 一行启动：服务 + 桌宠
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1 [-NoPet]
param([switch]$NoPet)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'steward.ps1') start -NoPet:$NoPet
