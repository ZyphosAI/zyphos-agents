/**
 * Human-in-the-Loop (HITL) Approval Gate
 *
 * Pauses workflow execution and emits an event asking for human confirmation.
 * The gate can be wired to any approval backend (webhook, email, database
 * polling, WebSocket push) by passing an ApprovalAdapter.
 *
 * Extracted from the Zyphos HITL pattern and generalised for any domain.
 *
 * Usage (polling adapter example):
 *
 *   const gate = new HumanApprovalGate({
 *     adapter: myDatabasePollingAdapter,
 *     timeoutMs: 5 * 60 * 1000, // 5-minute deadline
 *     pollIntervalMs: 5_000,
 *   });
 *
 *   const approved = await gate.request({
 *     id: "task-123",
 *     summary: "Agent wants to send payroll run for 250 employees. Approve?",
 *     payload: { agentId: "PayrollAgent", amount: 450_000 },
 *   });
 *
 *   if (!approved) throw new Error("Human rejected the action");
 */

import { EventEmitter } from "events";

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Implement this interface to connect the gate to your approval backend.
 */
export interface ApprovalAdapter {
  /**
   * Called when the gate needs a human decision.
   * Implement this to send an email, Slack message, push notification, etc.
   * Should NOT block — store the request and let the human respond asynchronously.
   */
  requestApproval(request: ApprovalRequest): Promise<void>;

  /**
   * Called repeatedly by the gate to check whether a decision has been made.
   * Return "pending" until the human responds, then "approved" or "rejected".
   */
  pollDecision(requestId: string): Promise<"pending" | "approved" | "rejected">;

  /**
   * Called when the gate times out waiting for a human decision.
   * Use to update your backend records and notify the approver.
   */
  onTimeout?(requestId: string): Promise<void>;
}

// ── Request / result types ────────────────────────────────────────────────────

export interface ApprovalRequest {
  /** Unique identifier for this approval request */
  id: string;

  /** Human-readable description of what is being approved */
  summary: string;

  /** Domain-specific payload for display in your approval UI */
  payload?: Record<string, unknown>;

  /** ISO 8601 timestamp set automatically by the gate */
  requestedAt?: string;
}

export interface ApprovalGateConfig {
  /** The backend adapter that handles approval notifications and polling */
  adapter: ApprovalAdapter;

  /**
   * Maximum time (ms) to wait for a human decision before timing out.
   * Default: 10 minutes (600 000 ms).
   * On timeout the gate returns false (rejected by default) and calls adapter.onTimeout().
   */
  timeoutMs?: number;

  /**
   * How frequently (ms) to poll the adapter for a decision.
   * Default: 5 000 ms (5 seconds).
   */
  pollIntervalMs?: number;

  /**
   * What to return when the gate times out: "reject" (default) or "approve".
   * Most workflows should reject on timeout for safety.
   */
  timeoutBehavior?: "reject" | "approve";
}

// ── Events ────────────────────────────────────────────────────────────────────

export type HumanApprovalGateEvents = {
  /** Fired when an approval request is submitted to the adapter */
  requested: [request: ApprovalRequest];
  /** Fired when a human approves the request */
  approved: [requestId: string];
  /** Fired when a human rejects the request */
  rejected: [requestId: string, reason?: string];
  /** Fired when the gate times out waiting for a decision */
  timedOut: [requestId: string];
};

// ── HumanApprovalGate ─────────────────────────────────────────────────────────

export class HumanApprovalGate extends EventEmitter {
  private readonly config: Required<Omit<ApprovalGateConfig, "adapter">> & {
    adapter: ApprovalAdapter;
  };

  constructor(config: ApprovalGateConfig) {
    super();
    this.config = {
      timeoutMs: config.timeoutMs ?? 10 * 60 * 1_000,
      pollIntervalMs: config.pollIntervalMs ?? 5_000,
      timeoutBehavior: config.timeoutBehavior ?? "reject",
      adapter: config.adapter,
    };
  }

  /**
   * Submit an approval request and wait for a human decision.
   *
   * @returns true if approved, false if rejected or timed out.
   */
  async request(req: ApprovalRequest): Promise<boolean> {
    const request: ApprovalRequest = {
      ...req,
      requestedAt: new Date().toISOString(),
    };

    // Notify the adapter (send email, Slack, etc.)
    await this.config.adapter.requestApproval(request);
    this.emit("requested", request);

    // Poll until decision or timeout
    const deadline = Date.now() + this.config.timeoutMs;

    return new Promise<boolean>((resolve) => {
      const poll = setInterval(async () => {
        if (Date.now() >= deadline) {
          clearInterval(poll);
          await this.config.adapter.onTimeout?.(request.id);
          this.emit("timedOut", request.id);
          resolve(this.config.timeoutBehavior === "approve");
          return;
        }

        try {
          const decision = await this.config.adapter.pollDecision(request.id);
          if (decision === "approved") {
            clearInterval(poll);
            this.emit("approved", request.id);
            resolve(true);
          } else if (decision === "rejected") {
            clearInterval(poll);
            this.emit("rejected", request.id);
            resolve(false);
          }
          // "pending" → keep polling
        } catch {
          // Network/DB error during poll — keep trying until deadline
        }
      }, this.config.pollIntervalMs);
    });
  }
}

// ── Built-in adapters ─────────────────────────────────────────────────────────

/**
 * In-memory approval adapter for testing.
 * Call InMemoryApprovalAdapter.decide(id, "approved" | "rejected") from your test
 * to simulate a human responding.
 */
export class InMemoryApprovalAdapter implements ApprovalAdapter {
  private decisions = new Map<string, "pending" | "approved" | "rejected">();
  private requests: ApprovalRequest[] = [];

  async requestApproval(request: ApprovalRequest): Promise<void> {
    this.decisions.set(request.id, "pending");
    this.requests.push(request);
    console.log(`[InMemoryApprovalAdapter] Approval requested: ${request.id} — ${request.summary}`);
  }

  async pollDecision(id: string): Promise<"pending" | "approved" | "rejected"> {
    return this.decisions.get(id) ?? "pending";
  }

  async onTimeout(id: string): Promise<void> {
    console.log(`[InMemoryApprovalAdapter] Timeout for request ${id}`);
  }

  /** Call this from tests or a UI handler to simulate a human response */
  decide(id: string, decision: "approved" | "rejected"): void {
    this.decisions.set(id, decision);
  }

  getPendingRequests(): ApprovalRequest[] {
    return this.requests.filter((r) => this.decisions.get(r.id) === "pending");
  }
}
