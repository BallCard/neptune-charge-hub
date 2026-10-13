import json
import shutil
import subprocess
import unittest
from pathlib import Path


class WindowsTaskArgumentsTests(unittest.TestCase):
    def test_json_date_arguments_in_both_powershell_versions_and_cultures(self):
        # Exercise the actual JSON parser and formatting boundary that broke at 06:15.
        helper = Path(__file__).resolve().parents[1] / "task_helpers.ps1"
        script = r"""
$ErrorActionPreference = 'Stop'
. '__HELPER__'
$results = @()
foreach ($culture in @('zh-CN', 'en-US')) {
    [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($culture)
    foreach ($iso in @('2026-10-07T06:00:00+08:00', '2026-10-06T22:00:00+00:00')) {
        $state = ('{"scheduled_at":"' + $iso + '"}') | ConvertFrom-Json
        $argsText = Get-FailureWatchArguments 'C:\test path\failure_email.py' 'C:\test path\reservation.json' $state.scheduled_at
        $date = Get-ReservationTime $state.scheduled_at
        $results += [PSCustomObject]@{Arguments=$argsText; Schedule=$date.ToString('yyyy-MM-ddTHH:mm:sszzz')}
    }
}
ConvertTo-Json -InputObject $results -Compress
""".replace("__HELPER__", str(helper).replace("'", "''"))
        found = 0
        for command in ("powershell.exe", "pwsh.exe"):
            shell = shutil.which(command)
            if not shell:
                continue
            found += 1
            with self.subTest(shell=command):
                completed = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-Command", script],
                    capture_output=True, timeout=25, check=True)
                results = json.loads(completed.stdout.decode("utf-8-sig"))
                self.assertEqual(len(results), 4)
                for result in results:
                    self.assertEqual(result["Schedule"], "2026-10-07T06:00:00+08:00")
                    self.assertTrue(result["Arguments"].endswith('--scheduled-at "2026-10-07T06:00:00+08:00"'))
        if not found:
            self.skipTest("Windows PowerShell is unavailable")
