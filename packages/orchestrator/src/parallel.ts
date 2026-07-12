/**
 * ParallelOrchestrator
 *
 * Runs all non-sequential steps simultaneously via Promise.allSettled, then
 * runs any steps marked sequential:true one-by-one with accumulated context.
 *
 * This is the "v2 full parallel" model from Zyphos's orchestration-runner.ts,
 * stripped of all domain-specific (payroll, employee) logic.
 *
 * Usage:
 *   const orch = new ParallelOrchestrator([
 *     { ...step1 },               // runs in parallel
 *     { ...step2 },               // runs in parallel
 *     { ...step3, sequential: true }, // runs after parallel steps finish
 *   ]);
 *   const result = await orch.run();
 */

import type {
  OrchestrationStep,
  OrchestrationResult,
  StepOutcome,
  StepOutputMap,
} from "./types";

const STEP_OUTPUT_CAP_BYTES = 2_048;

function capOutputs(outputs: StepOutputMap): Record<string, unknown> {
  const full = JSON.stringify(outputs);
  if (full.length <= STEP_OUTPUT_CAP_BYTES) return outputs;

  return Object.fromEntries(
    Object.entries(outputs).map(([k, v]) => {
      const s = JSON.stringify(v);
      return [k, s.length > 400 ? `[truncated ${s.length} chars]` : v];
    })
  );
}

function log(orchestratorName: string, message: string): void {
  const ts = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${ts} [${orchestratorName}] ${message}`);
}

async function runStep(
  step: OrchestrationStep,
  index: number,
  total: number,
  priorOutputs: StepOutputMap,
  orchestratorName: string
): Promise<StepOutcome & { result?: import("@zyphos/agents").AgentResult }> {
  const stepStart = Date.now();
  log(orchestratorName, `Step ${index + 1}/${total}: ${step.name}`);

  try {
    const prompt = step.buildPrompt(capOutputs(priorOutputs) as StepOutputMap);
    const result = await step.agent.run(prompt, {
      data: step.contextData,
      label: step.name,
    });
    const durationMs = Date.now() - stepStart;
    log(orchestratorName, `Step ${step.name} → ${result.success ? "ok" : "failed"} (${durationMs}ms)`);
    return {
      stepName: step.name,
      stepIndex: index,
      status: result.success ? "completed" : "failed",
      result,
      error: result.error,
      durationMs,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - stepStart;
    log(orchestratorName, `Step ${step.name} threw: ${error}`);
    return { stepName: step.name, stepIndex: index, status: "failed", error, durationMs };
  }
}

export class ParallelOrchestrator {
  readonly name: string;
  private readonly steps: OrchestrationStep[];

  constructor(steps: OrchestrationStep[], name = "ParallelOrchestrator") {
    if (steps.length === 0) throw new Error("At least one step is required");
    this.steps = steps;
    this.name = name;
  }

  /**
   * Run all non-sequential steps in parallel, then run sequential steps
   * in order with accumulated context from the parallel phase.
   */
  async run(): Promise<OrchestrationResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const outputs: StepOutputMap = {};
    const allOutcomes: StepOutcome[] = [];

    const parallelSteps = this.steps.filter((s) => !s.sequential);
    const sequentialSteps = this.steps.filter((s) => s.sequential);

    log(
      this.name,
      `Starting: ${parallelSteps.length} parallel + ${sequentialSteps.length} sequential steps`
    );

    // ── Phase 1: Parallel ────────────────────────────────────────────────────
    if (parallelSteps.length > 0) {
      const settled = await Promise.allSettled(
        parallelSteps.map((step, i) =>
          runStep(step, i, this.steps.length, outputs, this.name)
        )
      );

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          const o = outcome.value;
          allOutcomes.push(o);
          if (o.result) outputs[o.stepName] = o.result;
        } else {
          allOutcomes.push({
            stepName: "unknown",
            stepIndex: -1,
            status: "failed",
            error: outcome.reason?.message ?? String(outcome.reason),
            durationMs: 0,
          });
        }
      }
    }

    // ── Phase 2: Sequential (post-parallel) ──────────────────────────────────
    for (let i = 0; i < sequentialSteps.length; i++) {
      const step = sequentialSteps[i];
      const globalIndex = parallelSteps.length + i;
      const outcome = await runStep(
        step,
        globalIndex,
        this.steps.length,
        outputs,
        this.name
      );
      allOutcomes.push(outcome);
      if (outcome.result) outputs[outcome.stepName] = outcome.result;
    }

    const totalDurationMs = Date.now() - startMs;
    const completedAt = new Date().toISOString();
    const successCount = allOutcomes.filter((o) => o.status === "completed").length;

    const overallStatus =
      successCount === this.steps.length
        ? "completed"
        : successCount === 0
        ? "failed"
        : "partial";

    log(
      this.name,
      `Finished — ${successCount}/${this.steps.length} steps succeeded in ${totalDurationMs}ms`
    );

    return {
      overallStatus,
      steps: allOutcomes.sort((a, b) => a.stepIndex - b.stepIndex),
      outputs,
      totalDurationMs,
      startedAt,
      completedAt,
    };
  }
}
