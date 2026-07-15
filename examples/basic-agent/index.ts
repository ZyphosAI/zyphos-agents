/**
 * basic-agent — minimal example showing how to run a single ZyphosAgent.
 *
 * Run:
 *   cd zyphos-agents
 *   npm install
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node examples/basic-agent/index.ts
 */

// Import the agent class from the @zyphos/agents package
import { ZyphosAgent } from "../../packages/agents/src";

async function main() {
  // 1. Create an agent with a name and an optional system prompt.
  //    The system prompt grounds the agent's behaviour for a specific role.
  const agent = new ZyphosAgent({
    name: "SummaryAgent",
    systemPrompt:
      "You are a concise summariser. Return a JSON object with keys " +
      '"summary" (2-3 sentences) and "keywords" (array of 5 key terms).',
    // Anthropic is the default provider. Falls back to OpenAI automatically.
    provider: "anthropic",
    maxTokens: 512,
  });

  // 2. Call agent.run() with a plain English prompt.
  //    Optionally pass context.data for extra domain-specific information.
  const result = await agent.run(
    "Summarise the following text:\n\n" +
      "Artificial intelligence is transforming every industry. " +
      "Large language models can now understand complex instructions, " +
      "generate code, write documents, and reason across domains. " +
      "Enterprises are deploying AI agents to automate workflows, " +
      "reduce operational costs, and surface insights from data at scale.",
    {
      // Optional: label appears in log output for tracing
      label: "AI industry summary",
    }
  );

  // 3. Check whether the agent succeeded and inspect the result.
  if (result.success) {
    console.log("\n✅ Agent completed successfully");
    console.log("Provider used:", result.provider, "/", result.model);
    console.log("Duration:", result.durationMs + "ms");
    console.log("Output:", JSON.stringify(result.output, null, 2));
  } else {
    console.error("\n❌ Agent failed:", result.error);
  }
}

main().catch(console.error);
