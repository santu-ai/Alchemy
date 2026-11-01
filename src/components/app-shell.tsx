"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BoxesIcon,
  ColumnsIcon,
  LayoutDashboardIcon,
  MenuIcon,
  MessageSquareIcon,
  MoonIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useHydrated } from "@/lib/client/local-store";
import { useStatus } from "@/lib/client/use-api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "概览", icon: LayoutDashboardIcon },
  { href: "/chat", label: "对话", icon: MessageSquareIcon },
  { href: "/compare", label: "模型对比", icon: ColumnsIcon },
  { href: "/models", label: "模型管理", icon: BoxesIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-sm">
        <SparklesIcon className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">AI 工作台</span>
        <span className="block text-xs text-muted-foreground">本地优先的模型实验室</span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function OllamaIndicator() {
  const { data, loading } = useStatus(15000);
  const reachable = data?.ollama.reachable;
  const label = !data && loading ? "检查中…" : reachable ? `Ollama ${data?.ollama.version}` : "Ollama 未连接";
  return (
    <Link
      href="/models"
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60"
    >
      <span
        className={cn(
          "size-2 rounded-full",
          !data ? "bg-muted-foreground/40" : reachable ? "bg-success" : "bg-destructive",
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const dark = hydrated && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dark ? "切换到浅色" : "切换到深色"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-3">
      <div className="pt-1">
        <Brand />
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
        <OllamaIndicator />
        <ThemeToggle />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = NAV.find((item) => isActive(pathname, item.href));

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:block">
        <SidebarBody />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="打开导航" />}>
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0" showCloseButton={false}>
              <SheetTitle className="sr-only">导航</SheetTitle>
              <SidebarBody onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-medium">{current?.label ?? "AI 工作台"}</span>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
