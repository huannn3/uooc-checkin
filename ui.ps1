param([switch]$SelfTest, [string]$PreviewPath, [scriptblock]$SelfTestCheck)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:Worker = $null
$script:LastLog = ''
$script:LastConfigTime = $null
$script:LastStatusTime = $null
$script:LastStatusReport = $null
$script:Root = $PSScriptRoot
$script:ConfigPath = Join-Path $PSScriptRoot 'config.json'
$script:AuthPath = Join-Path $PSScriptRoot '.uooc-auth.json'
$script:LogPath = Join-Path $PSScriptRoot 'uooc.log'
$script:TaskName = 'UoocDailyCheckin'
$script:StatusPath = Join-Path $PSScriptRoot '.uooc-status.json'
$uiMutex = $null
if (-not $SelfTest) {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $instanceId = [BitConverter]::ToString($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot))).Replace('-', '')
    $hash.Dispose()
    $created = $false
    $uiMutex = [System.Threading.Mutex]::new($true, ('Local\UoocCheckinUI_' + $instanceId), [ref]$created)
    if (-not $created) {
        [System.Windows.Forms.MessageBox]::Show('签到助手已经打开，请从任务栏切换到窗口。', 'Uooc 签到助手') | Out-Null
        $uiMutex.Dispose()
        exit 0
    }
}

function Add-Label($Parent, $Text, $X, $Y, $Width, $Height, $Size = 10, $Color = '#344054', $Bold = $false) {
    $label = [System.Windows.Forms.Label]::new()
    $label.Text = $Text
    $label.SetBounds($X, $Y, $Width, $Height)
    $style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $label.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', $Size, $style)
    $label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($Color)
    $Parent.Controls.Add($label)
    return $label
}

function Add-Button($Parent, $Text, $X, $Y, $Width, $Height, $Primary = $false) {
    $button = [System.Windows.Forms.Button]::new()
    $button.Text = $Text
    $button.SetBounds($X, $Y, $Width, $Height)
    $button.FlatStyle = 'Flat'
    $button.FlatAppearance.BorderSize = 1
    $button.FlatAppearance.BorderColor = [System.Drawing.ColorTranslator]::FromHtml('#D0D5DD')
    $button.BackColor = [System.Drawing.Color]::White
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    if ($Primary) {
        $button.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#2563EB')
        $button.ForeColor = [System.Drawing.Color]::White
        $button.FlatAppearance.BorderSize = 0
        $button.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', 12, [System.Drawing.FontStyle]::Bold)
    }
    $Parent.Controls.Add($button)
    return $button
}

$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Uooc 签到助手 v1.2.0'
$form.ClientSize = [System.Drawing.Size]::new(1000, 780)
$form.MinimumSize = [System.Drawing.Size]::new(1016, 819)
$form.StartPosition = 'CenterScreen'
$form.AutoScaleMode = 'Dpi'
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#F3F6FB')
$form.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', 10)
$form.Icon = [System.Drawing.SystemIcons]::Application
$iconPath = Join-Path $PSScriptRoot 'uooc.ico'
if (Test-Path -LiteralPath $iconPath) { $form.Icon = [System.Drawing.Icon]::new($iconPath) }

$header = [System.Windows.Forms.Panel]::new()
$header.SetBounds(0, 0, 1000, 104)
$header.Anchor = 'Top, Left, Right'
$header.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#13233F')
$form.Controls.Add($header)
$null = Add-Label $header 'Uooc 自动签到' 24 18 570 40 24 '#FFFFFF' $true
$null = Add-Label $header '保存课程，核实签到；登录失效时会提醒重新登录。' 26 66 610 26 10 '#CBD5E1'
$statusLabel = Add-Label $header '就绪' 650 42 324 32 11 '#A7F3D0' $true
$statusLabel.TextAlign = 'MiddleRight'
$statusLabel.Anchor = 'Top, Right'

