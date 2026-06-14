# agent-tmux-sdk

用于通过 tmux 会话编排 Claude CLI 以构建多智能体工作流的 TypeScript SDK。设计上零生产依赖。

> English version: [README.md](README.md)

## 特性

- **容器/消费者模型** — tmux 会话是长生命周期容器，Claude 进程是其中的短生命周期消费者
- **进程池** — 管理一组可配置的 tmux 容器及其 Claude 消费者
- **任务队列** — 进程池饱和时自动排队，并按分配顺序执行
- **空闲重启** — 退出 Claude 消费者并在同一 tmux 容器内启动新消费者（默认：1 小时）
- **流式输出** — 通过 `runStream`（`AsyncIterable<string>`）增量消费任务输出
- **类型化生命周期事件** — 通过 `on`/`off`/`once` 订阅任务/进程事件（`taskStarted`、`streamChunk`、`taskCompleted` 等）
- **Token 耗尽恢复** — 捕获 Claude 会话 ID，通过 `claude --resume <id>` 恢复，发送 "continue" 提示词
- **两阶段清理** — 先优雅退出 Claude 消费者，再销毁 tmux 容器
- **双执行模式** — 即发即忘（one-shot），以及结果模式：SDK 引导只输出 JSON、从终端噪声中提取、失败自动重试，并可选地用 Zod schema 校验形状与推导类型
- **类型化错误** — 针对 tmux、任务、超时和解析失败的领域特定错误层次结构
- **可测试** — 适配器边界允许在测试中使用确定性的假（fake）tmux/Claude 测试工具

## 安装

```bash
pnpm add agent-tmux-sdk
```

## 前置条件

