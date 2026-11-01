import type { Metadata } from "next";

import { CompareView } from "@/components/compare/compare-view";

export const metadata: Metadata = { title: "模型对比 · 炼丹炉" };

export default function ComparePage() {
  return <CompareView />;
}
