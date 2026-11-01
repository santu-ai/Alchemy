export interface RecommendedModel {
  name: string;
  title: string;
  size: string;
  use: string;
  note: string;
}

/** 按 36 GB 统一内存、Ollama 默认 32k 上下文来排。混合专家优先。 */
export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: "gpt-oss:20b",
    title: "gpt-oss 20B",
    size: "约 14 GB",
    use: "默认模型",
    note: "混合专家，速度快。思考可调 low / medium / high，适合工具调用。120B 约 59 GB，这台机器放不下。",
  },
  {
    name: "gemma4:26b",
    title: "Gemma 4 26B",
    size: "约 16–19 GB",
    use: "更强的推理与看图",
    note: "混合专家，支持图片和系统提示词。权重已经不小，上下文保持 32k 更稳。",
  },
  {
    name: "gemma4:12b",
    title: "Gemma 4 12B",
    size: "约 8 GB",
    use: "轻量多模态",
    note: "文本和图片。标称窗口 256k，Ollama 在 36 GB 上默认仍是 32k。",
  },
  {
    name: "qwen3.5:4b",
    title: "Qwen3.5 4B",
    size: "约 3–4 GB",
    use: "小而能看图",
    note: "多模态小模型，用来试图片和低占用对话。",
  },
  {
    name: "qwen3:8b",
    title: "Qwen3 8B",
    size: "约 5 GB",
    use: "低内存备选",
    note: "16 GB 机器更合适。这台 36 GB 机器上优先用上面的混合专家。",
  },
  {
    name: "nomic-embed-text",
    title: "Nomic Embed",
    size: "约 270 MB",
    use: "向量嵌入",
    note: "做检索时用，不能直接对话。",
  },
];
