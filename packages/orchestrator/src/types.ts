/**
 * Shared types for the orchestrator package.
 */

import type { AgentResult } from "@zyphos/agents";

/** A single step in an orchestration workflow */
export interface OrchestrationStep {
  /** Human-readable name shown in logs */
  name: string;

  /** The agent that will execute this step */
  agent: import("@zyphos/agents").ZyphosAgent;

  /**
   * A function that builds the prompt for this step.
   * Receives accumulated outputs from all prior steps so each agent can
   * build on previous results.
   */
  buildPrompt: (priorOutputs: StepOutputMap) => string;

  /** Optional context data to pass alongside the prompt */
  contextData?: Record<string, unknown>;

  /**
   * For parallel orchestrators: when true this step runs AFTER all
   * parallel steps complete (i.e. it is a sequential "reduce" step).
   * Ignored by SequentialOrchestrator.
   */
  sequential?: boolean;
}

/** Map of step name → its AgentResult, accumulated across the run */
export type StepOutputMap = Record<string, AgentResult>;

/** Status of a single completed step */
export interface StepOutcome {
  stepName: string;
  stepIndex: number;
  status: "completed" | "failed" | "skipped";
  result?: AgentResult;
  error?: string;
  durationMs: number;
}

/** Final result returned by any orchestrator */
export interface OrchestrationResult {
  /** "completed" if all steps succeeded, "partial" if some failed, "failed" if all failed */
  overallStatus: "completed" | "partial" | "failed";

  /** Ordered list of step outcomes */
  steps: StepOutcome[];

  /** Merged map of all step outputs (name → AgentResult) */
  outputs: StepOutputMap;

  /** Total wall-clock duration for the entire orchestration */
  totalDurationMs: number;

  /** ISO 8601 timestamp when the orchestration started */
  startedAt: string;

  /** ISO 8601 timestamp when the orchestration finished */
  completedAt: string;
}
