"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder = "输入消息，Enter 发送，Shift + Enter 换行",
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !disabled && !streaming;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <form
      className="relative rounded-2xl border bg-card shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        rows={1}
        aria-label="消息"
        className="field-sizing-content max-h-52 min-h-14 resize-none border-0 bg-transparent px-4 py-3.5 pr-14 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="absolute right-2.5 bottom-2.5">
        {streaming ? (
          <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="停止生成">
            <SquareIcon className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!canSend} aria-label="发送">
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  );
}
