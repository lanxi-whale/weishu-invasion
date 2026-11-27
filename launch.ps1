param([switch]$NoBrowser, [switch]$OpenWhenReady)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$opsPort = if ($env:OPS_PORT) { [int]$env:OPS_PORT } else { 3100 }
$monPort = if ($env:MON_PORT) { [int]$env:MON_PORT } else { 3101 }
$url = "http://localhost:$opsPort"
$expectedBuilds = @{}

function Find-Node {
    $candidates = @((Get-Command node.exe -All -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source))
    $candidates += "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
      if (!(Test-Path -LiteralPath $candidate)) { continue }
      $version = & $candidate --version 2>$null
      if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
        return $candidate
      }
    }
    throw 'Node.js 22 or newer is required. Install it from https://nodejs.org/'
}

function Test-Servers {
  try {
    $opsHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$opsPort/healthz" -TimeoutSec 1
    $monHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$monPort/healthz" -TimeoutSec 1
    if (!$opsHealth.ok -or !$monHealth.ok -or $opsHealth.app -ne '0.3.3' -or $monHealth.app -ne '0.3.3') { return $false }
    $script = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$opsPort/camp.js" -TimeoutSec 1).Content
    $assignment = [regex]::Match($script, '(?m)^window\.__SP_CAMP__ = (\{.+\});\r?$')
    if (!$assignment.Success) { return $false }
    $config = ConvertFrom-Json -InputObject $assignment.Groups[1].Value
    if (!$config.versionDataSnapshot -or $config.camp -ne 'ops' -or $config.front -ne $opsPort -or $config.ports.monster -ne $monPort) { return $false }

    $opsVersions = $opsHealth.versions.enabled -join ','
    $monVersions = $monHealth.versions.enabled -join ','
    $versionKey = "$opsVersions|$monVersions"
    if (!$expectedBuilds.ContainsKey($versionKey)) {
      $tags = @'
import path from 'node:path';
import { computeBuildTag as opsBuild } from './game_ops/server/http/buildTag.js';
import { computeBuildTag as monsterBuild } from './game/server/http/buildTag.js';
import { versionDataDir as opsDataDir } from './game_ops/server/data.js';
import { versionDataDir as monsterDataDir } from './game/server/data.js';

function localBuild(folder, versions, buildTag, dataDir) {
  const servedVersionDirs = versions.split(',').map(id => dataDir(id)).filter(Boolean);
  return buildTag(path.resolve(folder), { servedVersionDirs });
}

const [, , opsVersions, monsterVersions] = process.argv;
console.log(JSON.stringify({
  ops: localBuild('game_ops', opsVersions, opsBuild, opsDataDir),
  monster: localBuild('game', monsterVersions, monsterBuild, monsterDataDir),
}));
'@ | & $nodePath --input-type=module - $opsVersions $monVersions
      if ($LASTEXITCODE -ne 0) { return $false }
      $expectedBuilds[$versionKey] = ConvertFrom-Json -InputObject $tags
    }
    $expected = $expectedBuilds[$versionKey]
    return $expected.ops -and $expected.monster -and $opsHealth.build -eq $expected.ops -and $monHealth.build -eq $expected.monster
  } catch { return $false }
}

function Open-Game {
  $edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($edge) {
    Start-Process -FilePath $edge -ArgumentList @("--app=$url", '--window-size=1600,900', '--start-maximized')
  } else { Start-Process $url }
}

try {
  $nodePath = Find-Node
  if ($OpenWhenReady) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      if (Test-Servers) { Open-Game; exit 0 }
      Start-Sleep -Milliseconds 1000
    }
    exit 1
  }
  $firstOpsPort = $opsPort
  $firstMonPort = $monPort
  $listening = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
  $portsAvailable = $false
  for ($offset = 0; $offset -le 40 -and [Math]::Max($firstOpsPort, $firstMonPort) + $offset -le 65535; $offset += 2) {
    $opsPort = $firstOpsPort + $offset
    $monPort = $firstMonPort + $offset
    $url = "http://localhost:$opsPort"
    $opsInUse = $listening -contains $opsPort
    $monInUse = $listening -contains $monPort
    if (!$opsInUse -and !$monInUse) {
      $portsAvailable = $true
      break
    }
    if ($opsInUse -and $monInUse -and (Test-Servers)) {
      Write-Host "4v4 is already running: $url"
      if (!$NoBrowser) { Open-Game }
      exit 0
    }
  }
  if (!$portsAvailable) { throw 'No available 4v4 port pair was found.' }
  $env:OPS_PORT = [string]$opsPort
  $env:MON_PORT = [string]$monPort
  Write-Host "Node: $nodePath"
  Write-Host "Starting 4v4: $url"
  Write-Host 'Keep this window open. Press Ctrl+C to stop the server.'
  if (!$NoBrowser) {
    # A hidden helper waits for both camps; the server stays in this console.
    $helperArgs = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -OpenWhenReady'
    Start-Process -FilePath 'powershell.exe' -ArgumentList $helperArgs -WindowStyle Hidden
  }
  & $nodePath (Join-Path $PSScriptRoot 'start.js')
  exit $LASTEXITCODE
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
