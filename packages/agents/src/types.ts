/**
 * Core type definitions for zyphos-agents.
 * These are intentionally generic — implement them for your own domain.
 */

/** The LLM provider to use for a given agent */
export type LLMProvider = "anthropic" | "openai";

/** Anthropic model identifiers */
export type AnthropicModel =
  | "claude-opus-4-5"
  | "claude-sonnet-4-5"
  | "claude-3-5-haiku-20241022"
  | "claude-3-haiku-20240307"
  | string;

/** OpenAI model identifiers */
export type OpenAIModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "gpt-3.5-turbo"
  | string;

/**
 * Configuration for a ZyphosAgent instance.
 * Pass this to the ZyphosAgent constructor.
 */
export interface AgentConfig {
  /** Human-readable name for this agent (used in logs) */
  name: string;

  /** Preferred LLM provider. Defaults to "anthropic". */
  provider?: LLMProvider;

  /** Model to use. Defaults to "claude-sonnet-4-5" for Anthropic, "gpt-4o" for OpenAI. */
  model?: string;

  /** Optional system prompt to ground the agent's behaviour */
  systemPrompt?: string;

  /** Maximum tokens to generate. Defaults to 4096. */
  maxTokens?: number;

  /**
   * Anthropic API key.
   * Falls back to ANTHROPIC_API_KEY or AI_INTEGRATIONS_ANTHROPIC_API_KEY env vars.
   */
  anthropicApiKey?: string;

  /**
   * OpenAI API key.
   * Falls back to OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY env vars.
   */
  openaiApiKey?: string;

  /** Optional base URL override (e.g. for Replit AI Integrations proxy) */
  anthropicBaseUrl?: string;

  /** Optional base URL override for OpenAI-compatible endpoints */
  openaiBaseUrl?: string;

  /** Number of retry attempts on failure. Defaults to 3. */
  maxRetries?: number;

  /** Whether to fall back to OpenAI when Anthropic fails. Defaults to true. */
  fallbackToOpenAI?: boolean;

  /** Request timeout in milliseconds. Defaults to 45 000 (45 s). */
  timeoutMs?: number;
}

/**
 * The result returned by ZyphosAgent.run().
 */
export interface AgentResult {
  /** Whether the agent completed without an unrecoverable error */
  success: boolean;

  /** Parsed JSON output (if the LLM returned valid JSON) or a raw string wrapper */
  output: unknown;

  /** Raw text content from the LLM */
  rawText: string;

  /** Which provider ultimately produced the result */
  provider: LLMProvider;

  /** Which model was used */
  model: string;

  /** Wall-clock duration of the LLM call in milliseconds */
  durationMs: number;

  /** ISO 8601 timestamp of when the run started */
  startedAt: string;

  /** ISO 8601 timestamp of when the run finished */
  completedAt: string;

  /** Number of retries used (0 = first attempt succeeded) */
  retries: number;

  /** Error message if success === false */
  error?: string;
}

/**
 * A single message in a multi-turn conversation context.
 * Pass a history array to agent.run() to maintain conversation state.
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Context object passed into agent.run() alongside the prompt.
 * All fields are optional — include only what the agent needs.
 */
export interface AgentContext {
  /** Prior conversation turns, in chronological order */
  history?: ConversationMessage[];

  /** Domain-specific key/value data the agent should reason over */
  data?: Record<string, unknown>;

  /** Unique identifier for the caller (for tracing) */
  callerId?: string;

  /** Human-readable label for logging / execution tracing */
  label?: string;
}
