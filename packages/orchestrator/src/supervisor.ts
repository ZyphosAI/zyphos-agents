/**
 * SupervisorOrchestrator
 *
 * A two-level orchestration pattern:
 *   1. A "manager" agent receives the top-level task and decomposes it into
 *      a list of named subtasks (JSON output).
 *   2. Each subtask is assigned to a "worker" agent and executed (optionally
 *      in parallel).
 *   3. An optional "reducer" agent receives all subtask outputs and produces
 *      a final consolidated response.
 *
 * Usage:
 *   const supervisor = new SupervisorOrchestrator({
 *     name: "ReportSupervisor",
 *     managerAgent: plannerAgent,
 *     workerAgent: writerAgent,
 *     reducerAgent: editorAgent, // optional
 *     task: "Write a competitive analysis report covering pricing, features, and positioning",
 *   });
 *   const result = await supervisor.run();
 */

import { ZyphosAgent } from "@zyphos/agents";
import type { OrchestrationResult, StepOutcome, StepOutputMap } from "./types";

export interface SupervisorConfig {
  /** Human-readable name for logging */
  name?: string;

  /**
   * The manager agent.
   * It receives the task string and must return JSON with a "subtasks" array.
   * Each subtask should be an object with at least a "name" and "prompt" field.
   * Example output:
   *   { "subtasks": [{ "name": "Pricing", "prompt": "Analyse competitor pricing..." }] }
   */
  managerAgent: ZyphosAgent;

  /**
   * The worker agent (or a map of agent name → agent for specialised routing).
   * If a map is provided, each subtask's "agent" field is used to look up the
   * appropriate worker; falls back to the first entry if not found.
   */
  workerAgent: ZyphosAgent | Record<string, ZyphosAgent>;

  /**
   * Optional reducer agent that receives all subtask outputs and produces
   * a consolidated final result. If omitted, the raw subtask outputs are returned.
   */
  reducerAgent?: ZyphosAgent;

  /** The top-level task description given to the manager agent */
  task: string;

  /** Whether to run subtasks in parallel. Defaults to true. */
  parallel?: boolean;

  /** Context data to include when calling the manager agent */
  contextData?: Record<string, unknown>;
}

function log(name: string, message: string): void {
  const ts = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${ts} [${name}] ${message}`);
}

function pickWorker(
  workerAgent: ZyphosAgent | Record<string, ZyphosAgent>,
  agentName?: string
): ZyphosAgent {
  if (workerAgent instanceof ZyphosAgent) return workerAgent;
  if (agentName && agentName in workerAgent) return workerAgent[agentName];
  return Object.values(workerAgent)[0];
}

export class SupervisorOrchestrator {
  readonly name: string;
  private readonly config: SupervisorConfig;

  constructor(config: SupervisorConfig) {
    this.config = config;
    this.name = config.name ?? "SupervisorOrchestrator";
  }

  async run(): Promise<OrchestrationResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const outcomes: StepOutcome[] = [];
    const outputs: StepOutputMap = {};

    // ── Step 1: Manager decomposes the task ──────────────────────────────────
    log(this.name, `Manager planning task: "${this.config.task.slice(0, 80)}"`);
    const managerResult = await this.config.managerAgent.run(
      `You are a task planner. Break the following task into a list of independent subtasks.\n` +
        `Return ONLY valid JSON in this format: { "subtasks": [{ "name": "...", "prompt": "..." }] }\n\n` +
        `Task: ${this.config.task}`,
      { data: this.config.contextData, label: "manager-planning" }
    );

    outputs["__manager__"] = managerResult;

    if (!managerResult.success) {
      return this.buildResult(
        "failed",
        outcomes,
        outputs,
        Date.now() - startMs,
        startedAt
      );
    }

    // Parse subtasks from manager output
    let subtasks: Array<{ name: string; prompt: string; agent?: string }> = [];
    try {
      const parsed =
        typeof managerResult.output === "object" &&
        managerResult.output !== null &&
        "subtasks" in managerResult.output
          ? (managerResult.output as { subtasks: typeof subtasks }).subtasks
          : [];
      subtasks = Array.isArray(parsed) ? parsed : [];
    } catch {
      log(this.name, "Manager returned invalid subtask format");
      return this.buildResult("failed", outcomes, outputs, Date.now() - startMs, startedAt);
    }

    log(this.name, `Manager produced ${subtasks.length} subtasks`);

    // ── Step 2: Workers execute subtasks ─────────────────────────────────────
    const runSubtask = async (
      subtask: (typeof subtasks)[0],
      index: number
    ): Promise<StepOutcome> => {
      const worker = pickWorker(this.config.workerAgent, subtask.agent);
      const stepStart = Date.now();
      log(this.name, `Worker [${index + 1}/${subtasks.length}]: ${subtask.name}`);

      try {
        const result = await worker.run(subtask.prompt, { label: subtask.name });
        const durationMs = Date.now() - stepStart;
        outputs[subtask.name] = result;
        return {
          stepName: subtask.name,
          stepIndex: index,
          status: result.success ? "completed" : "failed",
          result,
          error: result.error,
          durationMs,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          stepName: subtask.name,
          stepIndex: index,
          status: "failed",
          error,
          durationMs: Date.now() - stepStart,
        };
      }
    };

    if (this.config.parallel !== false) {
      const settled = await Promise.allSettled(
        subtasks.map((s, i) => runSubtask(s, i))
      );
      for (const r of settled) {
        if (r.status === "fulfilled") outcomes.push(r.value);
      }
    } else {
      for (let i = 0; i < subtasks.length; i++) {
        outcomes.push(await runSubtask(subtasks[i], i));
      }
    }

    // ── Step 3: Optional reducer consolidates outputs ────────────────────────
    if (this.config.reducerAgent) {
      log(this.name, "Reducer consolidating subtask outputs");
      const reducerPrompt =
        `You received the following outputs from parallel workers. ` +
        `Synthesise them into a single, coherent final response.\n\n` +
        `Outputs:\n${JSON.stringify(
          Object.fromEntries(
            outcomes.map((o) => [o.stepName, o.result?.output ?? o.error])
          ),
          null,
          2
        )}`;

      const reducerResult = await this.config.reducerAgent.run(reducerPrompt, {
        label: "reducer",
      });
      outputs["__reducer__"] = reducerResult;
      outcomes.push({
        stepName: "__reducer__",
        stepIndex: subtasks.length,
        status: reducerResult.success ? "completed" : "failed",
        result: reducerResult,
        error: reducerResult.error,
        durationMs: reducerResult.durationMs,
      });
    }

    const successCount = outcomes.filter((o) => o.status === "completed").length;
    const total = outcomes.length;
    const overallStatus =
      successCount === total ? "completed" : successCount === 0 ? "failed" : "partial";

    log(this.name, `Done — ${successCount}/${total} succeeded in ${Date.now() - startMs}ms`);
    return this.buildResult(overallStatus, outcomes, outputs, Date.now() - startMs, startedAt);
  }

  private buildResult(
    overallStatus: OrchestrationResult["overallStatus"],
    steps: StepOutcome[],
    outputs: StepOutputMap,
    totalDurationMs: number,
    startedAt: string
  ): OrchestrationResult {
    return {
      overallStatus,
      steps,
      outputs,
      totalDurationMs,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
