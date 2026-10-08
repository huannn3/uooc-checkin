$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('uooc-ui-' + [Guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Path $testRoot
    foreach ($file in @('ui.ps1', 'uooc.ico')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $testRoot }
    $fakeTask = $null
    function Get-ScheduledTask { param($TaskName, $ErrorAction) return $fakeTask }
    . (Join-Path $testRoot 'ui.ps1') -SelfTest -SelfTestCheck {
        if ($courseList.Items.Count -ne 0 -or $runButton.Enabled -or -not $setupButton.Enabled -or -not $startupButton.Enabled) { throw 'Fresh UI does not allow setup and optional startup.' }
    }
    $url = 'https://www.uooc.net.cn/home/course/123'
    [IO.File]::WriteAllText((Join-Path $testRoot 'config.json'), (@{ courses = @($url) } | ConvertTo-Json))
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-auth.json'), '{}')
    $report = @{ loginExpired = $false; courses = @{ $url = @{ count = 3; total = 30; status = 'already'; checkedAt = '2026-10-07T00:00:00Z' } } }
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-status.json'), ($report | ConvertTo-Json -Depth 5))
    . (Join-Path $testRoot 'ui.ps1') -SelfTest -SelfTestCheck {
        if ($courseList.Items[0].SubItems[1].Text -ne '3 / 30') { throw 'UI did not show the saved count and target.' }
        if ($courseList.Items[0].SubItems[2].Text -ne '123') { throw 'Course ID column was lost.' }
        if ($courseList.Items[0].ToolTipText -notlike '*2026-10-07 08:00:00*') { throw 'Count timestamp must display Beijing time.' }
    }
    $report.courses[$url].countPending = $true
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-status.json'), ($report | ConvertTo-Json -Depth 5))
    . (Join-Path $testRoot 'ui.ps1') -SelfTest -SelfTestCheck {
        if ($courseList.Items[0].SubItems[1].Text -ne '3 / 30 待同步') { throw 'Unsynced counts must be explicitly marked.' }
        $script:OriginalStatusReader = ${function:Read-Status}
        try {
            function script:Read-Status { throw 'fixture sharing failure' }
            Update-State
            if ($courseList.Items[0].SubItems[1].Text -ne '3 / 30 待同步') { throw 'A temporary read failure must preserve the last display.' }
        } finally { Set-Item Function:script:Read-Status -Value $script:OriginalStatusReader }
        $report.courses[$url].count = 4
        $report.courses[$url].countPending = $false
        [IO.File]::WriteAllText($script:StatusPath, ($report | ConvertTo-Json -Depth 5))
        Update-State
        if ($courseList.Items[0].SubItems[1].Text -ne '4 / 30') { throw 'The display must refresh after counts synchronize.' }
        $script:BeforeReadTime = (Get-Item -LiteralPath $script:StatusPath).LastWriteTimeUtc
        $script:ReplacementReport = $report
        try {
            function script:Read-Status {
                $oldResult = & $script:OriginalStatusReader
                $script:ReplacementReport.courses[$url].count = 5
                [IO.File]::WriteAllText($script:StatusPath, ($script:ReplacementReport | ConvertTo-Json -Depth 5))
                [IO.File]::SetLastWriteTimeUtc($script:StatusPath, $script:BeforeReadTime.AddSeconds(2))
                return $oldResult
            }
            Update-State
            if ($script:LastStatusTime -ne $script:BeforeReadTime) { throw 'A replacement during reading must not hide the next refresh.' }
        } finally { Set-Item Function:script:Read-Status -Value $script:OriginalStatusReader }
        if ((Get-Item -LiteralPath $script:StatusPath).LastWriteTimeUtc -ne $script:LastStatusTime) { Update-State }
        if ($courseList.Items[0].SubItems[1].Text -ne '5 / 30') { throw 'The next tick must load a replacement made during reading.' }
    }
    $report.loginExpired = $true
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-status.json'), ($report | ConvertTo-Json -Depth 5))
    $fakeTask = [PSCustomObject]@{ State = 'Ready'; Actions = @([PSCustomObject]@{ Arguments = '"C:\Other\launch.vbs" run' }) }
    . (Join-Path $testRoot 'ui.ps1') -SelfTest -SelfTestCheck {
        if ($courseList.Items[0].SubItems[1].Text -ne '5 / 30 旧' -or $accountLabel.ForeColor.R -le $accountLabel.ForeColor.G) { throw 'Expired state must mark old counts and show a warning.' }
        if ($disableButton.Enabled -or $stopStartupButton.Enabled -or $startupButton.Enabled) { throw 'UI must not manage a foreign task.' }
    }
    Write-Output 'Passed: first launch, count display/refresh, pending label, read failures, Beijing timestamps, login warning and task protection.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'uooc-ui-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}
