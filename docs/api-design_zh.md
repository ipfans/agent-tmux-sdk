# agent-tmux-sdk API 设计

`agent-tmux-sdk` 管理一组运行在长生命周期 tmux 会话中的 Claude CLI 进程池。核心模型：**tmux 会话 = 容器（长生命周期）**，**Claude 进程 = 消费者（tmux 内的短生命周期进程）**。SDK 负责 tmux 容器生命周期、Claude 消费者生命周期、任务分配、空闲重启、流式输出、生命周期事件、Token 耗尽恢复和两阶段清理。

## 公共入口

```ts
import { AgentTmuxSdk } from "agent-tmux-sdk";

const sdk = new AgentTmuxSdk({
  poolSize: 2,
  idleRestartMs: 60 * 60 * 1000,
});

const result = await sdk.runTask({
  prompt: "Summarize this repository",
  mode: "result",
});

await sdk.cleanup();
```

## 配置项

所有数值均可通过 `AgentTmuxSdkOptions` 进行配置。

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `poolSize` | `1` | 进程池维持的最大 tmux 容器（及其 Claude 消费者）数量。 |
| `idleRestartMs` | `3_600_000` | 空闲 Claude 消费者达到此时间后自动重启，可用于测试和生产环境调优。 |
| `startupTimeoutMs` | `30_000` | 等待 Claude 消费者在 tmux 容器内就绪的最大时间。 |
| `taskTimeoutMs` | `0` | 单任务超时时间，`0` 表示禁用超时。 |
| `resumeAttempts` | `1` | Token 耗尽时通过恢复 Claude 会话自动重试的尝试次数，设为 `0` 可禁用。 |
| `sessionPrefix` | `"agent-tmux-sdk"` | tmux 会话名称前缀，允许多个 SDK 实例共存。 |
| `waitForResult` | `true` | 是否等待 Claude 输出稳定后再返回。可按任务覆盖。 |
| `tmux` | 真实适配器 | 适配器边界，用于假（fake）和真实 tmux 实现的切换。 |

## 核心类型

```ts
type ProcessState = "idle" | "starting" | "busy" | "restarting" | "stopped" | "failed";
type TaskState = "queued" | "running" | "resuming" | "succeeded" | "failed" | "cancelled";
type TaskMode = "oneshot" | "result";
type ClaudeSessionId = string;
```

`ClaudeSessionId` 跟踪 Claude CLI 的会话标识符，用于 Token 耗尽恢复时执行 `claude --resume <id>`。

## 关键类型

```ts
interface ClaudeStartOptions {
  readonly startupTimeoutMs?: number;
  readonly sessionId?: ClaudeSessionId;
  readonly dangerouslySkipPermissions?: boolean;
}

interface ClaudeExecutionRequest {
  readonly taskId: string;
  readonly prompt: string;
  readonly mode: TaskMode;
  readonly workingDirectory?: string;
  readonly waitForResult?: boolean;
  readonly metadata?: Record<string, unknown>;
}

interface ClaudeExecutionResult {
  readonly exitCode: number;
  readonly output: string;
  readonly result?: unknown;
  readonly tokenExhausted?: boolean;
  readonly error?: string;
  readonly sessionId?: ClaudeSessionId;
}

interface ProcessSnapshot {
  readonly id: string;
  readonly sessionName: string;
  readonly paneId?: string;
  readonly state: ProcessState;
  readonly startedAt: number;
  readonly lastUsedAt: number;
  readonly currentTaskId?: string;
  readonly claudeSessionId?: ClaudeSessionId;
  readonly claudeRunning: boolean;
}
```

`ProcessSnapshot` 暴露 `claudeSessionId`（最后已知的 Claude 会话标识符）和 `claudeRunning`（Claude 消费者是否当前在 tmux 容器内活跃）。

## 任务执行

- `runOneShot(prompt, options?)` — 即发即忘的 CLI 调用方式，返回包含输出文本的 `TaskResult`。
- `runTask<TResult>(options)` — 返回 `TaskResult<TResult>`，包含 `taskId`、`state`、`output`、可选的解析后 `result`、生命周期元数据（`startedAt`、`completedAt`、`resumed`）以及调用方提供的 `metadata`。`mode: "result"` 可传入可选的 `schema`（`SchemaLike`，例如 Zod schema）来校验并推导解析后的 JSON，校验错误会反馈进修复重提示。
- `runStream(prompt, options?)` — 返回 `AsyncIterable<string>`，增量产出输出，遵循 `options.timeoutMs`（或 `taskTimeoutMs`）。
- `on` / `off` / `once` — 订阅类型化生命周期事件（`SdkEventMap`）：`taskQueued`、`taskStarted`、`taskCompleted`、`taskFailed`、`taskResuming`、`streamChunk`、`processStarted`、`processStopped`、`processError`。

