import { AgentTaskError, ResultParseError, TaskTimeoutError, TmuxError } from "./errors.js";
import { buildRepairInstruction, buildResultInstruction, extractJson, formatSchemaError } from "./json-result.js";
import { TypedEmitter } from "./events.js";
import { RealTmuxAdapter } from "./tmux-adapter.js";
import type {
  AgentTmuxSdkOptions,
  ClaudeExecutionRequest,
  ClaudeExecutionResult,
  ClaudeSessionId,
  ProcessSnapshot,
  ProcessState,
  RunOneShotOptions,
  RunStreamOptions,
  RunTaskOptions,
  SchemaLike,
  SdkEventMap,
  TaskMode,
  TaskResult,
  TaskSnapshot,
  TaskState,
  TmuxAdapter,
} from "./types.js";
import { DEFAULT_IDLE_RESTART_MS } from "./types.js";

// Repair re-prompts after the initial result-mode attempt (origin decision: fixed, not user-configurable).
const DEFAULT_JSON_REPAIR_ATTEMPTS = 3;
// Hard ceiling on total tmux executions per result task, so the repair loop and
// token-exhaustion resume cannot compound without bound (independent of resumeAttempts).
const MAX_RESULT_EXECUTIONS = 8;

interface TmuxSlot {
  id: string;
  sessionName: string;
  paneId?: string;
  state: ProcessState;
  startedAt: number;
  lastUsedAt: number;
  currentTaskId?: string;
  claudeSessionId?: ClaudeSessionId;
  claudeRunning: boolean;
}

interface TaskRecord<TResult = unknown> {
  taskId: string;
  prompt: string;
  mode: TaskMode;
  workingDirectory?: string;
  timeoutMs?: number;
  waitForResult?: boolean;
  metadata?: Record<string, unknown>;
  schema?: SchemaLike<unknown>;
  state: TaskState;
  output?: string;
  error?: string;
  processId?: string;
  resolve: (value: TaskResult<TResult>) => void;
  reject: (reason: unknown) => void;
}

export class AgentTmuxSdk {
  private readonly emitter = new TypedEmitter<SdkEventMap>();
  private readonly tmux: TmuxAdapter;
  private readonly poolSize: number;
  private readonly idleRestartMs: number;
  private readonly startupTimeoutMs: number;
  private readonly taskTimeoutMs: number;
  private readonly resumeAttempts: number;
  private readonly sessionPrefix: string;
  private readonly waitForResult: boolean;
  private readonly dangerouslySkipPermissions: boolean;
  private readonly slots: TmuxSlot[] = [];
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly queue: TaskRecord[] = [];
  private readonly activeExecutions = new Set<Promise<void>>();
  private dispatchPromise: Promise<void> | undefined;
  private dispatchAgain = false;
  private nextSlotNumber = 1;
  private nextTaskNumber = 1;
  private closed = false;

  constructor(options: AgentTmuxSdkOptions = {}) {
    this.tmux = options.tmux ?? new RealTmuxAdapter();
    this.poolSize = options.poolSize ?? 1;
    this.idleRestartMs = options.idleRestartMs ?? DEFAULT_IDLE_RESTART_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 0;
    this.resumeAttempts = options.resumeAttempts ?? 1;
    this.sessionPrefix = options.sessionPrefix ?? "agent-tmux-sdk";
    this.waitForResult = options.waitForResult ?? true;
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? true;
  }

