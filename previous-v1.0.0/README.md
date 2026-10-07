# Uooc 自动签到

## v1.0.0 朋友测试版

便携测试包适用于 64 位 Windows 10/11，附带 Node.js 和 Playwright，电脑需已安装 Microsoft Edge。无需安装 Codex、Node.js 或运行 npm。

将压缩包完整解压到固定目录，双击 `launch.vbs`。先点“登录 / 添加课程”，在 Edge 中自行登录、完成验证码并逐个进入课程，保存成功后关闭配置用的 Edge 窗口。然后点击“立即签到”，成功后再按需启用每日定时。详细步骤见 `快速开始.txt`。

分发包不含任何个人登录状态、课程配置、浏览器数据或日志。首次打开不会自动启用定时任务；启用后请勿移动或删除程序目录，需要移动时先关闭定时，移动完成后重新启用。反馈问题时提供版本、Windows/Edge 版本和错误提示，勿发送登录状态文件或浏览器数据。

每天用 Edge 进入配置的课程页面，等待网站课程信息接口返回，并根据 `is_sign` 和成绩接口的 `signin_time` 核实签到。支持多门课程，登录过期和无法确认签到都会报错，日志在 `uooc.log`。

Uooc [官方帮助](https://www.uooc.net.cn/misc/support)说明：登录学习界面会自动签到，每天一次；达到老师设定的满分次数后不再增加。本脚本只进入课程首页，不操作视频、测验或讨论。

## 窗口入口

双击桌面上的 **Uooc 签到助手**，或者此目录中的 `launch.vbs`，即可打开窗口，不用输入命令。

- **立即签到**：用已保存的登录状态处理全部课程，活动区域实时显示结果。
- **登录 / 添加课程**：打开配置用 Edge，手动登录并逐个进入课程，完成后关闭配置窗口。
- **每日签到时间**：选择时间，点击“保存 / 启用定时”；要停用时点“关闭定时”。
- **签到时显示浏览器窗口**：勾选可查看实际运行页面，不勾选则后台运行。
- **移除选中课程**：只从自动签到清单移除，不会在网站退课。

课程名称会在下一次成功签到检查后自动显示。现有登录和课程配置直接沿用。定时任务也在后台运行，不弹出命令行窗口。第一次打开窗口不会自动安装定时任务。

## 第一次使用

在此目录打开 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 setup
```

1. 脚本会用普通启动方式打开一个独立的 Edge 窗口。在其中手动登录 Uooc，按网站要求完成验证码。
2. 打开个人中心，逐个点击需要签到课程的“进入学习”。脚本会自动将访问过的课程地址保存到 `config.json`，终端显示“已保存课程”。
3. 等终端显示“已验证登录，并保存可供下次运行使用的登录状态”，再关闭脚本打开的所有 Edge 窗口。课程和登录状态在同一个窗口中记录，无需先执行另一个登录命令。

登录状态显式保存在本地 `.uooc-auth.json`，后续运行通过它恢复会话 Cookie 和网页存储。`.uooc-profile` 仅用于手动配置窗口，不依赖普通浏览器和自动化浏览器之间共享加密 Cookie 数据库。

首次配置会正常进入课程，因此也可能触发当天的签到。之后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 run
```

默认在后台运行。如需查看运行页面：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 run -Visible
```

## 每日定时运行（Windows）

先完成配置并手动运行成功，再安装每天 08:00 的任务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 install-task -At 08:00
```

任务名 `UoocDailyCheckin`，使用 Windows 本地时间；北京时间运行请确认系统时区为中国。电脑需要开机且当前用户已登录。错过时间后会在可用时补跑，不能补签往日记录；未设置自动唤醒。可更新本目录创建的任务，不会覆盖属于其他目录的同名任务。

删除任务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 remove-task
```

更改时间时再次保存即可。日志使用北京时间；结果分别显示“今日签到成功”“今日已签到”或“签到次数已满”。进程退出码 `0` 表示全部课程得到确认，`1` 表示有失败。当天重复运行不会增加签到次数，最终以课程成绩页为准。

## 登录失效、增删课程

登录失效时重新运行 `setup`。旧的 `login` 命令现在是 `setup` 的别名，无需在两个窗口之间交接。

配置窗口使用普通 Edge 启动方式，调试端口仅监听本机回环地址。验证码由用户在网站上手动完成。此方法不能保证解决所有验证码失败；如果仍然失败，继续检查网络和网站提示。

重新运行 `setup` 登录并访问课程即可增加课程。删除课程时编辑 `config.json` 的 `courses` 数组，例如：

```json
{
  "courses": ["https://www.uooc.net.cn/home/course/123456"]
}
```

请使用点击“继续学习”后的地址。支持新版 `/home/learn/new/数字#...`、旧版 `/home/learn/数字#...` 和课程主页 `/home/course/数字`；兼容带 `www` 和不带 `www` 的 Uooc 域名，保留网站实际使用的 HTTP/HTTPS 协议和学习页的章节定位信息，避免切换网页存储所属的来源。首页、`/course/数字` 介绍页不能用于签到。示例 ID 需要换成自己的课程地址。

不要同时运行多个 setup 窗口，也不要在配置过程中运行定时任务。不要分享 `.uooc-profile` 或 `.uooc-auth.json`，它们包含登录凭据；它们、配置和日志均已加入 Git 忽略规则。

## 环境与验证

需要 Edge、Node.js 20+ 和 Playwright。便携测试包已附带运行环境，`run.ps1` 优先使用包内 `runtime/node.exe`。源码目录也支持系统 Node.js 和这台电脑 Codex 提供的运行时。仅复制源码到其他电脑时，安装 Node.js 后在此目录执行 `npm install`（使用已安装的 Edge，无需下载 Chromium）。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 test
```

测试检查错误地址、响应监听顺序、失败处理，以及含中文的 UTF-8 配置和定时任务脚本输出编码。定时任务测试使用模拟接口，不会创建真实任务。实际账户的签到结果需要首次登录后验证；平台更新接口或页面流程时，脚本会报错而不会自行声称成功。
