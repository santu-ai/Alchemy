import type { Metadata } from "next";

import { ModelsView } from "@/components/models/models-view";

export const metadata: Metadata = { title: "模型管理 · AI 工作台" };

export default function ModelsPage() {
  return <ModelsView />;
}