$coursePanel = [System.Windows.Forms.Panel]::new()
$coursePanel.SetBounds(24, 124, 566, 364)
$coursePanel.Anchor = 'Top, Left, Right'
$coursePanel.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($coursePanel)
$null = Add-Label $coursePanel '我的签到课程' 20 16 400 28 13 '#172B4D' $true
$accountLabel = Add-Label $coursePanel '' 20 50 526 26 10 '#667085'
$accountLabel.Anchor = 'Top, Left, Right'
$courseList = [System.Windows.Forms.ListView]::new()
$courseList.SetBounds(20, 84, 526, 214)
$courseList.Anchor = 'Top, Left, Right'
$courseList.View = 'Details'
$courseList.FullRowSelect = $true
$courseList.HideSelection = $false
$courseList.MultiSelect = $false
$courseList.BorderStyle = 'FixedSingle'
$null = $courseList.Columns.Add('课程名称', 236)
$null = $courseList.Columns.Add('已签 / 满分需', 112)
$null = $courseList.Columns.Add('课程周期 ID', 150)
$courseList.ShowItemToolTips = $true
$coursePanel.Controls.Add($courseList)
$null = Add-Label $coursePanel '次数为最近结果；“待同步”表示网站尚未更新。' 20 299 526 18 9 '#667085'
$loginSettings = Add-Button $coursePanel '登录账号设置' 20 316 144 32
$removeCourse = Add-Button $coursePanel '移除选中课程' 402 316 144 32
$removeCourse.Anchor = 'Top, Right'

$actions = [System.Windows.Forms.Panel]::new()
$actions.SetBounds(608, 124, 368, 364)
$actions.Anchor = 'Top, Right'
$actions.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($actions)
$null = Add-Label $actions '签到与设置' 20 16 328 28 13 '#172B4D' $true
$runButton = Add-Button $actions '立即签到' 20 54 328 48 $true
$setupButton = Add-Button $actions '登录 / 添加课程' 20 114 328 40
$visibleCheck = [System.Windows.Forms.CheckBox]::new()
$visibleCheck.Text = '签到时显示浏览器窗口'
$visibleCheck.SetBounds(20, 164, 328, 26)
$actions.Controls.Add($visibleCheck)
$null = Add-Label $actions '每日签到时间' 20 204 140 26 10
$timePicker = [System.Windows.Forms.DateTimePicker]::new()
$timePicker.Format = 'Custom'
$timePicker.CustomFormat = 'HH:mm'
$timePicker.ShowUpDown = $true
$timePicker.Value = [DateTime]::Today.AddHours(8)
$timePicker.SetBounds(238, 201, 110, 30)
$actions.Controls.Add($timePicker)
$taskLabel = Add-Label $actions '正在读取定时状态…' 20 238 328 22 9 '#667085'
$scheduleButton = Add-Button $actions '保存 / 启用定时' 20 266 156 30
$disableButton = Add-Button $actions '关闭定时' 192 266 156 30
$startupLabel = Add-Label $actions '正在读取自启动状态…' 20 306 328 22 9 '#667085'
$startupButton = Add-Button $actions '启用开机自启动' 20 330 156 28
$stopStartupButton = Add-Button $actions '关闭自启动' 192 330 156 28

$logPanel = [System.Windows.Forms.Panel]::new()
$logPanel.SetBounds(24, 504, 952, 222)
$logPanel.Anchor = 'Top, Bottom, Left, Right'
$logPanel.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($logPanel)
$null = Add-Label $logPanel '最近活动' 20 12 400 28 13 '#172B4D' $true
$logButton = Add-Button $logPanel '打开日志' 830 10 102 30
$logButton.Anchor = 'Top, Right'
$logBox = [System.Windows.Forms.TextBox]::new()
$logBox.SetBounds(20, 48, 912, 154)
$logBox.Anchor = 'Top, Bottom, Left, Right'
$logBox.ReadOnly = $true
$logBox.Multiline = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BorderStyle = 'None'
$logBox.BackColor = [System.Drawing.Color]::White
$logBox.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#475467')
$logBox.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', 9)
$logBox.WordWrap = $true
$logPanel.Controls.Add($logBox)
$progressBar = [System.Windows.Forms.ProgressBar]::new()
$progressBar.SetBounds(20, 210, 912, 4)
$progressBar.Anchor = 'Bottom, Left, Right'
$progressBar.MarqueeAnimationSpeed = 25
$logPanel.Controls.Add($progressBar)
$footer = Add-Label $form '定时运行需要电脑开机且用户已登录。登录可能失效，出现提醒后请重新登录。' 24 744 952 26 9 '#667085'
$footer.Anchor = 'Bottom, Left, Right'

function Update-Log {
    try {
        $text = if (Test-Path -LiteralPath $script:LogPath) {
            (Get-Content -LiteralPath $script:LogPath -Encoding UTF8 -Tail 80) -join "`r`n"
        } else { '还没有活动记录。先配置课程，再点击“立即签到”。' }
        if ($text -ne $script:LastLog) {
            $script:LastLog = $text
            $logBox.Text = $text
            $logBox.SelectionStart = $logBox.TextLength
            $logBox.ScrollToCaret()
        }
    } catch { }
}