  on<K extends keyof SdkEventMap & string>(event: K, listener: (...args: SdkEventMap[K]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends keyof SdkEventMap & string>(event: K, listener: (...args: SdkEventMap[K]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  once<K extends keyof SdkEventMap & string>(event: K, listener: (...args: SdkEventMap[K]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }

  runOneShot(prompt: string, options: RunOneShotOptions = {}): Promise<TaskResult> {
    return this.runTask({
      taskId: options.taskId,
      prompt,
      mode: "oneshot",
      workingDirectory: options.workingDirectory,
      timeoutMs: options.timeoutMs,
      waitForResult: options.waitForResult,
      metadata: options.metadata,
    });
  }

  async *runStream(prompt: string, options: RunStreamOptions = {}): AsyncIterable<string> {
    if (this.closed) {
      throw new AgentTaskError("SDK has been cleaned up");
    }

    const taskId = options.taskId ?? `${this.sessionPrefix}-task-${this.nextTaskNumber++}`;
    let slot: TmuxSlot | undefined;

    try {
      slot = await this.acquireSlotBlocking();
      slot.state = "busy";
      slot.currentTaskId = taskId;
      this.emitter.emit("taskStarted", { taskId, state: "running", mode: "oneshot", prompt, processId: slot.id, metadata: options.metadata });

      if (!slot.claudeRunning) {
        await this.tmux.startClaude(slot.sessionName, this.claudeStartOpts(slot.claudeSessionId));
        slot.claudeRunning = true;
      }

      const request: ClaudeExecutionRequest = {
        taskId,
        prompt,
        mode: "oneshot",
        workingDirectory: options.workingDirectory,
        waitForResult: true,
        metadata: options.metadata,
      };

      for await (const chunk of this.tmux.stream(slot.sessionName, request)) {
        this.emitter.emit("streamChunk", taskId, chunk);
        yield chunk;
      }

      this.emitter.emit("taskCompleted", {
        taskId,
        state: "succeeded",
        output: "",
        processId: slot.id,
        mode: "oneshot",
        startedAt: slot.startedAt,
        completedAt: Date.now(),
        resumed: false,
        metadata: options.metadata,
      });
    } catch (error) {
      this.emitter.emit("taskFailed", taskId, error instanceof Error ? error : new AgentTaskError(String(error)));
      throw error;
    } finally {
      if (slot !== undefined) {
        slot.state = "idle";
        slot.currentTaskId = undefined;
        slot.lastUsedAt = Date.now();
      }
    }
  }

  runTask<TResult = unknown>(options: RunTaskOptions<TResult>): Promise<TaskResult<TResult>> {
    if (this.closed) {
      return Promise.reject(new AgentTaskError("SDK has been cleaned up"));
    }

    const taskId = options.taskId ?? `${this.sessionPrefix}-task-${this.nextTaskNumber++}`;
    if (this.tasks.has(taskId)) {
      return Promise.reject(new AgentTaskError(`Task already exists: ${taskId}`));
    }

    const promise = new Promise<TaskResult<TResult>>((resolve, reject) => {
      const task: TaskRecord<TResult> = {
        taskId,
        prompt: options.prompt,
        mode: options.mode ?? "oneshot",
        workingDirectory: options.workingDirectory,
        timeoutMs: options.timeoutMs,
        waitForResult: options.waitForResult,
        metadata: options.metadata,
        schema: options.schema,
        state: "queued",
        resolve,
        reject,
      };
      this.tasks.set(taskId, task as TaskRecord);
      this.queue.push(task as TaskRecord);
      this.emitter.emit("taskQueued", this.snapshotTask(task as TaskRecord));
      this.dispatch();
    });
    promise.catch(() => undefined);
    return promise;
  }

  getProcesses(): ProcessSnapshot[] {
    return this.slots.map((slot) => ({
      id: slot.id,
      sessionName: slot.sessionName,
      paneId: slot.paneId,
      state: slot.state,
      startedAt: slot.startedAt,
      lastUsedAt: slot.lastUsedAt,
      currentTaskId: slot.currentTaskId,
      claudeSessionId: slot.claudeSessionId,
      claudeRunning: slot.claudeRunning,
    }));
  }

  getTask(taskId: string): TaskSnapshot | undefined {
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      return undefined;
    }
    return this.snapshotTask(task);
  }

  async restartIdleProcesses(now = Date.now()): Promise<void> {
    const candidates = this.slots.filter(
      (slot) => slot.state === "idle" && now - slot.lastUsedAt >= this.idleRestartMs,
    );
    await Promise.all(candidates.map((slot) => this.restartClaude(slot)));
  }

  async cleanup(): Promise<void> {
    this.closed = true;
    await this.dispatchPromise;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task !== undefined) {
        this.cancelTask(task, "Task cancelled during cleanup");
      }
    }

    await Promise.allSettled(this.activeExecutions);

    const failures: unknown[] = [];
    for (const slot of this.slots) {
      if (slot.state === "stopped") {
        continue;
      }
      try {
        if (slot.claudeRunning) {
          await this.tmux.exitClaude(slot.sessionName).catch(() => undefined);
          slot.claudeRunning = false;
        }
        await this.tmux.killSession(slot.sessionName);
        slot.state = "stopped";
        this.emitter.emit("processStopped", slot.id);
      } catch (error) {
        slot.state = "failed";
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new TmuxError("Failed to cleanup one or more tmux sessions", { cause: failures[0] });
    }
  }

  private dispatch(): void {
    if (this.dispatchPromise !== undefined) {
      this.dispatchAgain = true;
      return;
    }

    this.dispatchPromise = this.dispatchLoop().finally(() => {
      this.dispatchPromise = undefined;
    });
  }

  private async dispatchLoop(): Promise<void> {
    do {
      this.dispatchAgain = false;
      await this.dispatchAsync();
    } while (this.dispatchAgain && !this.closed);
  }

  private async dispatchAsync(): Promise<void> {
    while (this.queue.length > 0 && !this.closed) {
      const task = this.queue.shift();
      if (task === undefined) {
        return;
      }
      task.state = "running";

      let slot: TmuxSlot | undefined;
      try {
        slot = await this.acquireSlot();
      } catch (error) {
        task.state = "failed";
        task.error = error instanceof Error ? error.message : String(error);
        task.reject(error);
        continue;
      }
      if (slot === undefined) {
        task.state = "queued";
        this.queue.unshift(task);
        return;
      }
      const execution = this.executeTask(slot, task).finally(() => {
        this.activeExecutions.delete(execution);
        this.dispatch();
      });
      this.activeExecutions.add(execution);
    }
  }

  private async acquireSlotBlocking(): Promise<TmuxSlot> {
    let slot: TmuxSlot | undefined;
    while (slot === undefined) {
      slot = await this.acquireSlot();
      if (slot === undefined) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return slot;
  }

  private async acquireSlot(): Promise<TmuxSlot | undefined> {
    const idle = this.slots.find((slot) => slot.state === "idle");
    if (idle !== undefined) {
      return idle;
    }

    if (this.slots.some((slot) => slot.state === "starting" || slot.state === "restarting")) {
      return undefined;
    }

    const liveSlots = this.slots.filter((slot) => slot.state !== "failed");
    if (liveSlots.length >= this.poolSize) {
      return undefined;
    }

    return this.startSlot();
  }

  private async startSlot(): Promise<TmuxSlot> {
    const id = `${this.sessionPrefix}-${this.nextSlotNumber++}`;
    const slot: TmuxSlot = {
      id,
      sessionName: id,
      state: "starting",
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      claudeRunning: false,
    };
    this.slots.push(slot);

    try {
      const handle = await this.tmux.createSession(id);
      slot.paneId = handle.paneId;
      slot.startedAt = handle.startedAt;
      await this.bootstrapClaude(slot);
      slot.state = "idle";
      this.emitter.emit("processStarted", slot.id);
      return slot;
    } catch (error) {
      slot.state = "failed";
      this.emitter.emit("processError", slot.id, error instanceof Error ? error : new TmuxError(String(error)));
      throw new TmuxError(`Failed to start tmux slot ${id}`, { cause: error });
    }
  }

  private async restartClaude(slot: TmuxSlot): Promise<void> {
    slot.state = "restarting";
    try {
      if (slot.claudeRunning) {
        await this.tmux.exitClaude(slot.sessionName);
        slot.claudeRunning = false;
      }
      await this.bootstrapClaude(slot);
      slot.lastUsedAt = Date.now();
      slot.state = "idle";
    } catch (error) {
      slot.state = "failed";
      throw new TmuxError(`Failed to restart Claude in ${slot.sessionName}`, { cause: error });
    }
  }

  private async bootstrapClaude(slot: TmuxSlot): Promise<void> {
    await this.tmux.startClaude(slot.sessionName, this.claudeStartOpts());
    const sessionId = await this.tmux.exitClaude(slot.sessionName);
    slot.claudeSessionId = sessionId;
    await this.tmux.startClaude(slot.sessionName, this.claudeStartOpts(sessionId));
    slot.claudeRunning = true;
  }

  private claudeStartOpts(sessionId?: ClaudeSessionId): import("./types.js").ClaudeStartOptions {
    return {
      startupTimeoutMs: this.startupTimeoutMs,
      sessionId,
      dangerouslySkipPermissions: this.dangerouslySkipPermissions,
    };
  }

  private async executeTask(slot: TmuxSlot, task: TaskRecord): Promise<void> {
    slot.state = "busy";
    slot.currentTaskId = task.taskId;
    task.state = "running";
    task.processId = slot.id;
    this.emitter.emit("taskStarted", this.snapshotTask(task));
    const startedAt = Date.now();

    try {
      if (!slot.claudeRunning) {
        await this.tmux.startClaude(slot.sessionName, this.claudeStartOpts(slot.claudeSessionId));
        slot.claudeRunning = true;
      }

      const outcome = await this.withTaskTimeout(task, () => this.runExecution(slot, task));
      task.output = outcome.output;

      task.state = "succeeded";
      const completedAt = Date.now();
      const taskResult: TaskResult = {
        taskId: task.taskId,
        state: "succeeded",
        output: outcome.output,
        result: outcome.result,
        processId: slot.id,
        mode: task.mode,
        startedAt,
        completedAt,
        resumed: outcome.resumed,
        metadata: task.metadata,
      };
      this.emitter.emit("taskCompleted", taskResult);
      task.resolve(taskResult);
    } catch (error) {
      task.state = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      this.emitter.emit("taskFailed", task.taskId, error instanceof Error ? error : new AgentTaskError(String(error)));
      task.reject(error);
      if (error instanceof TaskTimeoutError && slot.claudeRunning) {
        try {
          await this.tmux.exitClaude(slot.sessionName);
        } catch {
          // best-effort cleanup
        }
        slot.claudeRunning = false;
      } else {
        slot.claudeRunning = false;
      }
    } finally {
      slot.state = "idle";
      slot.currentTaskId = undefined;
      slot.lastUsedAt = Date.now();
    }
  }

  private async runExecution(
    slot: TmuxSlot,
    task: TaskRecord,
  ): Promise<{ output: string; result: unknown; resumed: boolean }> {
    if (task.mode !== "result") {
      const exec = await this.executeWithResume(slot, task, task.prompt, this.resumeAttempts + 1);
      return { output: exec.output, result: undefined, resumed: exec.resumed };
    }
    return this.runResultWithRepair(slot, task);
  }

  private async runResultWithRepair(
    slot: TmuxSlot,
    task: TaskRecord,
  ): Promise<{ output: string; result: unknown; resumed: boolean }> {
    // Single-line augmented prompt: tmux send-keys submits on every newline.
    let prompt = `${task.prompt} ${buildResultInstruction()}`;
    let attempt = 0;
    let executions = 0;
    let resumed = false;
    let lastError: string | undefined;

    for (;;) {
      // Hard ceiling on total tmux executions, independent of resumeAttempts:
      // the per-call budget keeps a single execute+token-resume chain from
      // overshooting it.
      const budget = MAX_RESULT_EXECUTIONS - executions;
      if (budget <= 0) {
        throw new ResultParseError(
          `Reached the result-mode execution ceiling (${MAX_RESULT_EXECUTIONS})` +
            (lastError !== undefined ? `: ${lastError}` : ""),
        );
      }

      const exec = await this.executeWithResume(slot, task, prompt, budget);
      executions += exec.executions;
      resumed = resumed || exec.resumed;

      const interpreted = this.interpretResult(task, exec);
      if (interpreted.ok) {
        return { output: exec.output, result: interpreted.value, resumed };
      }

      lastError = interpreted.errorText;
      attempt += 1;
      if (attempt > DEFAULT_JSON_REPAIR_ATTEMPTS) {
        throw new ResultParseError(
          `Claude did not return valid JSON for result mode after ${attempt} attempt(s)` +
            (lastError !== undefined ? `: ${lastError}` : ""),
        );
      }
      prompt = buildRepairInstruction(lastError);
    }
  }

  private interpretResult(
    task: TaskRecord,
    exec: ClaudeExecutionResult,
  ): { ok: true; value: unknown } | { ok: false; errorText: string } {
    let value: unknown;
    if (exec.result !== undefined) {
      value = exec.result;
    } else {
      const extracted = extractJson(exec.output);
      if (extracted === undefined) {
        return { ok: false, errorText: "no JSON value found in the response" };
      }
      try {
        value = JSON.parse(extracted) as unknown;
      } catch {
        return { ok: false, errorText: "response was not valid JSON" };
      }
    }

    const schema = task.schema;
    if (schema !== undefined) {
      if (typeof schema.safeParse !== "function") {
        throw new AgentTaskError("result schema must provide a safeParse(input) method");
      }
      const validation = schema.safeParse(value);
      if (!validation.success) {
        return { ok: false, errorText: formatSchemaError(validation.error) };
      }
      return { ok: true, value: validation.data };
    }

    return { ok: true, value };
  }

  private async executeWithResume(
    slot: TmuxSlot,
    task: TaskRecord,
    prompt: string,
    maxExecutions: number,
  ): Promise<ClaudeExecutionResult & { resumed: boolean; executions: number }> {
    let result = await this.tmux.execute(slot.sessionName, this.toRequest(task, prompt));
    if (result.sessionId) {
      slot.claudeSessionId = result.sessionId;
    }
    let attempts = 0;
    let executions = 1;

    while (result.tokenExhausted === true && attempts < this.resumeAttempts && executions < maxExecutions) {
      attempts += 1;
      task.state = "resuming";
      this.emitter.emit("taskResuming", task.taskId, attempts);

      const exitSessionId = await this.tmux.exitClaude(slot.sessionName);
      slot.claudeRunning = false;
      if (exitSessionId) {
        slot.claudeSessionId = exitSessionId;
      }

      await this.tmux.startClaude(slot.sessionName, this.claudeStartOpts(slot.claudeSessionId));
      slot.claudeRunning = true;

      result = await this.tmux.execute(slot.sessionName, this.toRequest(task, "continue"));
      executions += 1;
      if (result.sessionId) {
        slot.claudeSessionId = result.sessionId;
      }
    }

    if (result.exitCode !== 0 || result.tokenExhausted === true) {
      throw new AgentTaskError(result.error ?? result.output);
    }

    return {
      ...result,
      resumed: attempts > 0,
      executions,
    };
  }

  private toRequest(task: TaskRecord, prompt: string): ClaudeExecutionRequest {
    return {
      taskId: task.taskId,
      prompt,
      mode: task.mode,
      workingDirectory: task.workingDirectory,
      waitForResult: task.waitForResult ?? this.waitForResult,
      metadata: task.metadata,
    };
  }

  private async withTaskTimeout<T>(task: TaskRecord, run: () => Promise<T>): Promise<T> {
    const timeoutMs = task.timeoutMs ?? this.taskTimeoutMs;
    if (timeoutMs <= 0) {
      return run();
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new TaskTimeoutError(`Task timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private snapshotTask(task: TaskRecord): TaskSnapshot {
    return {
      taskId: task.taskId,
      state: task.state,
      mode: task.mode,
      prompt: task.prompt,
      processId: task.processId,
      output: task.output,
      error: task.error,
      metadata: task.metadata,
    };
  }

  private cancelTask(task: TaskRecord, message: string): void {
    task.state = "cancelled";
    task.error = message;
    task.reject(new AgentTaskError(message));
  }
}
