import type { Metadata } from "next";

import { AgentsView } from "@/components/agents/agents-view";

export const metadata: Metadata = { title: "Agent · 炼丹炉" };

export default function AgentsPage() {
  return <AgentsView />;
}
