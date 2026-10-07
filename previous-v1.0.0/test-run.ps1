$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('uooc-test-' + [Guid]::NewGuid().ToString('N'))
$originalEncoding = [Console]::OutputEncoding
try {
    $null = New-Item -ItemType Directory -Path $testRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run.ps1') -Destination $testRoot
    $null = New-Item -ItemType Directory -Path (Join-Path $testRoot 'runtime')
    # A placeholder is enough: installing a task resolves Node but does not execute it.
    [IO.File]::WriteAllText((Join-Path $testRoot 'runtime\node.exe'), '')
    function Get-Command { throw 'Portable runtime must work without an installed Node.js.' }
    # UTF-8 without BOM, including characters that break JSON under legacy decoding.
    $courseName = -join ([char[]]@(0x827A, 0x672F, 0x7684, 0x661F, 0x7A7A, 0xFF1A, 0x827A, 0x672F, 0x7F8E, 0x5B66, 0x5341, 0x4E8C, 0x8BB2))
    $url = 'https://www.uooc.net.cn/home/course/123'
    $json = @{ courses = @($url); courseNames = @{ $url = $courseName } } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $testRoot 'config.json'), $json, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $testRoot '.uooc-auth.json'), '{}')

    # Exercise the real install path without creating a Windows scheduled task.
    function Get-ScheduledTask { param($TaskName, $ErrorAction) return $null }
    function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) return @{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
    function New-ScheduledTaskTrigger { param([switch]$Daily, $At) return @{ Daily = $Daily.IsPresent; At = $At } }
    function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable, $MultipleInstances, $ExecutionTimeLimit) return @{} }
    function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) return @{} }
    function Register-ScheduledTask {
        param($TaskName, $Action, $Trigger, $Settings, $Principal, $Description, [switch]$Force)
        $testRegistration.Name = $TaskName
        $testRegistration.Action = $Action
        $testRegistration.Trigger = $Trigger
    }
    $testRegistration = @{}
    [Console]::OutputEncoding = [Text.Encoding]::GetEncoding(936)
    & (Join-Path $testRoot 'run.ps1') install-task -At '22:00'
    if ($testRegistration.Name -ne 'UoocDailyCheckin') { throw 'Task registration did not complete.' }
    if ($testRegistration.Trigger.At -ne '22:00' -or -not $testRegistration.Trigger.Daily) { throw 'Daily trigger does not match.' }
    if ($testRegistration.Action.Arguments -ne ('"{0}" run' -f (Join-Path $testRoot 'launch.vbs')) -or $testRegistration.Action.WorkingDirectory -ne $testRoot) { throw 'Task does not use the current project launcher.' }
    if ([Console]::OutputEncoding.CodePage -ne 65001) { throw 'Child process output must use UTF-8.' }
    Write-Output 'Passed: portable runtime, Chinese UTF-8 configuration and UTF-8 process output (mock task, no real credentials).'
} finally {
    [Console]::OutputEncoding = $originalEncoding
    # Only remove the unique test directory created above, under the system temp directory.
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTestRoot -Leaf) -like 'uooc-test-*') {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
