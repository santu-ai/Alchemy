#!/usr/bin/env bash
# 让炼丹炉用 launchd 常驻：登录后自动启动、崩溃自动拉起，仍然只监听 127.0.0.1。
# 用法：scripts/service.sh install | uninstall | restart | status | logs | plist
set -euo pipefail
cd "$(dirname "$0")/.."

label="com.alchemy.server"
dir="$(pwd)"
plist="$HOME/Library/LaunchAgents/$label.plist"
home="${ALCHEMY_HOME:-$HOME/.alchemy}"
logs="$home/logs"
domain="gui/$(id -u)"
port=43127

[[ "$(uname)" == "Darwin" ]] || { echo "只支持 macOS"; exit 1; }

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

render() {
  local pnpm
  pnpm="$(command -v pnpm)" || { echo "找不到 pnpm" >&2; exit 1; }
  # launchd 不读 shell 配置，把现在的 PATH 带过去，git、node、cursor-agent、junie 才找得到。
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>WorkingDirectory</key><string>$(xml "$dir")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$pnpm")</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$PATH")</string>
    <key>NODE_ENV</key><string>production</string>
    <key>ALCHEMY_SERVICE</key><string>launchd</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$logs/server.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$logs/server.err.log")</string>
</dict>
</plist>
EOF
}

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1; }

port_busy() { lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; }

case "${1:-}" in
  plist)
    render
    ;;
  install)
    if loaded; then echo "已经在常驻了；改了代码用 restart"; exit 0; fi
    if port_busy; then echo "端口 $port 已被占用（多半是 pnpm dev），先停掉它再安装"; exit 1; fi
    echo "构建生产版本…"
    pnpm build
    mkdir -p "$logs" "$(dirname "$plist")"
    render >"$plist"
    plutil -lint "$plist" >/dev/null
    launchctl bootstrap "$domain" "$plist"
    echo "已常驻：http://127.0.0.1:$port  日志在 $logs"
    ;;
  uninstall)
    loaded && launchctl bootout "$domain/$label" || true
    rm -f "$plist"
    echo "已移除常驻服务（任务记录和工作树都还在 $home）"
    ;;
  restart)
    loaded || { echo "还没安装，先运行 install"; exit 1; }
    pnpm build
    launchctl kickstart -k "$domain/$label"
    echo "已用新构建重启"
    ;;
  status)
    if loaded; then
      launchctl print "$domain/$label" | grep -E '^\s*(state|pid|last exit code) ' || true
    else
      echo "没有常驻"
    fi
    ;;
  logs)
    tail -n 50 -f "$logs/server.out.log" "$logs/server.err.log"
    ;;
  *)
    echo "用法：$0 install | uninstall | restart | status | logs | plist"
    exit 1
    ;;
esac
