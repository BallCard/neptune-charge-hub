$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPaths = Get-Content -LiteralPath (Join-Path $taskRoot '.local/android-toolchain/paths.json') -Raw | ConvertFrom-Json
$taskJavaBin = Split-Path -Parent $taskPaths.java
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskBuild = Join-Path $taskRoot ('.local/android-build/' + $taskStamp)
$taskClasses = Join-Path $taskBuild 'classes'
$taskDex = Join-Path $taskBuild 'dex'
$taskAssets = Join-Path $taskBuild 'assets/web'
New-Item -ItemType Directory -Path $taskClasses,$taskDex,$taskAssets -Force | Out-Null
$taskOut = Join-Path $taskRoot 'out'
if (-not (Test-Path -LiteralPath (Join-Path $taskOut 'index.html'))) { throw 'Build the static web UI first.' }
$taskInfo = Get-Content -LiteralPath (Join-Path $taskOut 'build-info.json') -Raw | ConvertFrom-Json
if ($taskInfo.version -ne 2) { throw 'A successful rebuilt UI is required.' }
foreach ($taskSource in $taskInfo.sourceHashes) {
    if ((Get-FileHash -LiteralPath (Join-Path $taskRoot $taskSource.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskSource.sha256) { throw 'Web build is stale. Run npm run build before APK packaging.' }
}
foreach ($taskFile in Get-ChildItem -LiteralPath $taskOut -Recurse -File) {
    $taskRelative = $taskFile.FullName.Substring($taskOut.Length + 1)
    if ($taskRelative.StartsWith('downloads\') -or $taskRelative -eq 'sw.js') { continue }
    $taskTarget = Join-Path $taskAssets $taskRelative
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskTarget) -Force | Out-Null
    Copy-Item -LiteralPath $taskFile.FullName -Destination $taskTarget
}
$taskSources = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'native/android/src') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
& (Join-Path $taskJavaBin 'javac.exe') '-J-Duser.language=en' -encoding UTF-8 -source 8 -target 8 '-Xlint:-options' -classpath $taskPaths.androidJar -d $taskClasses @taskSources
if ($LASTEXITCODE -ne 0) { throw 'Android source compilation failed.' }
$taskJar = Join-Path $taskBuild 'app-classes.jar'
& (Join-Path $taskJavaBin 'jar.exe') --create --file $taskJar -C $taskClasses .
if ($LASTEXITCODE -ne 0) { throw 'Java archive failed.' }
$taskD8Jar = Join-Path $taskPaths.buildTools 'lib/d8.jar'
& $taskPaths.java -cp $taskD8Jar com.android.tools.r8.D8 --lib $taskPaths.androidJar --min-api 26 --output $taskDex $taskJar
if ($LASTEXITCODE -ne 0) { throw 'Android bytecode compilation failed.' }
$taskUnsigned = Join-Path $taskBuild 'unsigned.apk'
& (Join-Path $taskPaths.buildTools 'aapt2.exe') link -I $taskPaths.androidJar --manifest (Join-Path $taskRoot 'native/android/AndroidManifest.xml') -A (Join-Path $taskBuild 'assets') --min-sdk-version 26 --target-sdk-version 35 --version-code 2 --version-name '0.2.0-test' -o $taskUnsigned
if ($LASTEXITCODE -ne 0) { throw 'Android resources packaging failed.' }
& (Join-Path $taskJavaBin 'jar.exe') --update --file $taskUnsigned -C $taskDex classes.dex
if ($LASTEXITCODE -ne 0) { throw 'Android dex packaging failed.' }
$taskAligned = Join-Path $taskBuild 'aligned.apk'
& (Join-Path $taskPaths.buildTools 'zipalign.exe') -p -f 4 $taskUnsigned $taskAligned
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
$taskKeystore = Join-Path $taskRoot '.local/android-toolchain/development-signing.p12'
if (-not (Test-Path -LiteralPath $taskKeystore)) {
    & (Join-Path $taskJavaBin 'keytool.exe') -genkeypair -noprompt -keystore $taskKeystore -storepass android -keypass android -alias neptune-dev -dname 'CN=Neptune local development' -keyalg RSA -keysize 2048 -validity 3650
    if ($LASTEXITCODE -ne 0) { throw 'Development signing key creation failed.' }
}
$taskDownloads = Join-Path $taskRoot 'public/downloads'
New-Item -ItemType Directory -Path $taskDownloads -Force | Out-Null
$taskApk = Join-Path $taskDownloads 'neptune-local-assistant.apk'
$taskSignerJar = Join-Path $taskPaths.buildTools 'lib/apksigner.jar'
& $taskPaths.java -jar $taskSignerJar sign --v4-signing-enabled false --ks $taskKeystore --ks-key-alias neptune-dev --ks-pass pass:android --key-pass pass:android --out $taskApk $taskAligned
if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
& $taskPaths.java -jar $taskSignerJar verify --verbose --print-certs $taskApk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$taskHash = (Get-FileHash -LiteralPath $taskApk -Algorithm SHA256).Hash.ToLowerInvariant()
@{apk='neptune-local-assistant.apk';version='0.2.0-test';sha256=$taskHash;bytes=(Get-Item -LiteralPath $taskApk).Length;realDeviceValidated=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDownloads 'version.json') -Encoding utf8
Write-Output ('APK built and signature verified: ' + $taskApk)
