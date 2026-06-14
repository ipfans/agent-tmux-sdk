# 场景矩阵

| ID | 状态 | 测试文件 | 实现前失败原因 | 实现证据 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| API-01 | 已完成 | `test/public-api-types.test.ts` | 公共 API 不存在。 | 导出了 SDK 配置项、状态类型、类型化结果、类型化错误、`ClaudeSessionId`、`ClaudeStartOptions`、容器/消费者类型。 | `pnpm test`、`pnpm run typecheck` |
| HAR-01 | 已完成 | `test/fake-harness.test.ts` | 假 tmux/假 Claude 测试工具不存在。 | 确定性的假 `createSession`、`killSession`、`startClaude`、`exitClaude`、`resumeClaude`、`execute`、`stream`、`interrupt`、`capturePane`、故障标志、Token 耗尽恢复流程、Claude 会话 ID 跟踪。 | `pnpm test` |
| POOL-01 | 已完成 | `test/process-pool.test.ts` | 进程池不存在。 | 懒启动与空闲复用、池大小上限、并发填充、队列排空、可配置 sessionPrefix。 | `pnpm test` |
| LIFE-01 | 已完成 | `test/lifecycle.test.ts` | 生命周期状态跟踪不存在。 | 成功和失败路径下的任务/进程快照、未知任务返回 undefined、元数据传递、`claudeSessionId` 和 `claudeRunning` 跟踪。 | `pnpm test` |
| IDLE-01 | 已完成 | `test/idle-restart.test.ts` | 空闲重启逻辑不存在。 | `DEFAULT_IDLE_RESTART_MS` 为一小时；`idleRestartMs` 可配置；繁忙进程不会被重启。空闲重启退出 Claude 消费者并在同一 tmux 容器内启动新消费者（不终止 tmux）。 | `pnpm test` |
| TASK-01 | 已完成 | `test/task-execution.test.ts` | 排队/进行中行为不存在。 | 饱和时排队并按分配顺序执行。 | `pnpm test` |
| TOK-01 | 已完成 | `test/token-resume.test.ts` | Token 耗尽恢复不存在。 | Token 耗尽触发 `exitClaude` 捕获 `ClaudeSessionId`，然后通过 `resumeClaude` 执行 `claude --resume <id>`，发送 "continue" 提示词。可配置多次恢复、零次恢复禁用、超过最大次数后失败。 | `pnpm test` |
| MODE-01 | 已完成 | `test/result-modes.test.ts` | 即发即忘/结果模式不存在。 | 即发即忘输出、JSON 结果解析、预解析结果透传、类型化解析错误。 | `pnpm test` |
| CLEAN-01 | 已完成 | `test/cleanup.test.ts` | 清理行为不存在。 | 两阶段清理：先 `exitClaude` 退出每个消费者，再 `killSession` 销毁每个容器。等待运行中任务完成、取消排队任务、跳过已停止的进程、幂等、清理后拒绝新任务。 | `pnpm test` |
| ERR-01 | 已完成 | `test/error-paths.test.ts` | 类型化错误路径不存在。 | 启动、任务失败、超时、解析、清理、重复任务 ID、清理后拒绝、重启失败、Claude 退出失败均抛出类型化错误。 | `pnpm test` |
| WAIT-01 | 已完成 | `test/wait-for-result.test.ts` | 等待结果的管道不存在。 | 全局默认 `true`、单任务覆盖、通过 `runOneShot`/`runTask`/恢复传递、`RealTmuxAdapter` 轮询 `capture-pane` 直到输出稳定、`readyPattern` 检测。 | `pnpm test` |
| AGENT-01 | 已完成 | `test/claude-agent.test.ts` | ClaudeAgent 便捷封装不存在。 | `ClaudeAgent` 将 `AgentTmuxSdk` 封装为新手入口：`run` 返回输出字符串、`stream` 产出分块、幂等 `cleanup`、`Symbol.asyncDispose`、跨调用复用会话。 | `pnpm test` |
| STREAM-01 | 已完成 | `test/streaming.test.ts` | 流式输出不存在。 | `runStream` 按序产出适配器分块，并发出 `streamChunk`/`taskStarted`/`taskCompleted` 事件、累积输出、成功/出错后将槽位归还为空闲、遵循 `timeoutMs`（类型化超时）、在提前 break/出错时中断槽位（干净完成时不中断）、清理后拒绝。提前 break 后立即提交的任务仍会被派发（[DISP-01] 派发竞态的回归守卫）。 | `pnpm test` |
| EVENT-01 | 已完成 | `test/sdk-events.test.ts`、`test/events.test.ts` | 类型化生命周期事件不存在。 | `TypedEmitter` 的 on/off/once/emit；SDK 按生命周期顺序发出 `taskQueued`/`taskStarted`/`taskCompleted`/`taskFailed`/`taskResuming`/`processStarted`/`processStopped`/`processError`；`off` 取消订阅；无监听器时发事件安全。 | `pnpm test` |
| JSONX-01 | 已完成 | `test/json-result.test.ts` | 纯 JSON 提取/指令辅助函数不存在。 | `extractJson` 剥离 ANSI/TUI 噪声并返回最后一个平衡值（处理围栏块、尾部噪声、字符串内括号、陈旧 scrollback + 回显的形状示例）；单行 `buildResultInstruction`/`buildRepairInstruction`；防御式 `formatSchemaError`。 | `pnpm test` |
| REPAIR-01 | 已完成 | `test/json-repair.test.ts` | 结果模式重试循环不存在。 | 提取接入结果路径；解析失败时重提（默认 3 次），与 token 恢复相互独立；首次成功仅一次执行；耗尽后抛出 `ResultParseError`；与 token 恢复叠加时总执行次数受上限约束；oneshot 输出不受影响。 | `pnpm test` |
| SCHEMA-01 | 已完成 | `test/json-schema.test.ts`、`test/public-api-types.test.ts` | 可选 schema 校验/类型推导不存在。 | 结构化 `SchemaLike`（兼容 Zod）校验解析后的 JSON 并通过推导给出返回类型；校验失败折入重提；接受非 Zod 的 `safeParse`；缺少 `safeParse` 抛类型化错误；不传 schema 返回无类型 JSON；发布的类型中不含 zod。 | `pnpm test`、`pnpm run typecheck` |
| MODEL-01 | 已完成 | `test/model.test.ts` | 模型选择能力不存在——无法将进程池固定到特定模型（例如用 haiku 做低成本测试）。 | `AgentTmuxSdkOptions.model` / `ClaudeAgentOptions.model` 传递到 `startClaude` 并转为 `claude --model <model>`；格式经过校验（拒绝空白/ shell 元字符，接受别名、完整名称以及带方括号后缀的名称如 `claude-opus-4-8[1m]`）。集成套件默认运行在 `haiku`（可用 `INTEGRATION_MODEL` 覆盖）。 | `pnpm test`、`pnpm test:integration` |
| INT-01 | 已完成 | `test/integration/text.integration.test.ts`、`concurrency.integration.test.ts`、`json-result.integration.test.ts` | 真实 tmux/Claude 端到端覆盖不存在（仅有可用性桩）。 | 按需启用套件（`pnpm test:integration` / `RUN_INTEGRATION`，安全可跳过）：one-shot + 纯文本、受控并发（预热后峰值 == poolSize）、带 schema 的 JSON 结果（跨屏、复用 slot、含字符串内花括号与方括号的 20 对象嵌套负载、以及强制修复收敛）。默认快速套件中排除。 | `pnpm test:integration`（真实）、`pnpm test`（排除）、`pnpm run typecheck` |
| INT-02 | 已完成 | `test/integration/streaming.integration.test.ts` | 真实流式（适配器轮询循环 / 剥离 UI chrome / 仅追加增量）无端到端覆盖。 | `runStream` 按序产出真实响应并剥离 UI chrome；提前 break 会中断该轮（Escape）且槽位可被下一个任务复用。 | `pnpm test:integration` |
| INT-03 | 已完成 | `test/integration/working-directory.integration.test.ts` | 真实 `/cd` 工作目录无端到端覆盖。 | 设置 `workingDirectory` 的任务读取该目录下的相对路径标记文件。 | `pnpm test:integration` |
| INT-04 | 已完成 | `test/integration/input-escaping.integration.test.ts` | 真实 `send-keys` 字面量转义无覆盖。 | 以 `-` 开头的提示词以及包含 shell 元字符的提示词均按原样发送（`-l --`，不经 shell）。 | `pnpm test:integration` |
| INT-05 | 已完成 | `test/integration/claude-agent.integration.test.ts` | `ClaudeAgent` 封装无端到端覆盖。 | `run` 返回文本并通过 `Symbol.asyncDispose` 释放；`stream` 产出分块。 | `pnpm test:integration` |
| INT-06 | 已完成 | `test/integration/slot-lifecycle.integration.test.ts` | 真实槽位退出/重启恢复无覆盖。 | 任务超时后槽位恢复（真实 `exitClaude`）并执行下一个任务；`restartIdleProcesses` 循环 Claude 且槽位保持可用。 | `pnpm test:integration` |
| DISP-01 | 已完成 | `test/streaming.test.ts`、`test/integration/streaming.integration.test.ts` | `dispatch()` 的「先检查后执行」竞态：在 `dispatchLoop` 最后一次 `dispatchAgain` 检查与清除 `dispatchPromise` 之间的微任务窗口里入队的任务会被搁置（由 INT-02 的提前 break + 紧接的 `runTask` 暴露）。 | `dispatch()` 在清除 `dispatchPromise` 后重新检查 `dispatchAgain` 并重跑循环；由确定性 fake 复现与真实提前 break 复用测试守护。 | `pnpm test`、`pnpm test:integration` |

## 最终命令验证

- `pnpm test`：19 个文件，142 个测试全部通过（快速、纯 fake；不含集成测试）。
- `pnpm test:integration`：8 个真实 tmux/Claude 套件（17 个测试），按需启用且安全可跳过。
- `pnpm run typecheck`：生产和测试 TypeScript 均通过。
- `pnpm run lint`：`src/` 和 `test/` 均通过。
- `pnpm run build`：ESM、CJS 和声明文件输出均通过（`dist` 中无 `zod`）。
