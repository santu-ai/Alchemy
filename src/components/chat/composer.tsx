"use client";

import { ArrowUpIcon, FileTextIcon, ImageIcon, SquareIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatAttachment } from "@/lib/types";

export interface ComposerPayload {
  images: string[];
  attachments: ChatAttachment[];
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 100_000;

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder = "输入消息，Enter 发送，Shift + Enter 换行",
}: {
  onSend: (text: string, extras?: ComposerPayload) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = (text.trim().length > 0 || images.length > 0 || attachments.length > 0) && !disabled && !streaming;

  const submit = () => {
    if (!canSend) return;
    const content = text.trim() || (images.length ? "请描述这张图片。" : "请根据附件回答。");
    onSend(content, { images, attachments });
    setText("");
    setImages([]);
    setAttachments([]);
  };

  const addImages = async (list: FileList | null) => {
    if (!list) return;
    const next = [...images];
    for (const file of list) {
      if (next.length >= 4) {
        toast.error("一次最多 4 张图片");
        break;
      }
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} 超过 4 MB`);
        continue;
      }
      next.push(await readFile(file));
    }
    setImages(next);
  };

  const addText = async (list: FileList | null) => {
    if (!list) return;
    const next = [...attachments];
    for (const file of list) {
      if (next.length >= 4) {
        toast.error("一次最多 4 个文本附件");
        break;
      }
      if (file.size > MAX_TEXT_BYTES) {
        toast.error(`${file.name} 超过 100 KB`);
        continue;
      }
      next.push({ name: file.name, content: (await file.text()).slice(0, MAX_TEXT_BYTES) });
    }
    setAttachments(next);
  };

  return (
    <form
      className="relative rounded-2xl border bg-card shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {images.length || attachments.length ? (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {images.map((src, index) => (
            <span key={src.slice(0, 48) + index} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-16 rounded-lg object-cover" />
              <button
                type="button"
                aria-label="移除图片"
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
                onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          {attachments.map((file) => (
            <span key={file.name} className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs">
              <FileTextIcon className="size-3.5" />
              <span className="max-w-40 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`移除 ${file.name}`}
                onClick={() => setAttachments((prev) => prev.filter((item) => item.name !== file.name))}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
        className="field-sizing-content max-h-52 min-h-14 resize-none border-0 bg-transparent px-4 py-3.5 pr-14 pb-12 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="absolute bottom-2.5 left-2.5 flex gap-1">
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void addImages(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.py,.html,.css"
          multiple
          className="hidden"
          onChange={(event) => {
            void addText(event.target.files);
            event.target.value = "";
          }}
        />
        <Button type="button" size="icon-sm" variant="ghost" aria-label="添加图片" onClick={() => imageRef.current?.click()}>
          <ImageIcon />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="添加文本附件" onClick={() => fileRef.current?.click()}>
          <FileTextIcon />
        </Button>
      </div>
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
