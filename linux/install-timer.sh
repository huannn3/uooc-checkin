#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TIME="${1:-08:00}"
if [[ ! "$TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "用法：$0 HH:MM（24 小时制，例如 08:00）" >&2
  exit 2
fi
if [[ ! -f "$ROOT/uooc.js" || ! -f "$ROOT/package.json" ]]; then
  echo "未找到项目文件，请在项目目录内运行此脚本。" >&2
  exit 2
fi
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "未找到 node，请先安装 Node.js 20 或更新版本。" >&2
  exit 2
fi
if [[ ! -d "$ROOT/node_modules/playwright" ]]; then
  echo "未找到 Playwright 依赖，请先在项目目录运行 npm install。" >&2
  exit 2
fi

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
# systemd parses quoted arguments itself; escape backslashes and double quotes.
escape_unit_arg() { local v="$1"; v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; printf '%s' "$v"; }
NODE_ESC="$(escape_unit_arg "$NODE")"
ROOT_ESC="$(escape_unit_arg "$ROOT")"
cat > "$UNIT_DIR/uooc-checkin.service" <<UNIT
[Unit]
Description=Uooc course check-in

[Service]
Type=oneshot
UMask=0077
WorkingDirectory=$ROOT_ESC
ExecStart="$NODE_ESC" "$ROOT_ESC/uooc.js" run
UNIT
cat > "$UNIT_DIR/uooc-checkin.timer" <<UNIT
[Unit]
Description=Daily Uooc course check-in

[Timer]
OnCalendar=*-*-* ${TIME}:00
Persistent=true
Unit=uooc-checkin.service

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now uooc-checkin.timer
printf '已启用每日 %s 定时签到（使用系统时区）。\n' "$TIME"
printf '查看状态：systemctl --user status uooc-checkin.timer\n'
printf '查看日志：journalctl --user -u uooc-checkin.service -n 100 --no-pager\n'
printf '立即运行：systemctl --user start uooc-checkin.service\n'
