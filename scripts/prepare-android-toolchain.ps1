$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTools = Join-Path $taskRoot '.local/android-toolchain'
New-Item -ItemType Directory -Path $taskTools -Force | Out-Null
function Get-VerifiedArchive($Name, $Url, $Hash, $Algorithm) {
    $taskZip = Join-Path $taskTools $Name
    if (-not (Test-Path -LiteralPath $taskZip) -or (Get-FileHash -LiteralPath $taskZip -Algorithm $Algorithm).Hash.ToLowerInvariant() -ne $Hash.ToLowerInvariant()) {
        Invoke-WebRequest -Uri $Url -OutFile $taskZip -TimeoutSec 600
    }
    if ((Get-FileHash -LiteralPath $taskZip -Algorithm $Algorithm).Hash.ToLowerInvariant() -ne $Hash.ToLowerInvariant()) { throw 'Toolchain checksum mismatch.' }
    return $taskZip
}
$taskJdkAssets = Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse' -TimeoutSec 30
$taskJdkPackage = $taskJdkAssets[0].binary.package
$taskJdkZip = Get-VerifiedArchive 'jdk-17.zip' $taskJdkPackage.link $taskJdkPackage.checksum 'SHA256'
$taskJdkFolder = Join-Path $taskTools 'jdk'
if (-not (Test-Path -LiteralPath $taskJdkFolder)) { Expand-Archive -LiteralPath $taskJdkZip -DestinationPath $taskJdkFolder }
$taskRepositoryFile = Join-Path $taskRoot '.local/artifacts/android-repository.xml'
New-Item -ItemType Directory -Path (Split-Path -Parent $taskRepositoryFile) -Force | Out-Null
if (-not (Test-Path -LiteralPath $taskRepositoryFile)) { Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/repository2-3.xml' -OutFile $taskRepositoryFile -TimeoutSec 60 }
[xml]$taskRepository = Get-Content -LiteralPath $taskRepositoryFile -Raw
foreach ($taskPath in @('platforms;android-35', 'build-tools;35.0.0')) {
    $taskPackage = $taskRepository.SelectNodes("//*[local-name()='remotePackage']") | Where-Object { $_.path -eq $taskPath -and $_.revision.major -eq $(if ($taskPath.StartsWith('platforms')) { '2' } else { '35' }) } | Select-Object -First 1
    if (-not $taskPackage) { throw 'Requested SDK package missing from official repository.' }
    $taskArchive = $taskPackage.SelectNodes(".//*[local-name()='archive']") | Where-Object { $_.'host-os' -eq 'windows' -or -not $_.'host-os' } | Select-Object -First 1
    $taskComplete = $taskArchive.complete
    $taskHash = $taskComplete.SelectSingleNode("*[local-name()='checksum']").InnerText
    $taskName = $(if ($taskPath.StartsWith('platforms')) { 'platform.zip' } else { 'build-tools.zip' })
    $taskZip = Get-VerifiedArchive $taskName ('https://dl.google.com/android/repository/' + $taskComplete.url) $taskHash 'SHA1'
    $taskDestination = Join-Path $taskTools $(if ($taskPath.StartsWith('platforms')) { 'platform' } else { 'build-tools' })
    if (-not (Test-Path -LiteralPath $taskDestination)) { Expand-Archive -LiteralPath $taskZip -DestinationPath $taskDestination }
}
$taskJava = Get-ChildItem -LiteralPath $taskJdkFolder -Filter 'java.exe' -Recurse | Where-Object { $_.Directory.Name -eq 'bin' } | Select-Object -First 1
$taskAndroidJar = Get-ChildItem -LiteralPath (Join-Path $taskTools 'platform') -Filter 'android.jar' -Recurse | Select-Object -First 1
$taskAapt = Get-ChildItem -LiteralPath (Join-Path $taskTools 'build-tools') -Filter 'aapt2.exe' -Recurse | Select-Object -First 1
$taskJsonUrl = 'https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar'
$taskJsonHash = (Invoke-WebRequest -Uri ($taskJsonUrl + '.sha1') -UseBasicParsing -TimeoutSec 30).Content.Trim()
Get-VerifiedArchive 'json-test.jar' $taskJsonUrl $taskJsonHash 'SHA1' | Out-Null
@{java=$taskJava.FullName;androidJar=$taskAndroidJar.FullName;buildTools=$taskAapt.Directory.FullName} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskTools 'paths.json') -Encoding utf8
Write-Output 'Official JDK and Android build tools prepared locally; global installation unchanged.'