function Read-Status {
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = [System.IO.File]::Open($script:StatusPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    $reader = $null
    try {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
        return ($reader.ReadToEnd() | ConvertFrom-Json)
    } finally {
        if ($reader) { $reader.Dispose() } else { $stream.Dispose() }
    }
}

function Update-State {
    $config = if (Test-Path -LiteralPath $script:ConfigPath) {
        Get-Content -LiteralPath $script:ConfigPath -Encoding UTF8 -Raw | ConvertFrom-Json
    } else { [PSCustomObject]@{ courses = @() } }
    $report = $script:LastStatusReport
    if (Test-Path -LiteralPath $script:StatusPath) {
        try {
            # Read the timestamp first so a replacement during reading is retried on the next tick.
            $statusTime = (Get-Item -LiteralPath $script:StatusPath).LastWriteTimeUtc
            $report = Read-Status
            $script:LastStatusReport = $report
            $script:LastStatusTime = $statusTime
        } catch { }
    }
    $courseList.BeginUpdate()
    $courseList.Items.Clear()
    foreach ($url in $config.courses) {
        $id = ([Uri]$url).AbsolutePath.TrimEnd('/').Split('/')[-1]
        $name = if ($config.courseNames -and $config.courseNames.PSObject.Properties[$url]) {
            $config.courseNames.PSObject.Properties[$url].Value
        } else { "课程 $id" }
        $item = [System.Windows.Forms.ListViewItem]::new([string]$name)
        $progress = if ($report -and $report.courses -and $report.courses.PSObject.Properties[$url]) { $report.courses.PSObject.Properties[$url].Value } else { $null }
        $counts = if ($progress -and $null -ne $progress.count -and $null -ne $progress.total) {
            "$($progress.count) / $($progress.total)" + $(if ($progress.countPending) { ' 待同步' } elseif ($progress.status -eq 'failed' -or $report.loginExpired) { ' 旧' } else { '' })
        } elseif ($progress) { '暂不可用' } else { '待查询' }
        $null = $item.SubItems.Add($counts)
        $null = $item.SubItems.Add($id)
        if ($progress) {
            $checked = try { ([DateTimeOffset]::Parse($progress.checkedAt)).ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss') } catch { '未知' }
            $item.ToolTipText = "最近查询（北京时间）：$checked`r`n$($progress.countError)"
        }
        $item.Tag = $url
        $null = $courseList.Items.Add($item)
    }
    $courseList.EndUpdate()
    $ready = (Test-Path -LiteralPath $script:AuthPath) -and $courseList.Items.Count -gt 0
    $accountLabel.Text = if ($ready) { "已保存登录状态 · 共 $($courseList.Items.Count) 门课程" } else { '请先登录并添加需要签到的课程' }
    $accountLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#667085')
    $statusLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#A7F3D0')
    $busy = $null -ne $script:Worker
    if ($report -and $report.loginExpired) {
        $accountLabel.Text = '登录已失效 · 请点击“登录 / 添加课程”'
        $accountLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#B42318')
        $statusLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#FDA29B')
        if (-not $busy) { $statusLabel.Text = '登录已失效，请重新登录' }
    }
    $runButton.Enabled = $ready -and -not $busy
    $setupButton.Enabled = -not $busy
    $loginSettings.Enabled = -not $busy
    $scheduleButton.Enabled = $ready -and -not $busy
    $removeCourse.Enabled = -not $busy -and $courseList.SelectedItems.Count -gt 0
    $visibleCheck.Enabled = -not $busy
    $timePicker.Enabled = -not $busy
    try {
        $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
        $ownedArguments = @(('"{0}" run' -f (Join-Path $script:Root 'uooc.js')), ('"{0}" run' -f (Join-Path $script:Root 'launch.vbs')))
        $ownedTask = $task -and @($task.Actions | Where-Object { $_.Arguments -in $ownedArguments }).Count -gt 0
        if ($task -and -not $ownedTask) {
            $taskLabel.Text = '另一个目录已设置定时，请在原目录管理'
        } elseif ($ownedTask) {
            $boundary = $task.Triggers[0].StartBoundary
            $clock = if ($boundary) { ([DateTime]::Parse($boundary)).ToString('HH:mm') } else { '已设置' }
            $taskLabel.Text = if ($task.State -eq 'Disabled') { "每日定时已暂停 · $clock" } else { "已启用每日定时 · $clock" }
            if ($boundary -and -not $busy) { $timePicker.Value = [DateTime]::Parse($boundary) }
        } else { $taskLabel.Text = '未启用每日定时' }
        $disableButton.Enabled = $ownedTask -and -not $busy
    } catch {
        $taskLabel.Text = '暂时无法读取定时任务状态'
        $disableButton.Enabled = -not $busy
    }
    try {
        $startup = Get-ScheduledTask -TaskName 'UoocCheckinStartup' -ErrorAction SilentlyContinue
        $startupArgument = '"{0}"' -f (Join-Path $script:Root 'launch.vbs')
        $ownedStartup = $startup -and @($startup.Actions | Where-Object { $_.Arguments -eq $startupArgument }).Count -gt 0
        $startupLabel.Text = if ($ownedStartup -and $startup.State -eq 'Disabled') { '开机自启动已暂停' } elseif ($ownedStartup) { '已启用 · 登录 Windows 后打开助手' } elseif ($startup) { '另一个目录已设置自启动' } else { '未启用开机自启动' }
        $startupButton.Enabled = -not $busy -and (-not $startup -or ($ownedStartup -and $startup.State -eq 'Disabled'))
        $stopStartupButton.Enabled = -not $busy -and $ownedStartup
    } catch {
        $startupLabel.Text = '暂时无法读取自启动状态'
        $startupButton.Enabled = -not $busy
        $stopStartupButton.Enabled = $false
    }
    if (Test-Path -LiteralPath $script:ConfigPath) { $script:LastConfigTime = (Get-Item -LiteralPath $script:ConfigPath).LastWriteTimeUtc }
}

function Start-Action([string]$Mode) {
    if ($script:Worker) { return }
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" {1}' -f (Join-Path $script:Root 'run.ps1'), $Mode
    if ($Mode -eq 'run' -and $visibleCheck.Checked) { $info.Arguments += ' -Visible' }
    if ($Mode -eq 'install-task') { $info.Arguments += ' -At ' + $timePicker.Value.ToString('HH:mm') }
    $info.WorkingDirectory = $script:Root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    $null = $process.Start()
    $script:Worker = @{ Process = $process; Mode = $Mode; Out = $process.StandardOutput.ReadToEndAsync(); Err = $process.StandardError.ReadToEndAsync() }
    $statusLabel.Text = switch ($Mode) {
        'run' { '正在核实签到，请稍候…' }
        'setup' { '请在 Edge 中登录并进入课程' }
        'install-task' { '正在保存每日定时…' }
        'remove-task' { '正在关闭每日定时…' }
        'install-startup' { '正在启用开机自启动…' }
        'remove-startup' { '正在关闭开机自启动…' }
    }
    $progressBar.Style = 'Marquee'
    Update-State
}

$runButton.Add_Click({ try { Start-Action 'run' } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '无法启动') } })
$setupButton.Add_Click({ try { Start-Action 'setup' } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '无法启动') } })
$loginSettings.Add_Click({
    if ($script:Worker) { return }
    try { & (Join-Path $script:Root 'credentials.ps1') -Mode configure }
    catch { [System.Windows.Forms.MessageBox]::Show('账号设置窗口无法启动，请检查程序文件是否完整。', '无法启动') | Out-Null }
})
$scheduleButton.Add_Click({ try { Start-Action 'install-task' } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '设置失败') } })
$disableButton.Add_Click({ try { Start-Action 'remove-task' } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '设置失败') } })
$startupButton.Add_Click({ try { Start-Action 'install-startup' } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '设置失败') } })
$stopStartupButton.Add_Click({ try { Start-Action 'remove-startup' } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '设置失败') } })
$logButton.Add_Click({
    if (Test-Path -LiteralPath $script:LogPath) { Start-Process -FilePath notepad.exe -ArgumentList ('"{0}"' -f $script:LogPath) -WindowStyle Normal }
})
$courseList.Add_SelectedIndexChanged({ $removeCourse.Enabled = $null -eq $script:Worker -and $courseList.SelectedItems.Count -gt 0 })
$removeCourse.Add_Click({
    if ($script:Worker -or -not $courseList.SelectedItems.Count) { return }
    $answer = [System.Windows.Forms.MessageBox]::Show('从自动签到清单移除此课程？这不会在 Uooc 网站退课。', '移除课程', 'YesNo', 'Question')
    if ($answer -ne 'Yes') { return }
    $selected = $courseList.SelectedItems[0].Tag
    $config = Get-Content -LiteralPath $script:ConfigPath -Encoding UTF8 -Raw | ConvertFrom-Json
    $config.courses = @($config.courses | Where-Object { $_ -ne $selected })
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    Update-State
})

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 500
$timer.Add_Tick({
    Update-Log
    if ((Test-Path -LiteralPath $script:ConfigPath) -and (Get-Item -LiteralPath $script:ConfigPath).LastWriteTimeUtc -ne $script:LastConfigTime) { Update-State }
    if ((Test-Path -LiteralPath $script:StatusPath) -and (Get-Item -LiteralPath $script:StatusPath).LastWriteTimeUtc -ne $script:LastStatusTime) { Update-State }
    if ($script:Worker -and $script:Worker.Process.HasExited) {
        $worker = $script:Worker
        $worker.Process.WaitForExit()
        $errorText = $worker.Err.GetAwaiter().GetResult()
        $null = $worker.Out.GetAwaiter().GetResult()
        $exitCode = $worker.Process.ExitCode
        $worker.Process.Dispose()
        $script:Worker = $null
        $progressBar.Style = 'Blocks'
        $progressBar.Value = if ($exitCode -eq 0) { 100 } else { 0 }
        $statusLabel.Text = if ($exitCode -eq 2) { '登录已失效，请重新登录' } elseif ($exitCode -ne 0) { '未完成，请查看活动记录' } else {
            switch ($worker.Mode) {
                'run' { '签到完成，全部课程已核实' }
                'setup' { '课程和登录状态已保存' }
                'install-task' { '每日定时已保存' }
                'remove-task' { '每日定时已关闭' }
                'install-startup' { '开机自启动已启用' }
                'remove-startup' { '开机自启动已关闭' }
            }
        }
        if ($exitCode -eq 2) {
            [System.Windows.Forms.MessageBox]::Show('登录已失效。请点击“登录 / 添加课程”重新登录，然后再点击“立即签到”。', '需要重新登录', 'OK', 'Warning') | Out-Null
        } elseif ($exitCode -ne 0 -and $errorText.Trim()) {
            [System.Windows.Forms.MessageBox]::Show($errorText.Substring(0, [Math]::Min(700, $errorText.Length)), '操作未完成') | Out-Null
        }
        Update-State
        Update-Log
    }
})
$form.Add_FormClosing({
    if ($script:Worker) {
        $_.Cancel = $true
        [System.Windows.Forms.MessageBox]::Show('任务仍在运行。配置时请先关闭配置用的 Edge 窗口；签到时请等待运行结束。', '任务运行中') | Out-Null
    }
})
$form.Add_Shown({
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
})

