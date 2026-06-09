/**
 * Idle restart — periodically restart processes that have been idle too long.
 *
 * 空闲重启 — 定期重启空闲时间过长的进程。
 */
import { AgentTmuxSdk, DEFAULT_IDLE_RESTART_MS } from "agent-tmux-sdk";

async function main() {
  console.log("Default idle restart threshold:", DEFAULT_IDLE_RESTART_MS, "ms");

  const sdk = new AgentTmuxSdk({
    poolSize: 2,
    // Custom threshold: restart after 30 minutes instead of the default 1 hour.
    // 自定义阈值：30 分钟后重启，而不是默认的 1 小时。
    idleRestartMs: 30 * 60 * 1000,
  });

  // Warm up the pool / 预热进程池
  await sdk.runOneShot("Hello");

  // Set up periodic idle-restart checks.
  // 设置定期空闲重启检查。
  const timer = setInterval(async () => {
    try {
      await sdk.restartIdleProcesses();
      const processes = sdk.getProcesses();
      console.log(
        "Pool check:",
        processes.map((p) => `${p.id}=${p.state}`).join(", "),
      );
    } catch (error) {
      console.error("Restart failed:", error);
    }
  }, 60_000);

  // Run some work / 执行一些任务
  await sdk.runOneShot("Summarize the project");

  // In production, the timer runs until shutdown.
  // 在生产环境中，定时器一直运行直到关闭。
  clearInterval(timer);
  await sdk.cleanup();
}

main().catch(console.error);
