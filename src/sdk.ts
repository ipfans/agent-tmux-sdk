import { AgentTaskError, ResultParseError, TaskTimeoutError, TmuxError } from "./errors.js";
import {
  buildRepairInstruction,
  buildResultInstruction,
  collapseWhitespace,
  extractJson,
  formatSchemaError,
} from "./json-result.js";
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
    const timeoutMs = options.timeoutMs ?? this.taskTimeoutMs;
    const startedAt = Date.now();

    // Register the stream as in-flight work so cleanup() awaits it (and spares
    // its slot) instead of tearing the session down mid-iteration.
    let markDone!: () => void;
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });
    this.activeExecutions.add(done);

    let slot: TmuxSlot | undefined;
    let completed = false;
    let output = "";

    try {
      slot = await this.acquireSlotBlocking();
      slot.currentTaskId = taskId;
      this.emitter.emit("taskStarted", {
        taskId,
        state: "running",
        mode: "oneshot",
        prompt,
        processId: slot.id,
        metadata: options.metadata,
      });

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

      const source = this.tmux.stream(slot.sessionName, request);
      for await (const chunk of this.withStreamTimeout(source, timeoutMs, taskId)) {
        if (this.closed) {
          break;
        }
        output += chunk;
        this.emitter.emit("streamChunk", taskId, chunk);
        yield chunk;
      }
      completed = !this.closed;

      if (completed) {
        this.emitter.emit("taskCompleted", {
          taskId,
          state: "succeeded",
          output,
          processId: slot.id,
          mode: "oneshot",
          startedAt,
          completedAt: Date.now(),
          resumed: false,
          metadata: options.metadata,
        });
      }
    } catch (error) {
      this.emitter.emit("taskFailed", taskId, error instanceof Error ? error : new AgentTaskError(String(error)));
      throw error;
    } finally {
      if (slot !== undefined) {
        // The turn did not finish on its own (consumer broke early, the stream
        // errored or timed out, or the SDK is shutting down): the session may be
        // mid-response, so interrupt it back to a clean prompt rather than
        // returning the slot to the pool where the next task would corrupt it.
        if (!completed && slot.claudeRunning && slot.state !== "stopped" && slot.state !== "failed") {
          try {
            await this.tmux.interrupt(slot.sessionName);
          } catch {
            // Interrupt failed — force a fresh Claude on next use instead of
            // typing into an unknown session state.
            slot.claudeRunning = false;
          }
        }
        // Don't clobber a "stopped"/"failed" state a concurrent cleanup may have set.
        if (slot.state !== "stopped" && slot.state !== "failed") {
          slot.state = "idle";
          slot.currentTaskId = undefined;
          slot.lastUsedAt = Date.now();
        }
      }
      markDone();
      this.activeExecutions.delete(done);
      // Wake the dispatcher: a queued runTask may have been waiting for the slot
      // this stream just released. Without this, it would hang until the next
      // submission triggered dispatch().
      this.dispatch();
    }
  }

  /**
   * Forward an async iterable, rejecting with TaskTimeoutError if no chunk
   * arrives within `timeoutMs` (also catches a fully stalled stream). A
   * non-positive timeout disables the wrapper. Always closes the source iterator
   * when iteration stops early so the underlying poll loop is not left running.
   */
  private async *withStreamTimeout(
    source: AsyncIterable<string>,
    timeoutMs: number,
    taskId: string,
  ): AsyncIterable<string> {
    if (timeoutMs <= 0) {
      yield* source;
      return;
    }

    const iterator = source[Symbol.asyncIterator]();
    const deadline = Date.now() + timeoutMs;
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new TaskTimeoutError(`Task ${taskId} timed out after ${timeoutMs}ms`);
        }
        let timer: NodeJS.Timeout | undefined;
        const next = iterator.next();
        next.catch(() => undefined); // avoid an unhandled rejection if the timeout wins
        let result: IteratorResult<string>;
        try {
          result = await Promise.race([
            next,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new TaskTimeoutError(`Task ${taskId} timed out after ${timeoutMs}ms`)),
                remaining,
              );
            }),
          ]);
        } finally {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
        }
        if (result.done) {
          return;
        }
        yield result.value;
      }
    } finally {
      await iterator.return?.().catch(() => undefined);
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
        this.emitter.emit(
          "taskFailed",
          task.taskId,
          error instanceof Error ? error : new AgentTaskError(String(error)),
        );
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
    for (;;) {
      if (this.closed) {
        throw new AgentTaskError("SDK has been cleaned up");
      }
      const slot = await this.acquireSlot();
      if (slot !== undefined) {
        return slot;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async acquireSlot(): Promise<TmuxSlot | undefined> {
    // Reserve the slot synchronously — flip it to "busy" before any await — so
    // two concurrent acquirers (e.g. the dispatch loop and runStream) can never
    // be handed the same idle slot.
    const idle = this.slots.find((slot) => slot.state === "idle");
    if (idle !== undefined) {
      idle.state = "busy";
      return idle;
    }

    if (this.slots.some((slot) => slot.state === "starting" || slot.state === "restarting")) {
      return undefined;
    }

    const liveSlots = this.slots.filter((slot) => slot.state !== "failed");
    if (liveSlots.length >= this.poolSize) {
      return undefined;
    }

    const slot = await this.startSlot();
    slot.state = "busy";
    return slot;
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
      if (error instanceof TaskTimeoutError || error instanceof TmuxError) {
        // The turn was abandoned mid-response — a per-task timeout
        // (TaskTimeoutError), or the adapter giving up at its completion ceiling
        // / a tmux failure (TmuxError). Claude may still be generating, so exit
        // it and force a fresh start; leaving claudeRunning true would send the
        // next task into a busy/unknown session.
        if (slot.claudeRunning) {
          try {
            await this.tmux.exitClaude(slot.sessionName);
          } catch {
            // best-effort cleanup
          }
          slot.claudeRunning = false;
        }
      }
      // Other failures (bad JSON, non-zero exit, token exhaustion) leave Claude
      // alive at its idle prompt — keep claudeRunning as-is so the next task
      // reuses the live session. Clearing it would make the next startClaude type
      // a launch command into a still-running Claude instead of a shell.
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
    // Single-line augmented prompt: tmux send-keys submits on every newline, so
    // a multi-line user prompt would otherwise send the appended JSON instruction
    // as a separate turn (and the answer would come back as un-instructed prose).
    let prompt = collapseWhitespace(`${task.prompt} ${buildResultInstruction()}`);
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
