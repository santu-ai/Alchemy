import "server-only";

import path from "node:path";

import type { FileChange, RepoInfo } from "@/lib/agents/types";
import { execFileAsync, expandHome } from "./env";

export async function git(cwd: string, args: string[], timeoutMs = 20_000) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function describeRepo(dir: string): Promise<RepoInfo | undefined> {
  try {
    const root = (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
    const [branch, status] = await Promise.all([
      git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      git(root, ["status", "--porcelain"]),
    ]);
    return {
      path: root,
      name: path.basename(root),
      branch: branch.trim(),
      dirty: status.split("\n").filter(Boolean).length,
    };
  } catch {
    return undefined;
  }
}

/**
 * 只有白名单里的仓库能派任务：当前项目，加上 ALCHEMY_REPOS 里用逗号分隔的路径。
 * Junie 无头运行会自动信任项目并加载它的 MCP、hooks，所以别把不认识的仓库放进来。
 */
export async function listRepos() {
  const dirs = [process.cwd(), ...(process.env.ALCHEMY_REPOS ?? "").split(",")]
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.resolve(expandHome(dir)));
  const repos = await Promise.all([...new Set(dirs)].map(describeRepo));
  const seen = new Set<string>();
  return repos.filter((repo): repo is RepoInfo => {
    if (!repo || seen.has(repo.path)) return false;
    seen.add(repo.path);
    return true;
  });
}

export async function findRepo(repoPath: string) {
  return (await listRepos()).find((repo) => repo.path === repoPath);
}

export async function isIgnored(worktree: string, file: string) {
  try {
    await git(worktree, ["check-ignore", "--quiet", file]);
    return true;
  } catch {
    return false;
  }
}

/** 相对基线提交的全部改动，包括 Agent 自己提交的和还没跟踪的新文件。 */
export async function diffChanges(worktree: string, base: string): Promise<FileChange[]> {
  await git(worktree, ["add", "--all", "--intent-to-add"]);
  const [numstat, patch] = await Promise.all([
    git(worktree, ["diff", base, "--numstat", "--no-renames"]),
    git(worktree, ["diff", base, "-U0", "--no-color", "--no-renames", "--no-ext-diff"]),
  ]);

  const changes = new Map<string, FileChange>();
  for (const line of numstat.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    const file = rest.join("\t");
    if (!file) continue;
    changes.set(file, {
      path: file,
      added: added === "-" ? undefined : Number(added),
      removed: removed === "-" ? undefined : Number(removed),
      deleted: false,
    });
  }

  let current: string | undefined;
  let oldPath: string | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("--- ")) {
      oldPath = line.startsWith("--- a/") ? line.slice(6) : undefined;
    } else if (line.startsWith("+++ ")) {
      if (line === "+++ /dev/null") {
        const change = oldPath ? changes.get(oldPath) : undefined;
        if (change) change.deleted = true;
        current = undefined;
      } else {
        current = line.slice(6);
      }
    } else if (current && line.startsWith("@@")) {
      const change = changes.get(current);
      const match = /\+(\d+)/.exec(line);
      if (change && change.line === undefined && match) change.line = Math.max(1, Number(match[1]));
    }
  }

  return [...changes.values()];
}
