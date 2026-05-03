$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
$outDir = Join-Path $root 'dist\android'
$out = Join-Path $outDir 'Budget-debug.apk'

if (!(Test-Path $apk)) {
  throw "APK not found at $apk. Run 'cmd /c npm run android:apk' after Android Studio/SDK is installed."
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item -Force -Path $apk -Destination $out
Write-Host "Copied installer to $out"
