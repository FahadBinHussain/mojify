param(
  [string]$Source = "extension",
  [string]$DistRoot = "dist",
  [string]$OutName = "extension"
)

$ErrorActionPreference = "Stop"

$sourcePath = Resolve-Path $Source
$distPath = Join-Path (Resolve-Path ".") $DistRoot
$outPath = Join-Path $distPath $OutName

if (Test-Path $distPath) {
  Remove-Item -LiteralPath $distPath -Recurse -Force
}

New-Item -ItemType Directory -Path $outPath -Force | Out-Null

# Copy all extension files except private keys and dev artifacts.
Get-ChildItem -LiteralPath $sourcePath -Recurse -Force | ForEach-Object {
  $full = $_.FullName
  $relative = $full.Substring($sourcePath.Path.Length).TrimStart('\')
  if (-not $relative) { return }

  if ($relative -match '\.pem$' -or $relative -like '*.crx') {
    return
  }

  $dest = Join-Path $outPath $relative
  if ($_.PSIsContainer) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
  } else {
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $full -Destination $dest -Force
  }
}

Write-Host "Built extension to: $outPath"
