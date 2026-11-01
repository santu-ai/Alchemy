#!/usr/bin/env bash
# 炼丹炉（Alchemy）体检：只读取信息，不修改任何东西。
set -uo pipefail
cd "$(dirname "$0")/.."

ok=0
warn=0
bad=0
pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; ok=$((ok + 1)); }
note() { printf "  \033[33m!\033[0m %s\n" "$1"; warn=$((warn + 1)); }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; bad=$((bad + 1)); }
section() { printf "\n\033[1m%s\033[0m\n" "$1"; }
version() { "$1" --version 2>&1 | head -n 1; }

section "电脑"
if [[ "$(uname)" == "Darwin" ]]; then
  chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
  mem=$(( $(sysctl -n hw.memsize) / 1073741824 ))
  pass "macOS $(sw_vers -productVersion) · ${chip} · ${mem} GB 内存"
else
  mem=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo)
  pass "$(uname -s) $(uname -m) · ${mem} GB 内存"
fi
free_gb=$(df -Pk . | awk 'NR==2 {printf "%d", $4/1048576}')
if (( free_gb >= 50 )); then pass "磁盘剩余 ${free_gb} GB"; else note "磁盘剩余 ${free_gb} GB，本地模型建议预留 50 GB 以上"; fi

section "开发工具"
for tool in brew git node pnpm uv gh; do
  if command -v "$tool" >/dev/null 2>&1; then pass "$tool  $(version "$tool")"; else fail "$tool 未安装"; fi
done
if command -v uv >/dev/null 2>&1 && uv python find 3.12 >/dev/null 2>&1; then
  pass "Python 3.12（由 uv 管理）"
else
  fail "缺少 Python 3.12，运行：uv python install 3.12"
fi

section "Git 与 GitHub"
name=$(git config --global user.name 2>/dev/null || true)
email=$(git config --global user.email 2>/dev/null || true)
if [[ -n "$name" && -n "$email" ]]; then pass "Git 身份：$name <$email>"; else fail "Git 身份未设置：git config --global user.name / user.email"; fi
if compgen -G "$HOME/.ssh/*.pub" >/dev/null; then pass "已有 SSH 公钥"; else note "没有 SSH 公钥，可用 gh auth login 自动生成"; fi
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then pass "GitHub 已登录"; else note "GitHub 未登录，运行：gh auth login"; fi

section "容器"
if ! command -v docker >/dev/null 2>&1; then
  note "没有 docker 命令（打开一次 OrbStack 即可）"
elif docker info >/dev/null 2>&1; then
  pass "Docker 正在运行  $(docker --version)"
else
  note "Docker 已安装但未运行，运行：open -a OrbStack"
fi

section "本地模型（Ollama）"
host="${OLLAMA_HOST:-http://127.0.0.1:11434}"
[[ "$host" == http* ]] || host="http://$host"
if ! command -v ollama >/dev/null 2>&1; then
  fail "Ollama 未安装"
elif ver=$(curl -fsS --max-time 3 "$host/api/version" 2>/dev/null); then
  pass "Ollama 运行中 $(echo "$ver" | sed -E 's/.*"version":"([^"]+)".*/\1/')"
  count=$(curl -fsS --max-time 3 "$host/api/tags" | grep -o '"name":' | wc -l | tr -d ' ')
  if (( count > 0 )); then pass "已下载 ${count} 个模型"; else note "还没有本地模型，推荐：ollama pull qwen3:8b"; fi
else
  note "Ollama 已安装但未运行，运行：open -a Ollama"
fi

section "Agent 与 IDE"
cursor_bin="${CURSOR_AGENT_BIN:-$(command -v cursor-agent 2>/dev/null || true)}"
cursor_fallback="$HOME/Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent"
[[ -z "$cursor_bin" && -x "$cursor_fallback" ]] && cursor_bin="$cursor_fallback"
if [[ -z "$cursor_bin" ]]; then
  note "没有 cursor-agent（可选），安装：curl https://cursor.com/install -fsS | bash"
elif "$cursor_bin" status 2>&1 | grep -qi "not logged in"; then
  note "Cursor CLI 未登录，运行：cursor-agent login"
else
  pass "Cursor CLI  $("$cursor_bin" --version 2>/dev/null | tail -n 1)"
fi
junie_bin="${JUNIE_BIN:-$(command -v junie 2>/dev/null || true)}"
[[ -z "$junie_bin" && -x "$HOME/.local/bin/junie" ]] && junie_bin="$HOME/.local/bin/junie"
if [[ -n "$junie_bin" ]]; then
  pass "Junie CLI  $("$junie_bin" --version 2>/dev/null | tail -n 1 | sed -E 's/^Junie version:[[:space:]]*//')"
else
  note "没有 junie（可选），见 https://junie.jetbrains.com"
fi
ides=()
for ide in webstorm idea pycharm; do
  if [[ -x "$HOME/Library/Application Support/JetBrains/Toolbox/scripts/$ide" ]] || command -v "$ide" >/dev/null 2>&1; then ides+=("$ide"); fi
done
if (( ${#ides[@]} > 0 )); then pass "JetBrains IDE：${ides[*]}"; else note "没找到 JetBrains IDE 启动脚本（Toolbox → 设置 → 生成 Shell 脚本）"; fi
plist="$HOME/Library/LaunchAgents/com.alchemy.server.plist"
if [[ -f "$plist" ]]; then
  if launchctl print "gui/$(id -u)/com.alchemy.server" >/dev/null 2>&1; then pass "炼丹炉常驻服务已加载"; else note "常驻服务已安装但没在运行，运行：pnpm service:install"; fi
else
  note "炼丹炉没有常驻，关掉终端后 Agent 的检查和通知会停。需要时运行：pnpm service:install"
fi

section "炼丹炉项目"
if [[ -d node_modules ]]; then pass "依赖已安装"; else fail "依赖未安装，运行：pnpm install"; fi
if [[ -f .env.local ]]; then
  configured=$(grep -E '^[A-Z_]+_API_KEY=.+' .env.local | cut -d= -f1 | tr '\n' ' ')
  if [[ -n "$configured" ]]; then pass ".env.local 已配置：$configured"; else note ".env.local 里还没有填写任何 API Key（可选）"; fi
else
  note "没有 .env.local，运行：cp .env.example .env.local"
fi

printf "\n结果：\033[32m%d 项正常\033[0m，\033[33m%d 项建议\033[0m，\033[31m%d 项需要处理\033[0m\n" "$ok" "$warn" "$bad"
