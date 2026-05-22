#!/usr/bin/env sh
set -eu

APPLY=0
LABEL="${LABEL:-com.agentview.daemon}"
NODE="${NODE:-node}"
AVD_ENTRY="${AVD_ENTRY:-avd}"
PLIST_PATH="${PLIST_PATH:-$HOME/Library/LaunchAgents/$LABEL.plist}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --label) shift; LABEL="$1"; PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist" ;;
    --node) shift; NODE="$1" ;;
    --avd-entry) shift; AVD_ENTRY="$1" ;;
    --plist) shift; PLIST_PATH="$1" ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

xml_escape() {
  printf '%s' "$1" | sed "s/&/\\&amp;/g; s/</\\&lt;/g; s/>/\\&gt;/g; s/\"/\\&quot;/g; s/'/\\&apos;/g"
}

plist_content() {
  escaped_label=$(xml_escape "$LABEL")
  escaped_node=$(xml_escape "$NODE")
  escaped_avd_entry=$(xml_escape "$AVD_ENTRY")
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$escaped_label</string>
  <key>ProgramArguments</key>
  <array><string>$escaped_node</string><string>$escaped_avd_entry</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
}

if [ "$APPLY" -ne 1 ]; then
  echo "Dry-run: would write $PLIST_PATH and run launchctl bootstrap gui/\$(id -u) $PLIST_PATH"
  plist_content
  exit 0
fi

mkdir -p "$(dirname "$PLIST_PATH")"
plist_content > "$PLIST_PATH"
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
