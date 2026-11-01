# 炼丹炉 Alchemy

炼丹炉是一个运行在自己电脑上的 AI 实验室：和本地或云端大模型对话、把同一个问题发给多个模型对比、一键下载和管理本地模型。默认优先使用 [Ollama](https://ollama.com) 本地模型，对话内容不会离开你的电脑。

## 功能

- **概览**：Ollama 状态、本地模型数量、内存占用、云端服务配置情况，以及上手清单。
- **对话**：流式输出、Markdown 渲染、思考过程折叠显示、停止与重新生成；对话记录保存在浏览器本地。支持系统提示词、温度、思考模式。
- **模型对比**：同一个问题同时发给 2–3 个模型，显示首字延迟、生成速度（tokens/s）和总耗时，自动标出最快的。
- **模型管理**：推荐模型一键下载并显示进度，查看已安装模型的大小与量化方式，从内存卸载或从磁盘删除。
- **云端模型**：OpenAI、Anthropic、DeepSeek、通义千问、OpenRouter，以及任意 OpenAI 兼容接口。API Key 只在本机服务端使用，不会发给浏览器。
- 没有任何模型时，可以先用内置的**演示模型**体验界面。

## 在 Mac 上运行

需要 Homebrew。第一次运行：

```bash
git clone https://github.com/santu-ai/Alchemy.git
cd Alchemy
bash scripts/setup-mac.sh            # 安装工具、依赖，创建 .env.local
bash scripts/setup-mac.sh --with-models   # 同上，并下载 qwen3:8b 和 nomic-embed-text
```

之后每次使用：

```bash
open -a Ollama   # 确保 Ollama 在运行
pnpm dev         # 打开 http://localhost:43127
```

随时体检开发环境（只读，不会修改任何东西）：

```bash
pnpm doctor
```

## 接入云端模型（可选）

```bash
cp .env.example .env.local   # setup 脚本已自动创建
```

在 `.env.local` 里填写需要的 Key，例如 `DEEPSEEK_API_KEY=sk-...`，然后重启 `pnpm dev`。模型列表会自动从服务商拉取；想只显示几个模型，可以设置 `DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner` 这类变量。完整说明见 `.env.example`。

## 本地模型选择参考

| 内存 | 适合的模型 |
| --- | --- |
| 16 GB | 7B–8B，例如 `qwen3:8b` |
| 32–36 GB | 14B 流畅，30B 量化可用，例如 `qwen3:14b`、`qwen3:30b`、`gpt-oss:20b` |
| 64 GB 以上 | 可以尝试 70B 量化 |

## 技术栈

Next.js 16（App Router）、TypeScript、Tailwind CSS 4、shadcn/ui（Base UI）。服务端 Route Handler 负责代理 Ollama 和各家云端 API，并统一成同一种流式格式：

| 接口 | 说明 |
| --- | --- |
| `GET /api/status` | Ollama 连接状态、版本、已加载模型，云端服务配置情况 |
| `GET /api/models` | 所有可用模型（本地 + 已配置的云端） |
| `POST /api/chat` | 流式对话，返回 NDJSON：`delta` / `thinking` / `done` / `error` |
| `POST /api/ollama/pull` | 下载本地模型，流式返回进度 |
| `DELETE /api/ollama/models` | 删除本地模型 |
| `PATCH /api/ollama/models` | 把模型从内存卸载 |

常用命令：

```bash
pnpm dev         # 开发服务，端口 43127
pnpm lint        # ESLint
pnpm typecheck   # TypeScript 类型检查
pnpm build       # 生产构建
```
