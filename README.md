# zyphos-agents

> Open-source agentic framework for deploying AI agents across any business domain.

Extracted from [Zyphos](https://github.com/ZyphosAI/Zyphos) — a production
AI-powered business platform — and generalised into six standalone,
composable packages.

![MIT License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)
![npm](https://img.shields.io/badge/npm-%40zyphos-red)

---

## ⚡ Run your first agent in 5 minutes

**Step 1 — Clone and install**

```bash
git clone https://github.com/ZyphosAI/zyphos-agents.git
cd zyphos-agents
npm install
```

**Step 2 — Add your API key**

```bash
export ANTHROPIC_API_KEY=your_key_here
```

Get a free key at: https://console.anthropic.com

**Step 3 — Run the example**

```bash
npx ts-node examples/basic-agent/index.ts
```

You should see an AI agent response in your terminal within 10 seconds.
That is it — you just ran your first Zyphos agent.

---

## Install in your own project

```bash
npm install @zyphos/agents @zyphos/orchestrator @zyphos/guardrails
```

---

## Packages

| Package | Description |
| --- | --- |
| [`@zyphos/agents`](https://github.com/ZyphosAI/zyphos-agents/blob/main/packages/agents) | Core `ZyphosAgent` class — LLM execution, retry, provider fallback |
| [`@zyphos/orchestrator`](https://github.com/ZyphosAI/zyphos-agents/blob/main/packages/orchestrator) | Sequential, Supervisor, and Parallel orchestration patterns |
| [`@zyphos/guardrails`](https://github.com/ZyphosAI/zyphos-agents/blob/main/packages/guardrails) | PII redaction, Human-in-the-Loop gates, exponential backoff retry |
| [`@zyphos/builder`](https://github.com/ZyphosAI/zyphos-agents/blob/main/packages/builder) | Natural language → React component JSON schema generator |
| [`@zyphos/connector`](https://github.com/ZyphosAI/zyphos-agents/blob/main/packages/connector) | ConnectionAgent, SchemaMappingAgent, SyncAgent, WebhookAgent *(coming soon)* |
| [`@zyphos/analyst`](https://github.com/ZyphosAI/zyphos-agents/blob/main/packages/analyst) | IngestionAgent, QueryAgent, AnomalyAgent, NarrativeAgent *(coming soon)* |

---

## Quick Start (from cloned repo)

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
| --- | --- | --- | --- |
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

```bash
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
  { name: "PricingAnalysis",   agent: pricingAgent,   buildPrompt: () => "Analyse pricing…",  sequential: false },
  { name: "FeatureAnalysis",   agent: featureAgent,   buildPrompt: () => "Analyse features…", sequential: false },
  { name: "SentimentAnalysis", agent: sentimentAgent, buildPrompt: () => "Analyse reviews…",  sequential: false },
  {
    name: "FinalSummary",
    agent: summaryAgent,
    sequential: true, // runs AFTER all parallel steps complete
    buildPrompt: (prior) =>
      `Summarise: ${JSON.stringify({
        pricing:  prior["PricingAnalysis"]?.output,
        features: prior["FeatureAnalysis"]?.output,
      })}`,
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
  workerAgent:  analystAgent,   // executes each subtask
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

const safePrompt = redactor.redact(userInput);
const hasPII    = redactor.hasPII(userInput);  // boolean
const found     = redactor.scan(userInput);    // [{ type, count }]
```

### Human-in-the-Loop Gate

```typescript
import { HumanApprovalGate, InMemoryApprovalAdapter } from "@zyphos/guardrails";

// Use InMemoryApprovalAdapter for testing; implement ApprovalAdapter for production
const adapter = new InMemoryApprovalAdapter();
const gate = new HumanApprovalGate({
  adapter,
  timeoutMs:       5 * 60 * 1000, // 5 minutes
  pollIntervalMs:  3_000,
  timeoutBehavior: "reject",       // safe default
});

const approved = await gate.request({
  id:      "payroll-run-q4",
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
    maxDelayMs:  10_000,
    jitter:      true,
    onRetry: ({ attempt, error, nextDelayMs }) =>
      console.log(`Retry ${attempt}: ${error.message} — waiting ${nextDelayMs}ms`),
    shouldRetry: (err) => !err.message.includes("404"),
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

## 💡 What can you build

| Domain | Example agent workflows |
| --- | --- |
| **HR & People Ops** | Onboarding automation, payroll validation, compliance checks, leave approvals |
| **Finance** | Invoice processing, expense approval, budget variance alerts, audit trail |
| **Supply Chain** | Vendor evaluation, procurement approval, risk assessment, demand forecasting |
| **Sales** | Lead scoring, contract review, commission calculation, pipeline health checks |
| **Operations** | Capacity planning, incident response, shift scheduling, SLA monitoring |
| **Data & Analytics** | Anomaly detection, NL-to-SQL queries, automated weekly narratives, data quality checks |
| **IT** | Access provisioning, device compliance, SSO management, offboarding workflows |
| **Any domain** | The framework is fully domain-agnostic — bring your own business logic |

---

## Project Structure

```
zyphos-agents/
├── packages/
│   ├── agents/         # @zyphos/agents       — ZyphosAgent core
│   ├── orchestrator/   # @zyphos/orchestrator  — Sequential, Parallel, Supervisor
│   ├── guardrails/     # @zyphos/guardrails   — PII, HITL, Retry
│   ├── builder/        # @zyphos/builder       — PageBuilder
│   ├── connector/      # @zyphos/connector     — coming soon
│   └── analyst/        # @zyphos/analyst       — coming soon
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

The following files in the original Zyphos repository contained the AI
agent layer that was extracted and generalised into this package:

| Zyphos file | Extracted into |
| --- | --- |
| `server/orchestration-runner.ts` | `@zyphos/orchestrator` — parallel + sequential step model, step output capping, callAgent() pattern |
| `server/routes.ts` | `@zyphos/agents` — Anthropic/OpenAI client factory, agent execution loop, timeout config; `@zyphos/builder` — page-builder endpoint pattern |
| `server/job-queue.ts` | Retry and job dispatch patterns inform `@zyphos/guardrails/retry.ts` |
| `server/self-healing.ts` | HITL approval gate concept, self-healing patterns |
| `server/scheduler.ts` | Scheduled agent execution pattern documented in orchestrator |
| `server/bull-worker.ts` | Background worker job processing patterns |

All Zyphos-specific concepts (employees, payroll, attendance, companies,
database tables) have been removed and replaced with generic interfaces
any developer can implement.

---

## 🤝 Contributing

We review all pull requests within 48 hours.

1. Fork this repo
2. Create a branch: `git checkout -b feature/your-agent-name`
3. Add your agent blueprint or example in `examples/`
4. Open a Pull Request with a clear description of what it does

**Good first contributions:**

- New agent blueprints for any business domain
- Additional working examples
- Unit tests for any package
- README improvements or translations
- Bug fixes and performance improvements

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## 💬 Community

- **GitHub Issues** — [Report bugs or request features](https://github.com/kirankshetty/zyphos-agents/issues)
- **Discussions** — [Ask questions and share ideas](https://github.com/kirankshetty/zyphos-agents/discussions)
- **Website** — [zyphos.ai](https://zyphos.ai) (coming soon..)

---

## License

MIT © 2026 ZyphosAI