try {
    Update-State
    Update-Log
    if ($SelfTest) {
        $config = if (Test-Path -LiteralPath $script:ConfigPath) {
            Get-Content -LiteralPath $script:ConfigPath -Encoding UTF8 -Raw | ConvertFrom-Json
        } else { [PSCustomObject]@{ courses = @() } }
        if ($courseList.Items.Count -ne @($config.courses).Count) { throw 'Course list did not load saved configuration.' }
        if ($runButton.Enabled -ne ((Test-Path -LiteralPath $script:AuthPath) -and $courseList.Items.Count -gt 0)) { throw 'Run button readiness does not match saved state.' }
        if (-not $runButton.Enabled -and ($scheduleButton.Enabled -or -not $setupButton.Enabled)) { throw 'First launch must allow setup and keep scheduling disabled until configured.' }
        if ($logBox.Text.Length -eq 0) { throw 'Activity panel is empty.' }
        if ($SelfTestCheck) { & $SelfTestCheck }
        if ($PreviewPath) {
            $form.Show()
            [System.Windows.Forms.Application]::DoEvents()
            $preview = [System.Drawing.Bitmap]::new($form.Width, $form.Height)
            $form.DrawToBitmap($preview, [System.Drawing.Rectangle]::new(0, 0, $form.Width, $form.Height))
            $preview.Save($PreviewPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $preview.Dispose()
        }
        Write-Output 'UI self-check passed: saved courses, action readiness, and activity log.'
    } else {
        $timer.Start()
        [System.Windows.Forms.Application]::Run($form)
    }
} catch {
    if ($SelfTest) { throw }
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '签到助手启动失败') | Out-Null
} finally {
    $timer.Stop()
    $timer.Dispose()
    $form.Dispose()
    if ($uiMutex) { $uiMutex.ReleaseMutex(); $uiMutex.Dispose() }
}
