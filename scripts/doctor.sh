#!/usr/bin/env bash
# AI 工作台体检：只读取信息，不修改任何东西。
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

section "AI 工作台项目"
if [[ -d node_modules ]]; then pass "依赖已安装"; else fail "依赖未安装，运行：pnpm install"; fi
if [[ -f .env.local ]]; then
  configured=$(grep -E '^[A-Z_]+_API_KEY=.+' .env.local | cut -d= -f1 | tr '\n' ' ')
  if [[ -n "$configured" ]]; then pass ".env.local 已配置：$configured"; else note ".env.local 里还没有填写任何 API Key（可选）"; fi
else
  note "没有 .env.local，运行：cp .env.example .env.local"
fi

printf "\n结果：\033[32m%d 项正常\033[0m，\033[33m%d 项建议\033[0m，\033[31m%d 项需要处理\033[0m\n" "$ok" "$warn" "$bad"