两个方法都接受 `waitForResult` 参数来覆盖全局默认值。当为 `true`（默认值）时，适配器会轮询 `capture-pane` 直到输出稳定。当为 `false` 时，发送按键后立即返回。

两个方法在进程池饱和时都会将任务排队，并按分配顺序执行。

## 容器/消费者生命周期

- **容器创建**：tmux 会话在任务到达且有空闲槽位时懒创建。新槽位先创建 tmux 会话（容器），然后在其中启动 Claude 进程（消费者）。
- **消费者复用**：空闲的 Claude 消费者会被后续任务复用，无需重启。
- **空闲重启**：`restartIdleProcesses(now?)` 退出 Claude 消费者（`exitClaude`），然后在同一 tmux 容器内启动新的消费者（`startClaude`）。空闲重启期间绝不终止 tmux 会话。繁忙进程永远不会被重启。
- **清理**：两阶段拆解。首先，`exitClaude` 优雅退出每个 Claude 消费者。然后，`killSession` 销毁 tmux 容器。该操作是幂等的，会等待进行中的任务与流式输出完成，并在清理后拒绝新任务。

## Token 耗尽恢复

当 Claude 因 Token 耗尽退出时，SDK 会：

1. 从退出输出中捕获 Claude 会话 ID。
2. 调用 `exitClaude` 优雅退出 Claude 进程并捕获 `ClaudeSessionId`。
3. 调用 `resumeClaude(sessionName, sessionId)` 在同一 tmux 容器内执行 `claude --resume <id>`。
4. 向恢复的会话发送 "continue" 提示词。

此循环最多重复 `resumeAttempts` 次。如果所有尝试均失败，错误将抛给调用方。成功的恢复对调用方透明——`TaskResult.resumed` 标志表示是否发生了恢复。`ClaudeExecutionResult.sessionId` 字段在每次执行中携带会话标识符。

## 错误层次结构

```
AgentTmuxSdkError（基类）
├── TmuxError          — tmux 容器/Claude 消费者启动、重启、完成超时、清理失败
└── AgentTaskError     — 任务级别失败
    ├── TaskTimeoutError   — 单任务超时
    └── ResultParseError   — result 模式下输出不是合法 JSON
```

## Tmux 适配器边界

SDK 通过 `TmuxAdapter` 接口与 tmux 通信，将容器操作与消费者操作分离：

**容器操作**（tmux 会话生命周期）：
- `createSession(sessionName, workingDirectory?)` — 创建长生命周期的 tmux 会话（容器）。
- `killSession(sessionName)` — 销毁 tmux 会话（容器）。
- `capturePane(sessionName)` — 从容器中捕获当前面板输出。

**消费者操作**（容器内的 Claude 进程生命周期）：
- `startClaude(sessionName, options)` — 在已有的 tmux 容器内启动 Claude 消费者。
- `exitClaude(sessionName)` — 优雅退出 Claude 消费者，如果可用则返回 `ClaudeSessionId`。
- `resumeClaude(sessionName, sessionId)` — 通过 `claude --resume <id>` 恢复 Claude 消费者。

**任务操作**：
- `execute(sessionName, request)` — 向 Claude 消费者发送任务并等待完成。
- `stream(sessionName, request)` — 发送任务并增量产出输出。
- `interrupt(sessionName)` — 停止当前回合，让 Claude 回到空闲提示符（用于回收提前结束流式输出的槽位）。

`RealTmuxAdapter` 接受 `RealTmuxAdapterOptions` 来配置轮询和就绪检测：

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `pollIntervalMs` | `500` | `capture-pane` 轮询间隔。 |
| `stableThresholdMs` | `5000` | 输出保持不变多长时间后视为稳定。 |
| `completionTimeoutMs` | `600000` | 单个回合（`execute` 与 `stream`）的硬上限，超时后适配器抛错。 |
| `readyPattern` | `/✻\s+\S+\s+for\s+[\d.]+\s*s/` | 识别 Claude 旋转器完成行的正则，用于从流式增量中剥离 UI 噪声。 |

测试使用确定性的假（fake）tmux 和假 Claude 测试工具。真实 tmux/Claude 集成测试是可选的，在本地命令不可用时会自动跳过。

## 便捷封装

```ts
import { ClaudeAgent } from "agent-tmux-sdk";

const agent = new ClaudeAgent({ workingDirectory: "/path/to/project", timeoutMs: 60_000 });
const result = await agent.run("Hello"); // 解析为输出字符串
for await (const chunk of agent.stream("Tell me a story")) process.stdout.write(chunk);
await agent.cleanup();
```

## 场景矩阵

完整的测试契约覆盖面请参见 [scenario-matrix_zh.md](scenario-matrix_zh.md)。
