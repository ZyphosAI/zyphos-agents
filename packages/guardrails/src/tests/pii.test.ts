import { describe, expect, it } from "@jest/globals";
import { PIIRedactor } from "../pii";

// Email redaction cases verify common message shapes and replacement labels.
describe("PIIRedactor email redaction", () => {
  it("redacts a single email address", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("alice@example.com")).toBe("[REDACTED_EMAIL]");
  });

  it("redacts multiple email addresses in one string", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Email alice@example.com and bob@example.org")).toBe(
      "Email [REDACTED_EMAIL] and [REDACTED_EMAIL]",
    );
  });

  it("redacts an email inside a sentence", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Contact me at jane.doe+sales@example.co.uk today.")).toBe(
      "Contact me at [REDACTED_EMAIL] today.",
    );
  });

  it("uses the email replacement label", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("support@example.com")).toBe("[REDACTED_EMAIL]");
  });
});

// Phone redaction cases cover the formats listed in the issue.
describe("PIIRedactor phone redaction", () => {
  it("redacts an Indian phone number", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Call +91 98765 43210")).toBe("Call [REDACTED_PHONE]");
  });

  it("redacts a US phone number with dashes", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Call 555-123-4567")).toBe("Call [REDACTED_PHONE]");
  });

  it("redacts a US phone number with brackets", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Call (555) 123-4567")).toBe("Call [REDACTED_PHONE]");
  });

  it("redacts a US phone number without separators", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Call 5551234567")).toBe("Call [REDACTED_PHONE]");
  });
});

// SSN and custom ID redaction cases verify default and caller-provided patterns.
describe("PIIRedactor SSN and custom ID redaction", () => {
  it("redacts a US SSN", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("SSN 123-45-6789")).toBe("SSN [REDACTED_SSN]");
  });

  it("redacts a custom employee ID pattern", () => {
    const redactor = new PIIRedactor({
      customPatterns: [{ pattern: /\bEMP-\d{6}\b/g, label: "employee_id" }],
    });

    expect(redactor.redact("Employee EMP-123456 joined")).toBe("Employee [REDACTED_EMPLOYEE_ID] joined");
  });
});

// Credit card redaction cases verify the opt-in and opt-out behavior.
describe("PIIRedactor credit card redaction", () => {
  it("redacts a 16-digit card number when enabled", () => {
    const redactor = new PIIRedactor({ redactCreditCards: true });

    expect(redactor.redact("Card 4111111111111111")).toBe("Card [REDACTED_CARD_NUMBER]");
  });

  it("does not redact a 16-digit card number when disabled", () => {
    const redactor = new PIIRedactor({ redactCreditCards: false });

    expect(redactor.redact("Card 4111111111111111")).toBe("Card 4111111111111111");
  });
});

// hasPII cases verify boolean detection for present, absent, and empty input.
describe("PIIRedactor hasPII", () => {
  it("returns true when PII is present", () => {
    const redactor = new PIIRedactor();

    expect(redactor.hasPII("Email alice@example.com")).toBe(true);
  });

  it("returns false when no PII is present", () => {
    const redactor = new PIIRedactor();

    expect(redactor.hasPII("No sensitive data here")).toBe(false);
  });

  it("returns false for an empty string", () => {
    const redactor = new PIIRedactor();

    expect(redactor.hasPII("")).toBe(false);
  });
});

// scan cases verify type/count summaries without mutating the input.
describe("PIIRedactor scan", () => {
  it("returns the correct type and count for each detected PII type", () => {
    const redactor = new PIIRedactor({ redactIPs: true });

    expect(redactor.scan("a@example.com b@example.com 555-123-4567 123-45-6789 4111111111111111 192.168.0.1")).toEqual([
      { type: "EMAIL", count: 2 },
      { type: "PHONE", count: 1 },
      { type: "SSN", count: 1 },
      { type: "CARD_NUMBER", count: 1 },
      { type: "IP_ADDRESS", count: 1 },
    ]);
  });

  it("returns an empty array when no PII is present", () => {
    const redactor = new PIIRedactor();

    expect(redactor.scan("No sensitive data here")).toEqual([]);
  });
});

// Edge cases verify empty and mixed-content behavior.
describe("PIIRedactor edge cases", () => {
  it("returns an empty string for empty input", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("")).toBe("");
  });

  it("passes through strings with no PII unchanged", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("No sensitive data here")).toBe("No sensitive data here");
  });

  it("redacts multiple PII types in one string", () => {
    const redactor = new PIIRedactor();

    expect(redactor.redact("Email alice@example.com, call 555-123-4567, SSN 123-45-6789")).toBe(
      "Email [REDACTED_EMAIL], call [REDACTED_PHONE], SSN [REDACTED_SSN]",
    );
  });
});
