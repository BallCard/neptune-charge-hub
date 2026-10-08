$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskPaths=Get-Content -LiteralPath (Join-Path $taskRoot '.local/android-toolchain/paths.json') -Raw | ConvertFrom-Json
$taskJavaBin=Split-Path -Parent $taskPaths.java
$taskJson=Join-Path $taskRoot '.local/android-toolchain/json-test.jar'
$taskClasses=Join-Path $taskRoot '.local/android-core-tests'
New-Item -ItemType Directory -Path $taskClasses -Force | Out-Null
$taskSources=@('Checks.java','Platform.java','ChargeRunner.java','ResultMail.java','NotificationResult.java','BackupCodec.java') | ForEach-Object {Join-Path $taskRoot ('native/android/src/cn/neptune/local/'+$_)}
$taskTest=Join-Path $taskRoot 'native/android/tests/cn/neptune/local/CoreTests.java'
& (Join-Path $taskJavaBin 'javac.exe') '-J-Duser.language=en' -encoding UTF-8 -source 8 -target 8 '-Xlint:-options' -classpath $taskJson -d $taskClasses @taskSources $taskTest
if($LASTEXITCODE -ne 0){throw 'Isolated Android core tests compilation failed.'}
& $taskPaths.java '-Dfile.encoding=UTF-8' '-Duser.language=en' -classpath ($taskClasses+';'+$taskJson) cn.neptune.local.CoreTests
if($LASTEXITCODE -ne 0){throw 'Isolated Android execution tests failed.'}
