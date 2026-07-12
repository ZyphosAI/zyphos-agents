/**
 * ZyphosAgent — the core agent class.
 *
 * Accepts a config object, exposes a single run(prompt, context?) method,
 * and handles:
 *   • Provider selection (Anthropic first, OpenAI fallback)
 *   • Built-in exponential-backoff retry (default 3 attempts)
 *   • Execution logging with timestamp and duration
 *   • Typed AgentResult return value
 *
 * Usage:
 *   const agent = new ZyphosAgent({ name: "SummaryAgent", systemPrompt: "You summarise text." });
 *   const result = await agent.run("Summarise the following report: ...");
 */

import type {
  AgentConfig,
  AgentContext,
  AgentResult,
  LLMProvider,
} from "./types";
import {
  buildAnthropicClient,
  buildOpenAIClient,
  callAnthropic,
  callOpenAI,
  parseLLMOutput,
} from "./llm";

// Default model names per provider
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

// ── Logger ────────────────────────────────────────────────────────────────────

function logLine(agentName: string, message: string): void {
  const ts = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${ts} [${agentName}] ${message}`);
}

// ── ZyphosAgent ───────────────────────────────────────────────────────────────

export class ZyphosAgent {
  /** Human-readable name for this agent instance */
  readonly name: string;

  private readonly config: Required<
    Pick<
      AgentConfig,
      | "provider"
      | "model"
      | "maxTokens"
      | "maxRetries"
      | "fallbackToOpenAI"
      | "timeoutMs"
    >
  > &
    AgentConfig;

  constructor(config: AgentConfig) {
    this.name = config.name;

    // Apply defaults
    this.config = {
      provider: "anthropic",
      model:
        (config.provider ?? "anthropic") === "openai"
          ? DEFAULT_OPENAI_MODEL
          : DEFAULT_ANTHROPIC_MODEL,
      maxTokens: 4_096,
      maxRetries: 3,
      fallbackToOpenAI: true,
      timeoutMs: 45_000,
      ...config,
    };
  }

  // ── run ─────────────────────────────────────────────────────────────────────

  /**
   * Execute the agent with a given prompt and optional context.
   *
   * @param prompt  - The user-facing instruction for the agent to process.
   * @param context - Optional extra context: prior messages, domain data, labels.
   * @returns       An AgentResult with the LLM output, timing, and metadata.
   */
  async run(prompt: string, context?: AgentContext): Promise<AgentResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    // Build the message list from history + current prompt
    const messages = [
      ...(context?.history ?? []),
      { role: "user" as const, content: this.buildPrompt(prompt, context) },
    ];

    const callParams = {
      systemPrompt: this.config.systemPrompt,
      messages,
      model: this.config.model,
      maxTokens: this.config.maxTokens,
    };

    const label = context?.label ?? prompt.slice(0, 60);
    logLine(this.name, `Starting: "${label}"`);

    let lastError: Error | undefined;
    let retries = 0;

    // ── Anthropic attempts ───────────────────────────────────────────────────
    if (this.config.provider === "anthropic") {
      const anthropic = buildAnthropicClient(this.config);

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const delayMs = Math.min(1_000 * 2 ** attempt, 16_000);
            logLine(this.name, `Retry ${attempt}/${this.config.maxRetries - 1} in ${delayMs}ms`);
            await sleep(delayMs);
          }

          const rawText = await callAnthropic(anthropic, callParams);
          const durationMs = Date.now() - startMs;
          const completedAt = new Date().toISOString();
          logLine(this.name, `Done in ${durationMs}ms (Anthropic / ${this.config.model})`);

          return this.buildResult({
            rawText,
            provider: "anthropic",
            durationMs,
            startedAt,
            completedAt,
            retries,
          });
        } catch (err) {
          retries++;
          lastError = err instanceof Error ? err : new Error(String(err));
          logLine(this.name, `Anthropic error: ${lastError.message}`);
        }
      }
    }

    // ── OpenAI fallback ──────────────────────────────────────────────────────
    if (this.config.fallbackToOpenAI || this.config.provider === "openai") {
      const openaiModel =
        this.config.provider === "openai"
          ? this.config.model
          : DEFAULT_OPENAI_MODEL;

      const openai = buildOpenAIClient(this.config);
      const openaiParams = { ...callParams, model: openaiModel };

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const delayMs = Math.min(1_000 * 2 ** attempt, 16_000);
            logLine(this.name, `OpenAI retry ${attempt}/${this.config.maxRetries - 1} in ${delayMs}ms`);
            await sleep(delayMs);
          }

          const rawText = await callOpenAI(openai, openaiParams);
          const durationMs = Date.now() - startMs;
          const completedAt = new Date().toISOString();
          logLine(this.name, `Done in ${durationMs}ms (OpenAI / ${openaiModel}) [fallback]`);

          return this.buildResult({
            rawText,
            provider: "openai",
            durationMs,
            startedAt,
            completedAt,
            retries,
          });
        } catch (err) {
          retries++;
          lastError = err instanceof Error ? err : new Error(String(err));
          logLine(this.name, `OpenAI error: ${lastError.message}`);
        }
      }
    }

    // All attempts exhausted
    const durationMs = Date.now() - startMs;
    const completedAt = new Date().toISOString();
    logLine(this.name, `Failed after ${retries} attempt(s): ${lastError?.message}`);

    return {
      success: false,
      output: null,
      rawText: "",
      provider: this.config.provider,
      model: this.config.model,
      durationMs,
      startedAt,
      completedAt,
      retries,
      error: lastError?.message ?? "Unknown error",
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildPrompt(prompt: string, context?: AgentContext): string {
    if (!context?.data || Object.keys(context.data).length === 0) return prompt;
    const dataBlock = JSON.stringify(context.data, null, 2);
    return `${prompt}\n\n--- Context Data ---\n${dataBlock}`;
  }

  private buildResult(params: {
    rawText: string;
    provider: LLMProvider;
    durationMs: number;
    startedAt: string;
    completedAt: string;
    retries: number;
  }): AgentResult {
    return {
      success: true,
      output: parseLLMOutput(params.rawText),
      rawText: params.rawText,
      provider: params.provider,
      model: this.config.model,
      durationMs: params.durationMs,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      retries: params.retries,
    };
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
