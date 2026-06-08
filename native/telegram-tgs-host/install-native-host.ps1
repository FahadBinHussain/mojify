param(
  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both',

  [string]$ExtensionId = '',

  [string]$NodePath = '',

  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$HostName = 'com.mojify.tgs_host'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ExtensionManifestPath = Join-Path $RepoRoot 'extension\manifest.json'
$HostCmdPath = Join-Path $ScriptDir 'mojify-native-host.cmd'
$HostExePath = Join-Path $ScriptDir 'mojify-native-host.exe'
$HostScriptPath = Join-Path $ScriptDir 'mojify-native-host.js'
$GeneratedManifestPath = Join-Path $ScriptDir "$HostName.json"

function Get-CommandSource {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Get-ChromeExtensionIdFromKey {
  param([string]$Key)

  if (-not $Key) {
    throw 'manifest.json does not contain a key; pass -ExtensionId explicitly.'
  }

  $publicKeyBytes = [Convert]::FromBase64String($Key)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha256.ComputeHash($publicKeyBytes)
  $alphabet = 'abcdefghijklmnop'
  $builder = New-Object System.Text.StringBuilder

  for ($i = 0; $i -lt 16; $i += 1) {
    [void]$builder.Append($alphabet[[int](($hash[$i] -shr 4) -band 0x0f)])
    [void]$builder.Append($alphabet[[int]($hash[$i] -band 0x0f)])
  }

  return $builder.ToString()
}

function Get-BrowserRegistryPath {
  param([string]$BrowserName)

  switch ($BrowserName) {
    'Chrome' { return "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" }
    'Edge' { return "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" }
    default { throw "Unsupported browser: $BrowserName" }
  }
}

function Get-TargetBrowsers {
  if ($Browser -eq 'Both') {
    return @('Chrome', 'Edge')
  }

  return @($Browser)
}

function ConvertTo-CSharpLiteral {
  param([string]$Value)

  return $Value.Replace('\', '\\').Replace('"', '\"')
}

function New-NativeHostExecutable {
  param([string]$ResolvedNodePath)

  $escapedNodePath = ConvertTo-CSharpLiteral $ResolvedNodePath
  $source = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

public static class MojifyNativeHostLauncher
{
    private static void PumpStream(Stream input, Stream output, bool closeOutput)
    {
        byte[] buffer = new byte[8192];

        try
        {
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, read);
                output.Flush();
            }
        }
        finally
        {
            if (closeOutput)
            {
                try
                {
                    output.Close();
                }
                catch
                {
                }
            }
        }
    }

    public static int Main()
    {
        string scriptDir = AppDomain.CurrentDomain.BaseDirectory;
        string scriptPath = Path.Combine(scriptDir, "mojify-native-host.js");
        string nodePath = Environment.GetEnvironmentVariable("MOJIFY_NODE_PATH");

        if (String.IsNullOrWhiteSpace(nodePath))
        {
            nodePath = "$escapedNodePath";
        }

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = nodePath;
        startInfo.Arguments = "\"" + scriptPath + "\"";
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.RedirectStandardInput = true;
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;

        using (Process process = Process.Start(startInfo))
        {
            Task inputPump = Task.Run(delegate {
                PumpStream(Console.OpenStandardInput(), process.StandardInput.BaseStream, true);
            });
            Task outputPump = Task.Run(delegate {
                PumpStream(process.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
            });
            Task errorPump = Task.Run(delegate {
                PumpStream(process.StandardError.BaseStream, Console.OpenStandardError(), false);
            });

            process.WaitForExit();
            Task.WaitAll(new Task[] { outputPump, errorPump }, 5000);
            return process.ExitCode;
        }
    }
}
"@

  try {
    if (Test-Path $HostExePath) {
      Remove-Item $HostExePath -Force
    }
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $HostExePath -OutputType ConsoleApplication
    return $HostExePath
  } catch {
    Write-Warning "Could not build the native host .exe launcher: $($_.Exception.Message)"
    Write-Warning 'Falling back to the .cmd shim. If Chrome rejects it, rerun this installer after enabling .NET compilation.'
    return $HostCmdPath
  }
}

if ($Uninstall) {
  foreach ($targetBrowser in Get-TargetBrowsers) {
    $registryPath = Get-BrowserRegistryPath $targetBrowser
    if (Test-Path $registryPath) {
      Remove-Item $registryPath -Recurse -Force
      Write-Host "Removed $targetBrowser native host registration."
    } else {
      Write-Host "$targetBrowser native host registration was not present."
    }
  }

  exit 0
}

if (-not (Test-Path $HostScriptPath)) {
  throw "Missing native host script: $HostScriptPath"
}

if (-not (Test-Path $HostCmdPath)) {
  throw "Missing native host command shim fallback: $HostCmdPath"
}

if (-not $NodePath) {
  $NodePath = Get-CommandSource 'node'
}

if (-not $NodePath) {
  throw 'Node.js was not found on PATH. Install it with Scoop first: scoop install nodejs'
}

$ffmpegPath = Get-CommandSource 'ffmpeg'
if (-not $ffmpegPath) {
  Write-Warning 'ffmpeg was not found on PATH. Install it with Scoop first: scoop install ffmpeg'
}

if (-not $ExtensionId) {
  if (-not (Test-Path $ExtensionManifestPath)) {
    throw "Missing extension manifest: $ExtensionManifestPath"
  }

  $extensionManifest = Get-Content $ExtensionManifestPath -Raw | ConvertFrom-Json
  $ExtensionId = Get-ChromeExtensionIdFromKey $extensionManifest.key
}

$HostPath = New-NativeHostExecutable $NodePath

$nativeManifest = [ordered]@{
  name = $HostName
  description = 'Mojify Telegram TGS lossless conversion host'
  path = $HostPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$nativeManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $GeneratedManifestPath -Encoding UTF8

foreach ($targetBrowser in Get-TargetBrowsers) {
  $registryPath = Get-BrowserRegistryPath $targetBrowser
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -Path $registryPath -Value $GeneratedManifestPath
  Write-Host "Registered $HostName for $targetBrowser."
}

Write-Host "Manifest: $GeneratedManifestPath"
Write-Host "Host: $HostPath"
Write-Host "Allowed origin: chrome-extension://$ExtensionId/"
Write-Host "Node: $NodePath"
if ($ffmpegPath) {
  Write-Host "ffmpeg: $ffmpegPath"
}
