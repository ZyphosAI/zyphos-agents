/**
 * orchestrated-workflow — chains 3 agents sequentially to process a business task.
 *
 * Pipeline:
 *   1. ResearchAgent  — gathers facts about a topic
 *   2. AnalysisAgent  — identifies key trends from the research
 *   3. ReportAgent    — writes an executive summary from the analysis
 *
 * Run:
 *   cd zyphos-agents
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node examples/orchestrated-workflow/index.ts
 */

import { ZyphosAgent } from "../../packages/agents/src";
import { SequentialOrchestrator } from "../../packages/orchestrator/src";
import type { OrchestrationStep } from "../../packages/orchestrator/src";
import type { StepOutputMap } from "../../packages/orchestrator/src";

async function main() {
  // ── 1. Create three specialised agents ────────────────────────────────────

  // Agent 1: researches a topic and returns structured bullet points
  const researchAgent = new ZyphosAgent({
    name: "ResearchAgent",
    systemPrompt:
      "You are a research analyst. Given a topic, return 5 factual bullet points " +
      'as JSON: { "topic": "...", "facts": ["fact1", "fact2", ...] }',
    model: "claude-3-5-haiku-20241022",
  });

  // Agent 2: takes the research output and identifies business trends
  const analysisAgent = new ZyphosAgent({
    name: "AnalysisAgent",
    systemPrompt:
      "You are a business analyst. Given research facts, identify 3 key business " +
      'trends and risks. Return JSON: { "trends": [...], "risks": [...] }',
    model: "claude-3-5-haiku-20241022",
  });

  // Agent 3: synthesises research + analysis into an executive-ready summary
  const reportAgent = new ZyphosAgent({
    name: "ReportAgent",
    systemPrompt:
      "You are an executive communications specialist. Given research and analysis, " +
      "write a 3-paragraph executive summary in plain English. " +
      'Return JSON: { "title": "...", "summary": "..." }',
    model: "claude-3-5-haiku-20241022",
  });

  // ── 2. Define the orchestration steps ─────────────────────────────────────

  // Each step's buildPrompt() receives a map of all prior step outputs.
  // This lets each agent build directly on what the previous one produced.

  const steps: OrchestrationStep[] = [
    {
      name: "Research",
      agent: researchAgent,
      // First step: no prior outputs, just the initial task
      buildPrompt: (_prior: StepOutputMap) =>
        "Research the business impact of AI agents in enterprise software in 2025-2026.",
    },
    {
      name: "Analysis",
      agent: analysisAgent,
      // Second step: receives the Research agent's output
      buildPrompt: (prior: StepOutputMap) => {
        const research = prior["Research"]?.output ?? "No research available";
        return (
          "Based on the following research, identify the key business trends and risks:\n\n" +
          JSON.stringify(research, null, 2)
        );
      },
    },
    {
      name: "ExecutiveReport",
      agent: reportAgent,
      // Third step: receives both Research and Analysis outputs
      buildPrompt: (prior: StepOutputMap) => {
        const research = prior["Research"]?.output ?? {};
        const analysis = prior["Analysis"]?.output ?? {};
        return (
          "Write an executive summary using the research and analysis below.\n\n" +
          "RESEARCH:\n" +
          JSON.stringify(research, null, 2) +
          "\n\nANALYSIS:\n" +
          JSON.stringify(analysis, null, 2)
        );
      },
    },
  ];

  // ── 3. Run the sequential orchestrator ────────────────────────────────────

  const orchestrator = new SequentialOrchestrator(steps, "AIImpactWorkflow");
  const result = await orchestrator.run();

  // ── 4. Print the results ──────────────────────────────────────────────────

  console.log("\n═══ Orchestration Complete ═══");
  console.log("Overall status:", result.overallStatus);
  console.log("Total duration:", result.totalDurationMs + "ms");
  console.log("");

  // Print each step's outcome
  for (const step of result.steps) {
    const icon = step.status === "completed" ? "✅" : "❌";
    console.log(`${icon} ${step.stepName} (${step.durationMs}ms)`);
    if (step.status === "failed") console.log("   Error:", step.error);
  }

  // Print the final report
  const report = result.outputs["ExecutiveReport"]?.output;
  if (report) {
    console.log("\n═══ Executive Report ═══");
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(console.error);
