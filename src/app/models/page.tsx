import type { Metadata } from "next";

import { ModelsView } from "@/components/models/models-view";

export const metadata: Metadata = { title: "模型管理 · 炼丹炉" };

export default function ModelsPage() {
  return <ModelsView />;
}
