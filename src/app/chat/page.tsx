import type { Metadata } from "next";

import { ChatView } from "@/components/chat/chat-view";

export const metadata: Metadata = { title: "对话 · 炼丹炉" };

export default function ChatPage() {
  return <ChatView />;
}
