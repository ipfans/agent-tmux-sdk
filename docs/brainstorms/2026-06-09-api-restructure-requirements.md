# API 重构需求：分层设计、流式输出与账户管理移除

**日期：** 2026-06-09
**状态：** 草案

## 目标

重新设计 agent-tmux-sdk 的公开 API，实现三个核心目标：

1. **分层易用性** — 初级用户（CI/CD 脚本集成）零概念上手，高级用户保留完整控制力
2. **实时能力** — 支持流式输出和生命周期事件，满足监控和交互式场景
3. **API 契约稳定** — 收窄公开表面，移除不属于本 SDK 的账户管理功能，减少未来破坏性变更

## 用户画像

### 初级用户：脚本集成者

- 在 CI/CD 或自动化脚本中调用 Claude
- 典型场景：代码审查、代码生成、文档生成
- 需要：发 prompt → 拿结果，可选超时控制
- 不想理解：tmux session、进程池、slot 生命周期、pane capture

### 高级用户：Agent 服务构建者

- 构建长时间运行的多 agent 服务
- 需要：进程池精细调优、idle restart 策略、自定义 TmuxAdapter、生命周期事件监控
- 愿意理解底层概念以换取更大控制力

## 功能需求

### R1: 初级 API — `ClaudeAgent` 重设计

当前 `ClaudeAgent` 只有 3 行代码（透传到 `AgentTmuxSdk`），不提供实际价值。重新设计为初级用户的主入口。

**最小接口：**
- `run(prompt)` — 单次执行，返回结果字符串或结构化数据
- `stream(prompt)` — 流式执行，返回 `AsyncIterable<string>`
- 构造参数仅保留初级用户关心的选项：`workingDirectory`、`timeoutMs`、可选的 `model`
- 自动管理 tmux session 的创建和销毁，用户无需调用 `cleanup()`（可通过 `using` / `Symbol.asyncDispose` 或进程退出时自动清理）

**不暴露给初级接口的概念：**
- 进程池（poolSize, slot）
- Session resume / ClaudeSessionId
- TmuxAdapter
- ProcessSnapshot / ProcessState

### R2: 高级 API — `AgentTmuxSdk` 精简

`AgentTmuxSdk` 保持为高级入口，但进行以下调整：

- 移除 `account` 相关字段和方法（见 R5）
- 审计 `AgentTmuxSdkOptions`，移除不再需要的选项
- `ProcessSnapshot` 中移除 `account` 字段
- 保留：`poolSize`、`idleRestartMs`、`startupTimeoutMs`、`taskTimeoutMs`、`resumeAttempts`、`sessionPrefix`、`waitForResult`、`dangerouslySkipPermissions`、`tmux`（自定义 adapter）

### R3: 流式输出

- 任务执行期间可逐步接收 Claude 的文本输出
- 初级 API：`stream(prompt)` 返回 `AsyncIterable<string>`
- 高级 API：`runTask` 支持流式模式，通过回调或 `AsyncIterable` 提供增量输出
- 底层实现：通过定期 `capturePane` 对比差异提取新增内容（与现有轮询机制一致）
- `TmuxAdapter` 接口需扩展以支持增量输出获取

### R4: 生命周期事件系统

SDK 通过事件机制通知外部：

**事件列表：**
- `taskQueued` — 任务进入队列
- `taskStarted` — 任务开始执行
- `taskCompleted` — 任务成功完成
- `taskFailed` — 任务执行失败
- `taskResuming` — token 耗尽后重试
- `processStarted` — tmux 进程启动
- `processStopped` — tmux 进程停止
- `processError` — 进程级错误
- `streamChunk` — 流式输出片段（可选订阅）

**设计约束：**
- 零依赖 — 使用 Node.js 内置 `EventEmitter` 或自行实现轻量事件系统
- 事件订阅是可选的，不订阅不影响正常工作流
- 事件 payload 应使用严格类型定义

### R5: 移除账户管理

Claude 账户管理不属于本 SDK 的职责范围，需完整移除：

**代码移除：**
- `src/types.ts` — 移除 `AgentTmuxSdkOptions.account`、`ClaudeStartOptions.account`、`ClaudeExecutionRequest.account`、`ProcessSnapshot.account`
- `src/sdk.ts` — 移除 `desiredAccount` 字段、`switchAccount()` 公开方法、`applyAccount()` 私有方法、所有 account 透传逻辑
- `src/tmux-adapter.ts` — 移除 `switchAccount()` 实现和 `startClaude` 中的 account 调用
- `TmuxAdapter` 接口 — 移除 `switchAccount` 方法签名

**测试移除：**
- 删除 `test/account-switching.test.ts`
- 清理 `test/fakes/fake-tmux.ts` 中的 `accountSwitches`、`failAccountSwitch` 及 `switchAccount()`
- 检查并清理其他测试文件中的 account 引用（`lifecycle.test.ts`、`fake-harness.test.ts`、`public-api-types.test.ts`）

**示例移除：**
- 删除 `examples/05-account-switching.ts`
- 清理其他示例中的 account 引用（`examples/03-process-pool.ts`、`examples/08-error-handling.ts`、`examples/10-claude-agent.ts`、`examples/11-custom-adapter.ts`）
- 示例重新编号以消除间隔

### R6: API 契约稳定性

- 审计 `src/index.ts` 的导出列表，仅暴露用户需要的类型
- 内部类型（如 `TmuxSlot`、`ClaudeSessionId`）不应出现在公开 API 中
- 对外类型使用 `readonly` 保护，防止外部修改
- 考虑将 `ClaudeSessionId` 从 `string` 别名改为 opaque type 或完全隐藏

### R7: 测试加固

- 确保 `FakeTmux` 的行为与 `RealTmuxAdapter` 的契约一致
- 为新增的流式输出和事件系统编写完整测试
- 错误恢复路径（进程启动失败、超时、token 耗尽）需要更多边界测试
- 考虑为 `TmuxAdapter` 接口定义契约测试（contract test），fake 和 real 实现都要通过

## 非目标

- 改变 tmux 底层执行模型
- Claude CLI 版本兼容性处理
- 账户管理（已明确移除）

## 示例重组

移除账户示例后，按用户层级重新组织：

**初级示例（前置）：**
1. 基础单次调用
2. 流式输出
3. 超时控制
4. 错误处理

**高级示例（后置）：**
5. 进程池管理
6. 结果模式（result mode）
7. Token 耗尽与 resume
8. Idle restart
9. 任务元数据
10. 自定义 adapter
11. 生命周期事件
12. 优雅关闭

## 成功标准

- 初级用户 3 行代码完成 prompt → 结果的完整流程
- 高级用户不损失当前已有的控制能力（除 account 外）
- 所有公开类型和方法有明确的稳定性承诺
- 测试覆盖率不低于当前水平，新增功能有完整测试
- 零新增生产依赖
