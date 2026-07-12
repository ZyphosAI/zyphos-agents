# zyphos-agents

> Open-source agentic framework for deploying AI agents across any business domain.

Extracted from [Zyphos](https://github.com/kirankshetty/Zyphos) — a production AI-powered business platform — and generalised into four standalone, composable packages.

---

## Packages

| Package | Description |
|---|---|
| [`@zyphos/agents`](packages/agents) | Core `ZyphosAgent` class — LLM execution, retry, provider fallback |
| [`@zyphos/orchestrator`](packages/orchestrator) | Sequential, Supervisor, and Parallel orchestration patterns |
| [`@zyphos/guardrails`](packages/guardrails) | PII redaction, Human-in-the-Loop gates, exponential backoff retry |
| [`@zyphos/builder`](packages/builder) | Natural language → React component JSON schema generator |

---

## Quick Start

```bash
cd zyphos-agents
npm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run the basic agent example
npx ts-node examples/basic-agent/index.ts

# Run the 3-agent sequential workflow
npx ts-node examples/orchestrated-workflow/index.ts

# Run the page builder
npx ts-node examples/page-builder/index.ts
```

---

## `@zyphos/agents` — Core Agent

```typescript
import { ZyphosAgent } from "@zyphos/agents";

const agent = new ZyphosAgent({
  name: "SummaryAgent",
  systemPrompt: "You summarise text. Return JSON: { summary, keywords }",
  provider: "anthropic",          // "anthropic" (default) | "openai"
  model: "claude-sonnet-4-5",
  maxRetries: 3,                  // exponential backoff, auto-enabled
  fallbackToOpenAI: true,         // falls back if Anthropic fails
});

const result = await agent.run("Summarise the Q3 earnings report: ...");

if (result.success) {
  console.log(result.output);     // parsed JSON or { response: rawText }
  console.log(result.durationMs); // wall-clock ms
  console.log(result.provider);   // which provider was actually used
}
```

### `AgentConfig` options

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Human-readable name for logging |
| `provider` | `"anthropic" \| "openai"` | `"anthropic"` | Preferred LLM provider |
| `model` | `string` | `claude-sonnet-4-5` | Model identifier |
| `systemPrompt` | `string` | — | System prompt for the agent |
| `maxTokens` | `number` | `4096` | Max tokens to generate |
| `maxRetries` | `number` | `3` | Retry attempts per provider |
| `fallbackToOpenAI` | `boolean` | `true` | Fallback to OpenAI if Anthropic fails |
| `timeoutMs` | `number` | `45000` | Request timeout in ms |
| `anthropicApiKey` | `string` | env var | Override API key |
| `openaiApiKey` | `string` | env var | Override API key |

### Environment variables

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Replit AI Integrations (no key needed — provided by Replit):
AI_INTEGRATIONS_ANTHROPIC_API_KEY=...
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=...
AI_INTEGRATIONS_OPENAI_API_KEY=...
AI_INTEGRATIONS_OPENAI_BASE_URL=...
```

---

## `@zyphos/orchestrator` — Workflow Patterns

### Sequential — chain agents, pass outputs downstream

```typescript
import { ZyphosAgent } from "@zyphos/agents";
import { SequentialOrchestrator } from "@zyphos/orchestrator";

const steps = [
  {
    name: "Research",
    agent: researchAgent,
    buildPrompt: (_prior) => "Research AI trends in 2026",
  },
  {
    name: "Analysis",
    agent: analysisAgent,
    buildPrompt: (prior) =>
      `Analyse this research: ${JSON.stringify(prior["Research"]?.output)}`,
  },
  {
    name: "Report",
    agent: reportAgent,
    buildPrompt: (prior) =>
      `Write an executive report. Research: ${JSON.stringify(prior["Research"]?.output)}\n` +
      `Analysis: ${JSON.stringify(prior["Analysis"]?.output)}`,
  },
];

const result = await new SequentialOrchestrator(steps).run();
console.log(result.overallStatus); // "completed" | "partial" | "failed"
console.log(result.outputs["Report"].output);
```

### Parallel — run agents simultaneously, reduce results

```typescript
import { ParallelOrchestrator } from "@zyphos/orchestrator";

const steps = [
  { name: "PricingAnalysis",   agent: pricingAgent,   buildPrompt: () => "Analyse pricing…", sequential: false },
  { name: "FeatureAnalysis",   agent: featureAgent,   buildPrompt: () => "Analyse features…", sequential: false },
  { name: "SentimentAnalysis", agent: sentimentAgent, buildPrompt: () => "Analyse reviews…", sequential: false },
  {
    name: "FinalSummary",
    agent: summaryAgent,
    sequential: true, // runs AFTER all parallel steps complete
    buildPrompt: (prior) =>
      `Summarise: ${JSON.stringify({ pricing: prior["PricingAnalysis"]?.output, features: prior["FeatureAnalysis"]?.output })}`,
  },
];

const result = await new ParallelOrchestrator(steps).run();
```

### Supervisor — manager decomposes, workers execute

```typescript
import { SupervisorOrchestrator } from "@zyphos/orchestrator";

const supervisor = new SupervisorOrchestrator({
  name: "CompetitiveAnalysis",
  managerAgent: plannerAgent,   // breaks task into subtasks
  workerAgent: analystAgent,    // executes each subtask
  reducerAgent: editorAgent,    // optional: consolidates outputs
  task: "Write a competitive analysis report for Acme Corp covering pricing, features, and positioning",
  parallel: true,               // run subtasks in parallel
});

const result = await supervisor.run();
```

---

## `@zyphos/guardrails` — Safety & Reliability

### PII Redaction

```typescript
import { redactPII, PIIRedactor } from "@zyphos/guardrails";

// Quick usage — redacts emails, phones, SSNs, credit cards by default
const safe = redactPII("Contact alice@example.com or call 555-123-4567");
// → "Contact [REDACTED_EMAIL] or call [REDACTED_PHONE]"

// Configurable
const redactor = new PIIRedactor({
  redactEmails: true,
  redactPhones: true,
  redactSSNs: true,
  redactCreditCards: false,
  customPatterns: [
    { pattern: /EMP-\d{6}/g, label: "EMPLOYEE_ID" },
  ],
});

const safetPrompt = redactor.redact(userInput);
const hasPII = redactor.hasPII(userInput);       // boolean
const found  = redactor.scan(userInput);          // [{ type, count }]
```

### Human-in-the-Loop Gate

```typescript
import { HumanApprovalGate, InMemoryApprovalAdapter } from "@zyphos/guardrails";

// Use InMemoryApprovalAdapter for testing; implement ApprovalAdapter for production
const adapter = new InMemoryApprovalAdapter();
const gate = new HumanApprovalGate({
  adapter,
  timeoutMs: 5 * 60 * 1000,  // 5 minutes
  pollIntervalMs: 3_000,
  timeoutBehavior: "reject",  // safe default
});

// In your workflow:
const approved = await gate.request({
  id: "payroll-run-q4",
  summary: "Agent wants to trigger payroll run for 250 employees totalling $450,000. Approve?",
  payload: { agentId: "PayrollAgent", employeeCount: 250, totalAmount: 450_000 },
});

if (!approved) throw new Error("Human rejected the payroll run");
// continue workflow…
```

### Retry with Exponential Backoff

```typescript
import { withRetry, createRetryable } from "@zyphos/guardrails";

// Wrap any async call:
const data = await withRetry(
  () => fetch("https://api.example.com/data").then(r => r.json()),
  {
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
    jitter: true,
    onRetry: ({ attempt, error, nextDelayMs }) =>
      console.log(`Retry ${attempt}: ${error.message} — waiting ${nextDelayMs}ms`),
    shouldRetry: (err) => !err.message.includes("404"), // don't retry 404s
  }
);

// Or create a persistent retryable function:
const reliableFetch = createRetryable(fetch, { maxAttempts: 3 });
```

---

## `@zyphos/builder` — Natural Language UI Generation

```typescript
import { PageBuilder } from "@zyphos/builder";

const builder = new PageBuilder({ model: "claude-sonnet-4-5" });

const schema = await builder.generate(
  "A searchable table of employees with name, department, salary columns. " +
  "Add Export CSV and Add Employee buttons."
);

// schema is a PageDefinition JSON object — NOT JSX
// { title, description, components: [{ type, label, columns, actions, props, ... }] }

console.log(schema.components[0].type);    // "Table"
console.log(schema.components[0].columns); // [{ key, label, type, sortable }]
console.log(schema.components[0].actions); // [{ id, label, type }]
```

---

## Project Structure

```
zyphos-agents/
├── packages/
│   ├── agents/         # @zyphos/agents      — ZyphosAgent core
│   ├── orchestrator/   # @zyphos/orchestrator — Sequential, Parallel, Supervisor
│   ├── guardrails/     # @zyphos/guardrails  — PII, HITL, Retry
│   └── builder/        # @zyphos/builder      — PageBuilder
├── examples/
│   ├── basic-agent/            — single agent in 10 lines
│   ├── orchestrated-workflow/  — 3-agent sequential pipeline
│   └── page-builder/           — UI definition from plain English
├── package.json    — workspace root
├── tsconfig.json   — composite TypeScript config
├── LICENSE         — MIT
└── README.md
```

---

## Where the Logic Came From

The following files in the original Zyphos repository contained the AI agent layer that was extracted and generalised into this package:

| Zyphos file | Extracted into |
|---|---|
| `server/orchestration-runner.ts` | `@zyphos/orchestrator` — parallel + sequential step model, step output capping, callAgent() pattern |
| `server/routes.ts` | `@zyphos/agents` — Anthropic/OpenAI client factory, agent execution loop, timeout config; `@zyphos/builder` — page-builder endpoint pattern |
| `server/job-queue.ts` | Retry and job dispatch patterns inform `@zyphos/guardrails/retry.ts` |
| `server/self-healing.ts` | HITL approval gate concept, self-healing patterns |
| `server/scheduler.ts` | Scheduled agent execution pattern documented in orchestrator |
| `server/bull-worker.ts` | Background worker job processing patterns |

All Zyphos-specific concepts (employees, payroll, attendance, companies, database tables) have been removed and replaced with generic interfaces any developer can implement.

---

## License

MIT © 2026 ZyphosAI
