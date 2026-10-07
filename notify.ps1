param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
# Unicode escapes keep this script readable by Windows PowerShell without a BOM.
$title = [regex]::Unescape('Uooc \u767b\u5f55\u5df2\u5931\u6548')
$message = [regex]::Unescape('\u81ea\u52a8\u7b7e\u5230\u53d1\u73b0\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\u3002\r\n\u8bf7\u6253\u5f00 Uooc \u7b7e\u5230\u52a9\u624b\uff0c\u70b9\u51fb\u201c\u767b\u5f55 / \u6dfb\u52a0\u8bfe\u7a0b\u201d\u91cd\u65b0\u767b\u5f55\uff0c\u518d\u70b9\u51fb\u201c\u7acb\u5373\u7b7e\u5230\u201d\u3002\r\n\r\n\u73b0\u5728\u6253\u5f00\u52a9\u624b\uff1f')
if ($SelfTest) {
    if ($message.Contains('\u') -or $title.Contains('\u')) { throw 'Notification text was not decoded.' }
    Write-Output 'Login-expiry notification self-check passed.'
    exit 0
}
$hash = [System.Security.Cryptography.SHA256]::Create()
$instanceId = [BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot))).Replace('-', '')
$hash.Dispose()
$created = $false
$mutex = [System.Threading.Mutex]::new($true, ('Local\UoocCheckinNotice_' + $instanceId), [ref]$created)
try {
    if (-not $created) { exit 0 }
    $answer = [System.Windows.Forms.MessageBox]::Show($message, $title, 'YesNo', 'Warning', 'Button1', 'DefaultDesktopOnly')
    if ($answer -eq 'Yes') {
        Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"{0}"' -f (Join-Path $PSScriptRoot 'launch.vbs')) -WindowStyle Hidden
    }
} finally {
    if ($created) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
