"use client";

import { GitCompareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AGENT_LABELS, STATUS_LABELS, type FileChange, type IdeInfo } from "@/lib/agents/types";
import { ChangeStat, elapsed, type RunView } from "./run-panel";

function totals(changes: FileChange[]) {
  return changes.reduce(
    (sum, change) => ({ added: sum.added + (change.added ?? 0), removed: sum.removed + (change.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
}

/** 两边都跑完后，按文件对照：谁改了哪些，两边都改的可以在 IDE 里直接比。 */
export function ComparePanel({
  left,
  right,
  ide,
  onDiff,
}: {
  left: RunView;
  right: RunView;
  ide?: IdeInfo;
  onDiff: (file: string) => void;
}) {
  const leftChanges = new Map((left.changes ?? []).map((change) => [change.path, change]));
  const rightChanges = new Map((right.changes ?? []).map((change) => [change.path, change]));
  const files = [...new Set([...leftChanges.keys(), ...rightChanges.keys()])].sort((a, b) => {
    const shared = Number(rightChanges.has(b) && leftChanges.has(b)) - Number(rightChanges.has(a) && leftChanges.has(a));
    return shared || a.localeCompare(b);
  });
  const shared = files.filter((file) => leftChanges.has(file) && rightChanges.has(file)).length;

  const summary = (view: RunView) => {
    const sum = totals(view.changes ?? []);
    return (
      <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-sm font-medium">{AGENT_LABELS[view.run.agent]}</span>
        <span className="text-xs text-muted-foreground">
          {STATUS_LABELS[view.run.status]} · {elapsed(view.run)} · {view.changes?.length ?? 0} 个文件 ·{" "}
          <span className="text-success">+{sum.added}</span> <span className="text-destructive">−{sum.removed}</span>
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">对照</h3>
        <span className="text-xs text-muted-foreground">
          共 {files.length} 个文件，两边都改了 {shared} 个
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {summary(left)}
        {summary(right)}
      </div>
      {files.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">文件</th>
                <th className="w-24 py-1.5 pr-3 font-normal">{AGENT_LABELS[left.run.agent]}</th>
                <th className="w-24 py-1.5 pr-3 font-normal">{AGENT_LABELS[right.run.agent]}</th>
                <th className="w-20 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {files.map((file) => {
                const a = leftChanges.get(file);
                const b = rightChanges.get(file);
                const comparable = Boolean(a && b && !a.deleted && !b.deleted);
                return (
                  <tr key={file}>
                    <td className="truncate py-1.5 pr-3 font-mono text-xs" title={file}>
                      {file}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      <ChangeStat change={a} />
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      <ChangeStat change={b} />
                    </td>
                    <td className="py-1.5 text-right">
                      {comparable && (
                        <Button variant="ghost" size="xs" disabled={!ide} onClick={() => onDiff(file)}>
                          <GitCompareIcon />
                          对比
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
