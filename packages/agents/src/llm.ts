/**
 * Low-level LLM client factory.
 *
 * Provides thin wrappers around Anthropic and OpenAI SDKs so the rest of
 * the framework never imports the SDKs directly — all configuration and
 * timeout wiring happens here.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AgentConfig } from "./types";

// ── Anthropic ─────────────────────────────────────────────────────────────────

/**
 * Build an Anthropic client from the agent config.
 * Resolves credentials from config → env vars in that order.
 */
export function buildAnthropicClient(config: AgentConfig): Anthropic {
  const apiKey =
    config.anthropicApiKey ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Anthropic API key not found. Set anthropicApiKey in AgentConfig, " +
        "or set the ANTHROPIC_API_KEY environment variable."
    );
  }

  const baseURL =
    config.anthropicBaseUrl ??
    (process.env.ANTHROPIC_API_KEY
      ? undefined
      : process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);

  return new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: config.timeoutMs ?? 45_000,
  });
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

/**
 * Build an OpenAI client from the agent config.
 * Resolves credentials from config → env vars in that order.
 */
export function buildOpenAIClient(config: AgentConfig): OpenAI {
  const apiKey =
    config.openaiApiKey ??
    process.env.OPENAI_API_KEY ??
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OpenAI API key not found. Set openaiApiKey in AgentConfig, " +
        "or set the OPENAI_API_KEY environment variable."
    );
  }

  const baseURL =
    config.openaiBaseUrl ??
    (process.env.OPENAI_API_KEY
      ? undefined
      : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: config.timeoutMs ?? 45_000,
  });
}

// ── Invocation ────────────────────────────────────────────────────────────────

export interface LLMCallParams {
  systemPrompt?: string;
  /** Full conversation including the current user turn */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model: string;
  maxTokens: number;
}

/**
 * Call Anthropic's Messages API and return the raw text response.
 */
export async function callAnthropic(
  client: Anthropic,
  params: LLMCallParams
): Promise<string> {
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
    messages: params.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Anthropic returned no text content");
  }
  return block.text;
}

/**
 * Call OpenAI's Chat Completions API and return the raw text response.
 */
export async function callOpenAI(
  client: OpenAI,
  params: LLMCallParams
): Promise<string> {
  const systemMessages: Array<{ role: "system"; content: string }> =
    params.systemPrompt
      ? [{ role: "system", content: params.systemPrompt }]
      : [];

  const response = await client.chat.completions.create({
    model: params.model,
    max_tokens: params.maxTokens,
    messages: [
      ...systemMessages,
      ...params.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned no content");
  }
  return content;
}

// ── JSON parsing helper ───────────────────────────────────────────────────────

/**
 * Try to parse JSON from a raw LLM string.
 * Strips common Markdown code fences (```json ... ```) before parsing.
 * Returns the parsed value, or wraps the raw string in { response } if parsing fails.
 */
export function parseLLMOutput(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    return { response: raw };
  }
}
