import "server-only";

import { execFile } from "node:child_process";

/** macOS 通知。消息走 argv 传给 AppleScript，不拼进脚本，不用管引号。 */
export function notify(title: string, message: string) {
  if (process.platform !== "darwin") return;
  execFile(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e",
      "end run",
      title,
      message,
    ],
    { timeout: 10_000 },
    () => {},
  );
}
