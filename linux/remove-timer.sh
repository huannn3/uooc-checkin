#!/usr/bin/env bash
set -euo pipefail
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
systemctl --user disable --now uooc-checkin.timer 2>/dev/null || true
rm -f "$UNIT_DIR/uooc-checkin.timer" "$UNIT_DIR/uooc-checkin.service"
systemctl --user daemon-reload
systemctl --user reset-failed uooc-checkin.service 2>/dev/null || true
echo '已移除 Uooc 签到定时任务；项目目录、课程配置和登录状态均未删除。'
