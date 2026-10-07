param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
if (-not $SelfTest) { Add-Type -AssemblyName System.Windows.Forms }
$mutexes = @()
try {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $instanceId = [BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot))).Replace('-', '')
    $hash.Dispose()
    foreach ($kind in @('UI', 'Work')) {
        $mutex = [System.Threading.Mutex]::new($false, ('Local\UoocCheckin' + $kind + '_' + $instanceId))
        $acquired = $false
        try { $acquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { $mutex.Dispose(); throw 'Close the Uooc assistant and wait for login/check-in to finish before rolling back.' }
        $mutexes += $mutex
    }
    $previous = Join-Path $PSScriptRoot 'previous-v1.0.0'
    $files = @('uooc.js', 'ui.ps1', 'launch.vbs', 'run.ps1', 'test.js', 'test-run.ps1', 'README.md', 'package.json', 'package-lock.json', 'uooc.ico')
    $quickStart = -join ([char[]]@(0x5FEB, 0x901F, 0x5F00, 0x59CB))
    $files += $quickStart + '.txt'
    foreach ($file in $files) {
        if (-not (Test-Path -LiteralPath (Join-Path $previous $file))) { throw "Missing v1.0.0 backup file: $file" }
    }
    $startup = Get-ScheduledTask -TaskName 'UoocCheckinStartup' -ErrorAction SilentlyContinue
    $owned = '"{0}"' -f (Join-Path $PSScriptRoot 'launch.vbs')
    if ($startup -and @($startup.Actions | Where-Object { $_.Arguments -eq $owned }).Count -gt 0) {
        Unregister-ScheduledTask -TaskName 'UoocCheckinStartup' -Confirm:$false
    }
    # Preserve the current program too, so rolling back does not discard the update.
    $saved = Join-Path $PSScriptRoot ('backups\before-rollback-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss'))
    $null = New-Item -ItemType Directory -Path $saved -Force
    foreach ($file in $files) {
        if (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file)) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $saved }
    }
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $previous $file) -Destination $PSScriptRoot -Force }
    if ($SelfTest) { Write-Output 'Rollback completed; current personal data and daily task preserved.' } else {
        $text = [regex]::Unescape('\u5df2\u6062\u590d v1.0.0\u3002\r\n\u5f53\u524d\u8bfe\u7a0b\u3001\u767b\u5f55\u6570\u636e\u548c\u6bcf\u65e5\u5b9a\u65f6\u5747\u4fdd\u7559\uff0c\u65b0\u589e\u7684\u5f00\u673a\u81ea\u542f\u52a8\u5df2\u5173\u95ed\u3002\r\n\u8bf7\u91cd\u65b0\u6253\u5f00\u7b7e\u5230\u52a9\u624b\u3002')
        [System.Windows.Forms.MessageBox]::Show($text, 'Uooc v1.0.0', 'OK', 'Information') | Out-Null
    }
} catch {
    if ($SelfTest) { throw }
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Uooc rollback failed', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    foreach ($mutex in $mutexes) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
