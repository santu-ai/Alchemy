export interface RecommendedModel {
  name: string;
  title: string;
  size: string;
  use: string;
  note: string;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: "qwen3:8b",
    title: "Qwen3 8B",
    size: "约 5 GB",
    use: "日常中文对话",
    note: "速度快，中文好，适合作为默认模型。",
  },
  {
    name: "qwen3:14b",
    title: "Qwen3 14B",
    size: "约 9 GB",
    use: "更强的中文与推理",
    note: "36 GB 内存跑起来很流畅，效果明显好于 8B。",
  },
  {
    name: "qwen3:30b",
    title: "Qwen3 30B（MoE）",
    size: "约 19 GB",
    use: "本机能跑的高质量模型",
    note: "混合专家架构，实际计算量小，速度仍然不错。",
  },
  {
    name: "gpt-oss:20b",
    title: "gpt-oss 20B",
    size: "约 14 GB",
    use: "推理与工具调用",
    note: "OpenAI 开源的推理模型，适合做 Agent 实验。",
  },
  {
    name: "gemma3:12b",
    title: "Gemma 3 12B",
    size: "约 8 GB",
    use: "多语言与看图",
    note: "Google 出品，支持图片输入。",
  },
  {
    name: "qwen2.5-coder:14b",
    title: "Qwen2.5 Coder 14B",
    size: "约 9 GB",
    use: "写代码",
    note: "专门针对编程训练，适合代码补全和解释。",
  },
  {
    name: "deepseek-r1:14b",
    title: "DeepSeek R1 14B",
    size: "约 9 GB",
    use: "深度思考",
    note: "会先输出思考过程，适合数学和逻辑题。",
  },
  {
    name: "nomic-embed-text",
    title: "Nomic Embed",
    size: "约 270 MB",
    use: "向量嵌入 / RAG",
    note: "做知识库检索时用，不能直接对话。",
  },
];
