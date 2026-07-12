/**
 * SequentialOrchestrator
 *
 * Runs a list of agents one after another, in order.
 * Each agent's prompt builder receives the accumulated outputs from all
 * preceding agents, so context flows naturally through the pipeline.
 *
 * Extracted from Zyphos's orchestration-runner.ts sequential step pattern
 * and made domain-agnostic.
 *
 * Usage:
 *   const orch = new SequentialOrchestrator([step1, step2, step3]);
 *   const result = await orch.run();
 */

import type {
  OrchestrationStep,
  OrchestrationResult,
  StepOutcome,
  StepOutputMap,
} from "./types";

const STEP_OUTPUT_CAP_BYTES = 2_048;

/** Cap accumulated outputs to avoid bloating downstream prompts */
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

export class SequentialOrchestrator {
  readonly name: string;
  private readonly steps: OrchestrationStep[];

  constructor(steps: OrchestrationStep[], name = "SequentialOrchestrator") {
    if (steps.length === 0) throw new Error("At least one step is required");
    this.steps = steps;
    this.name = name;
  }

  /**
   * Execute all steps in order.
   * Each step receives the accumulated outputs from prior steps in its prompt builder.
   */
  async run(): Promise<OrchestrationResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const outcomes: StepOutcome[] = [];
    const outputs: StepOutputMap = {};

    log(this.name, `Starting ${this.steps.length}-step sequential run`);

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const stepStart = Date.now();

      log(this.name, `Step ${i + 1}/${this.steps.length}: ${step.name}`);

      try {
        const prompt = step.buildPrompt(capOutputs(outputs) as StepOutputMap);
        const result = await step.agent.run(prompt, {
          data: step.contextData,
          label: step.name,
        });

        outputs[step.name] = result;
        const durationMs = Date.now() - stepStart;

        outcomes.push({
          stepName: step.name,
          stepIndex: i,
          status: result.success ? "completed" : "failed",
          result,
          error: result.error,
          durationMs,
        });

        if (!result.success) {
          log(this.name, `Step ${step.name} failed: ${result.error}`);
        } else {
          log(this.name, `Step ${step.name} completed in ${durationMs}ms`);
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - stepStart;
        log(this.name, `Step ${step.name} threw: ${error}`);
        outcomes.push({
          stepName: step.name,
          stepIndex: i,
          status: "failed",
          error,
          durationMs,
        });
      }
    }

    const totalDurationMs = Date.now() - startMs;
    const completedAt = new Date().toISOString();
    const successCount = outcomes.filter((o) => o.status === "completed").length;

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

    return { overallStatus, steps: outcomes, outputs, totalDurationMs, startedAt, completedAt };
  }
}