- Node.js >= 20
- [tmux](https://github.com/tmux/tmux) 已安装并在 `$PATH` 中可用
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并完成认证

## 快速开始

```typescript
import { AgentTmuxSdk } from "agent-tmux-sdk";
import { z } from "zod"; // 可选 peer 依赖 — 仅在结果模式使用 schema 时需要

const sdk = new AgentTmuxSdk({
  poolSize: 2,
  idleRestartMs: 60 * 60 * 1000,
});

// 即发即忘执行
const oneshot = await sdk.runOneShot("List all files in this directory");
console.log(oneshot.output);

// 结果模式 — SDK 负责拿到合法 JSON（引导 → 提取 → 重试）。
// 可选的 Zod schema 会校验形状并推导返回类型。
const review = await sdk.runTask({
  prompt: "Summarize this repository",
  mode: "result",
  schema: z.object({ summary: z.string() }),
});
console.log(review.result?.summary); // 类型为 string

// 清理（两阶段：退出 Claude 消费者，然后终止 tmux 容器）
await sdk.cleanup();
```

> 结果模式的 schema 校验把 [Zod](https://zod.dev) 作为**可选 peer 依赖** — 仅当你传入 `schema` 时才需要安装。不传 schema 时结果模式仍返回解析后的 JSON，且 SDK 保持零生产依赖。任何暴露兼容 `safeParse` 的校验库都可用。

## 配置项

所有数值均可通过 `AgentTmuxSdkOptions` 进行配置。

| 选项 | 默认值 | 说明 |
|--------|---------|-------------|
| `poolSize` | `1` | 进程池中 tmux 容器的最大数量 |
| `idleRestartMs` | `3_600_000` | 空闲 Claude 消费者重启阈值（毫秒） |
| `startupTimeoutMs` | `30_000` | 等待 Claude 消费者启动的最大时间（毫秒） |
| `taskTimeoutMs` | `0` | 单任务超时（毫秒），`0` 表示禁用 |
| `resumeAttempts` | `1` | Token 耗尽恢复尝试次数，`0` 表示禁用 |
| `sessionPrefix` | `"agent-tmux-sdk"` | tmux 会话名称前缀 |
| `waitForResult` | `true` | 是否等待 Claude 输出稳定后再返回，可按任务覆盖 |
| `tmux` | `RealTmuxAdapter` | 用于假/真实 tmux 实现的适配器 |

## API

### `AgentTmuxSdk`

| 方法 | 说明 |
|--------|-------------|
| `runOneShot(prompt, options?)` | 即发即忘执行，返回 `TaskResult` |
| `runTask<T>(options)` | 带完整选项的执行，返回 `TaskResult<T>` |
| `runStream(prompt, options?)` | 以 `AsyncIterable<string>` 形式增量流式返回输出 |
| `on(event, listener)` / `off` / `once` | 订阅类型化生命周期事件（`SdkEventMap`） |
| `getProcesses()` | 获取所有进程池进程的快照（包含 `claudeSessionId`、`claudeRunning`） |
| `getTask(taskId)` | 获取指定任务的快照 |
| `restartIdleProcesses(now?)` | 退出空闲 Claude 消费者并在同一 tmux 容器内启动新消费者 |
| `cleanup()` | 两阶段：退出 Claude 消费者，然后终止 tmux 容器 |

### `TmuxAdapter` 接口

容器操作：
- `createSession(sessionName, workingDirectory?)` — 创建 tmux 容器
- `killSession(sessionName)` — 销毁 tmux 容器
- `capturePane(sessionName)` — 捕获面板输出

消费者操作：
- `startClaude(sessionName, options)` — 在容器内启动 Claude 消费者
- `exitClaude(sessionName)` — 退出 Claude 消费者，返回 `ClaudeSessionId`
- `resumeClaude(sessionName, sessionId)` — 通过 `claude --resume <id>` 恢复 Claude

任务操作：
- `execute(sessionName, request)` — 发送任务并等待完成
- `stream(sessionName, request)` — 发送任务并增量产出输出
- `interrupt(sessionName)` — 停止当前回合，让 Claude 回到空闲提示符

### `ClaudeAgent`

面向新手的单个池化 Claude 会话封装。通过 `ClaudeAgentOptions` 配置
（`workingDirectory`、`timeoutMs`、`dangerouslySkipPermissions`）。

```typescript
import { ClaudeAgent } from "agent-tmux-sdk";

const agent = new ClaudeAgent({ workingDirectory: "/path/to/project", timeoutMs: 60_000 });
const result = await agent.run("Hello"); // 解析为输出字符串

for await (const chunk of agent.stream("Tell me a story")) {
  process.stdout.write(chunk);
}

await agent.cleanup(); // 也可通过 `await using agent = new ClaudeAgent()` 自动清理
```

### 错误层次结构

```
AgentTmuxSdkError（基类）
├── TmuxError          — tmux 容器/Claude 消费者启动、重启、完成超时、清理失败
└── AgentTaskError     — 任务级别失败
    ├── TaskTimeoutError   — 单任务超时
    └── ResultParseError   — 结果模式下输出不是合法 JSON
```

## 测试

SDK 使用 `TmuxAdapter` 接口边界。测试注入 `FakeTmux` 和 `FakeClaude` 测试工具，实现确定性、快速的单元测试，无需真实的 tmux 或 Claude CLI。

```bash
pnpm test              # 快速、纯 fake 单元测试
pnpm run coverage      # 单元测试 + 覆盖率
pnpm test:watch        # 监听模式
pnpm test:integration  # 真实 tmux + Claude 端到端（按需启用）
```

`pnpm test` 绝不调用 Claude。真实 tmux/Claude 端到端测试为按需启用：`pnpm test:integration` 会设置 `RUN_INTEGRATION=1`，且安全可跳过——除非本地同时具备 `tmux` 和 Claude CLI，否则自动跳过。

## 开发

```bash
pnpm run build        # 构建 ESM + CJS + 声明文件
pnpm run dev          # 监听模式
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint src/ test/
```

## 架构

完整的 API 设计请参见 [docs/api-design_zh.md](docs/api-design_zh.md)，测试契约覆盖面请参见 [docs/scenario-matrix_zh.md](docs/scenario-matrix_zh.md)。

## 许可证

MIT
