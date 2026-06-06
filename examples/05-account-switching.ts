/**
 * Account switching — switch Claude accounts without interrupting running tasks.
 *
 * 账户切换 — 切换 Claude 账户，不中断正在运行的任务。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({
    poolSize: 2,
    account: "personal",
  });

  // Start a long-running task on the "personal" account.
  // 在 "personal" 账户上启动一个长时间运行的任务。
  const longTask = sdk.runOneShot("Analyze the full codebase", { taskId: "analysis" });

  // Switch to "work" — idle processes switch immediately,
  // the busy process switches when it finishes.
  // 切换到 "work" — 空闲进程立即切换，繁忙进程在完成后切换。
  await sdk.switchAccount("work");
  console.log("Account switched to 'work'");

  // New tasks use the "work" account.
  // 新任务使用 "work" 账户。
  const quickTask = await sdk.runOneShot("What time is it?", { taskId: "quick" });
  console.log("Quick task done:", quickTask.output.slice(0, 60));

  await longTask;

  // Verify all processes are on "work" / 确认所有进程都在 "work" 账户
  for (const process of sdk.getProcesses()) {
    console.log(`Process ${process.id}: account=${process.account}`);
  }

  await sdk.cleanup();
}

main().catch(console.error);
