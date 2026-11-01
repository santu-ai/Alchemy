#!/usr/bin/env bash
# 在 Mac 上一键准备炼丹炉（Alchemy）。可以重复运行，已装好的会跳过。
# 用法：bash scripts/setup-mac.sh [--with-models]
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf "\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n" "$1"; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "这个脚本只用于 macOS。"
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "没有找到 Homebrew，请先安装：https://brew.sh"
  exit 1
fi

step "安装命令行工具和 OrbStack（Brewfile）"
missing=()
for tool in gh uv fnm pnpm jq rg; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
[[ -d /Applications/OrbStack.app ]] || missing+=("OrbStack")

if (( ${#missing[@]} == 0 )); then
  echo "都已安装，跳过。"
else
  echo "需要安装：${missing[*]}"
  # --no-upgrade：只补装缺少的，不升级已装好的软件（升级 cask 可能卡在密码或大文件下载上）
  if ! HOMEBREW_NO_AUTO_UPDATE=1 brew bundle --file=Brewfile --no-upgrade; then
    echo "部分软件没装上，可以稍后运行 brew bundle --file=Brewfile --verbose 查看原因。继续后面的步骤…"
  fi
fi

if ! command -v ollama >/dev/null 2>&1; then
  step "安装 Ollama"
  brew install --cask ollama-app 2>/dev/null || brew install --cask ollama
fi

step "准备 Python 3.12"
uv python install 3.12

if ! command -v node >/dev/null 2>&1; then
  step "安装 Node.js LTS"
  eval "$(fnm env --shell bash)"
  fnm install --lts
  fnm default lts-latest
  if ! grep -q "fnm env" "$HOME/.zshrc" 2>/dev/null; then
    echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> "$HOME/.zshrc"
  fi
fi

step "安装项目依赖"
pnpm install

if [[ ! -f .env.local ]]; then
  step "创建 .env.local"
  cp .env.example .env.local
  echo "已创建 .env.local，需要云端模型时在里面填写 API Key。"
fi

if [[ "${1:-}" == "--with-models" ]]; then
  step "启动 Ollama 并下载入门模型"
  open -a Ollama || true
  for _ in $(seq 1 30); do
    curl -fsS --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
  ollama pull qwen3:8b
  ollama pull nomic-embed-text
fi

step "体检"
bash scripts/doctor.sh

printf "\n完成。运行 \033[1mpnpm dev\033[0m，然后打开 http://localhost:43127\n"
