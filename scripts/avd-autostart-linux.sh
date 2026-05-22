#!/usr/bin/env sh
set -eu

APPLY=0
UNIT_NAME="${UNIT_NAME:-agentview-daemon.service}"
NODE="${NODE:-node}"
AVD_ENTRY="${AVD_ENTRY:-avd}"
UNIT_PATH="${UNIT_PATH:-$HOME/.config/systemd/user/$UNIT_NAME}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --unit-name) shift; UNIT_NAME="$1"; UNIT_PATH="$HOME/.config/systemd/user/$UNIT_NAME" ;;
    --node) shift; NODE="$1" ;;
    --avd-entry) shift; AVD_ENTRY="$1" ;;
    --unit-path) shift; UNIT_PATH="$1" ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

systemd_quote() {
  escaped=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '"%s"' "$escaped"
}

unit_content() {
  exec_start="$(systemd_quote "$NODE") $(systemd_quote "$AVD_ENTRY")"
  cat <<EOF
[Unit]
Description=AgentView Daemon

[Service]
ExecStart=$exec_start
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
}

if [ "$APPLY" -ne 1 ]; then
  echo "Dry-run: would write $UNIT_PATH and run systemctl --user enable --now $UNIT_NAME"
  unit_content
  exit 0
fi

mkdir -p "$(dirname "$UNIT_PATH")"
unit_content > "$UNIT_PATH"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
