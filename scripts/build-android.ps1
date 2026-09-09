[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = (Get-Location).Path
$unityAndroid = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer'
$sdk = Join-Path $unityAndroid 'SDK'
$jdkRoot = Join-Path $workspace '.android-build\jdk'
$jdk = Get-ChildItem -LiteralPath $jdkRoot -Directory -ErrorAction Stop | Select-Object -First 1 -ExpandProperty FullName
$gradle = Join-Path $workspace 'apps\android\gradlew.bat'
$androidProject = Join-Path $workspace 'apps\android'
$apk = Join-Path $workspace 'apps\android\app\build\outputs\apk\debug\app-debug.apk'
$artifactDirectory = Join-Path $workspace 'artifacts'
$artifact = Join-Path $artifactDirectory 'VaultTerminal-debug-0.1.6.apk'

if (-not (Test-Path -LiteralPath (Join-Path $sdk 'platforms\android-36'))) { throw 'Android SDK Platform 36 is missing.' }
if (-not (Test-Path -LiteralPath $gradle)) { throw 'Android project is missing. Run npx cap add android.' }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = Join-Path $workspace '.gradle-cache'

& node (Join-Path $workspace 'node_modules\tsx\dist\cli.mjs') (Join-Path $workspace 'scripts\build.ts')
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
& node (Join-Path $workspace 'node_modules\@capacitor\cli\bin\capacitor') sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
& node (Join-Path $workspace 'scripts\icons.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Android icon generation failed.' }
Push-Location -LiteralPath $androidProject
try {
  & $gradle ':app:assembleDebug' '--no-daemon' '--stacktrace'
} finally {
  Pop-Location
}
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $apk)) { throw 'Gradle did not create a debug APK.' }
& (Join-Path $sdk 'build-tools\36.0.0\apksigner.bat') verify '--verbose' $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
Copy-Item -LiteralPath $apk -Destination $artifact -Force
Get-FileHash -LiteralPath $artifact -Algorithm SHA256 | Select-Object Path,Hash
Get-Item -LiteralPath $artifact | Select-Object FullName,Length,LastWriteTime
