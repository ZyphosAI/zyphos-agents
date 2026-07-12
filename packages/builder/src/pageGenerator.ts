/**
 * PageBuilder — Natural Language UI Definition Generator
 *
 * Takes a plain English description of a UI ("create a table showing
 * employee names and salaries with a search bar") and uses the Anthropic
 * SDK to generate a React component definition as a JSON schema.
 *
 * The output is a JSON schema — NOT actual JSX — so any frontend framework
 * can render it. This makes the builder framework-agnostic.
 *
 * Extracted and generalised from Zyphos's AI page-builder route pattern.
 *
 * Usage:
 *   const builder = new PageBuilder({ anthropicApiKey: process.env.ANTHROPIC_API_KEY });
 *   const schema = await builder.generate("A dashboard card showing total revenue");
 *   console.log(schema); // { type: "Card", props: { title: "Total Revenue", ... } }
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Component schema types ────────────────────────────────────────────────────

/** Primitive prop value types */
export type PropValue =
  | string
  | number
  | boolean
  | null
  | PropValue[]
  | { [key: string]: PropValue };

/**
 * A JSON-serialisable component definition.
 * Any frontend can interpret this schema to render the appropriate React component.
 */
export interface ComponentDefinition {
  /** Component type identifier (e.g. "Table", "Card", "Form", "Chart") */
  type: string;

  /** Display label shown in the UI builder */
  label?: string;

  /** Human-readable description of what this component does */
  description?: string;

  /** Static props for this component instance */
  props: Record<string, PropValue>;

  /**
   * Column/field definitions for tabular or form components.
   * Each entry maps a field name to a display label and optional metadata.
   */
  columns?: Array<{
    key: string;
    label: string;
    type?: "text" | "number" | "date" | "boolean" | "currency" | "badge";
    sortable?: boolean;
    filterable?: boolean;
  }>;

  /**
   * Actions (buttons, links) available on this component.
   */
  actions?: Array<{
    id: string;
    label: string;
    type?: "primary" | "secondary" | "danger" | "ghost";
    icon?: string;
  }>;

  /** Nested child component definitions */
  children?: ComponentDefinition[];

  /**
   * Data source hint for the rendering layer to wire up the component.
   * e.g. { endpoint: "/api/employees", method: "GET" }
   */
  dataSource?: {
    endpoint?: string;
    method?: "GET" | "POST";
    queryParams?: Record<string, string>;
  };

  /** Layout hints */
  layout?: {
    width?: "full" | "half" | "third" | "quarter" | "auto";
    span?: number; // grid column span
    order?: number;
  };
}

/**
 * The full page definition returned by PageBuilder.generate().
 */
export interface PageDefinition {
  /** Page title */
  title: string;

  /** Optional descriptive subtitle */
  description?: string;

  /** Top-level component definitions — rendered in order */
  components: ComponentDefinition[];

  /** ISO 8601 timestamp when this definition was generated */
  generatedAt: string;

  /** The original natural language prompt that produced this definition */
  prompt: string;
}

// ── PageBuilder config ────────────────────────────────────────────────────────

export interface PageBuilderConfig {
  /**
   * Anthropic API key.
   * Falls back to ANTHROPIC_API_KEY or AI_INTEGRATIONS_ANTHROPIC_API_KEY env vars.
   */
  anthropicApiKey?: string;

  /** Optional base URL override (e.g. Replit AI Integrations proxy) */
  anthropicBaseUrl?: string;

  /**
   * Anthropic model to use.
   * Defaults to "claude-sonnet-4-5".
   */
  model?: string;

  /** Request timeout in milliseconds. Defaults to 60 000 (60 s). */
  timeoutMs?: number;

  /**
   * Maximum tokens for the response.
   * Defaults to 4096.
   */
  maxTokens?: number;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const PAGE_BUILDER_SYSTEM_PROMPT = `You are a UI schema generator. Your job is to convert plain English UI descriptions
into a structured JSON schema that defines React components.

Rules:
1. Return ONLY valid JSON — no markdown, no prose, no code fences.
2. The root object must match the PageDefinition schema exactly.
3. Use common component types: Table, Card, Form, Chart, SearchBar, Button, Badge,
   Metric, Timeline, List, Grid, Modal, Tabs, Select, DatePicker.
4. For each component, include realistic props, column definitions, and actions
   that make sense for the described UI.
5. Be specific: if the user mentions "employee names and salaries", include
   "name" and "salary" columns with appropriate types.
6. Add a "dataSource" hint when it makes sense (e.g. tables and lists).
7. The "layout" field should arrange components sensibly on a page.

PageDefinition schema:
{
  "title": "string",
  "description": "string (optional)",
  "components": [ComponentDefinition],
  "generatedAt": "ISO 8601 string",
  "prompt": "the original user prompt"
}

ComponentDefinition schema:
{
  "type": "string",
  "label": "string (optional)",
  "description": "string (optional)",
  "props": { key: value },
  "columns": [{ "key": "string", "label": "string", "type": "...", "sortable": bool }],
  "actions": [{ "id": "string", "label": "string", "type": "primary|secondary|danger|ghost" }],
  "children": [ComponentDefinition],
  "dataSource": { "endpoint": "string", "method": "GET|POST" },
  "layout": { "width": "full|half|third|quarter|auto", "span": number, "order": number }
}`;

// ── PageBuilder ───────────────────────────────────────────────────────────────

export class PageBuilder {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: PageBuilderConfig = {}) {
    const apiKey =
      config.anthropicApiKey ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Anthropic API key not found. Set anthropicApiKey in PageBuilderConfig " +
          "or the ANTHROPIC_API_KEY environment variable."
      );
    }

    const baseURL =
      config.anthropicBaseUrl ??
      (process.env.ANTHROPIC_API_KEY
        ? undefined
        : process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);

    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      timeout: config.timeoutMs ?? 60_000,
    });

    this.model = config.model ?? "claude-sonnet-4-5";
    this.maxTokens = config.maxTokens ?? 4_096;
  }

  /**
   * Generate a PageDefinition JSON schema from a plain English UI description.
   *
   * @param prompt - Natural language description of the UI to generate.
   *   Examples:
   *     "A table showing employee names, departments, and salaries with a search bar"
   *     "A dashboard with total revenue, active users, and a recent orders list"
   *     "A form for creating a new project with name, description, and due date fields"
   *
   * @returns A PageDefinition object ready to render.
   */
  async generate(prompt: string): Promise<PageDefinition> {
    const now = new Date().toISOString();

    const userMessage =
      `Generate a PageDefinition JSON schema for the following UI:\n\n${prompt}\n\n` +
      `Set "generatedAt" to "${now}" and "prompt" to the exact text above.`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: PAGE_BUILDER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new Error("Anthropic returned no text content");
    }

    const raw = block.text
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    try {
      return JSON.parse(raw) as PageDefinition;
    } catch {
      throw new Error(
        `PageBuilder received invalid JSON from the model.\nRaw response:\n${raw.slice(0, 500)}`
      );
    }
  }

  /**
   * Generate multiple page definitions in parallel (e.g. for different sections).
   *
   * @param prompts - Array of plain English UI descriptions.
   * @returns Array of PageDefinitions in the same order as the input prompts.
   */
  async generateBatch(prompts: string[]): Promise<PageDefinition[]> {
    return Promise.all(prompts.map((p) => this.generate(p)));
  }
}
