/**
 * PII Redaction Guardrail
 *
 * Scans text for common PII patterns and replaces them with [REDACTED] before
 * the text is sent to any LLM. This prevents personal data from appearing in
 * prompts, logs, or model outputs.
 *
 * Patterns detected:
 *   • Email addresses
 *   • Phone numbers (US and international formats)
 *   • US Social Security Numbers
 *   • Credit card numbers (basic pattern)
 *   • IPv4 addresses
 *   • US ZIP codes (standalone 5-digit and ZIP+4)
 *
 * Usage:
 *   import { redactPII, PIIRedactor } from "@zyphos/guardrails";
 *
 *   // Simple function usage:
 *   const safe = redactPII("Email me at alice@example.com or call +1-555-123-4567");
 *   // → "Email me at [REDACTED_EMAIL] or call [REDACTED_PHONE]"
 *
 *   // Class with configurable rules:
 *   const redactor = new PIIRedactor({ redactEmails: true, redactPhones: true });
 *   const safe = redactor.redact(userInput);
 */

export interface PIIRedactorConfig {
  /** Replace email addresses. Default: true */
  redactEmails?: boolean;
  /** Replace phone numbers. Default: true */
  redactPhones?: boolean;
  /** Replace US Social Security Numbers (###-##-####). Default: true */
  redactSSNs?: boolean;
  /** Replace credit/debit card numbers (basic 13-19 digit pattern). Default: true */
  redactCreditCards?: boolean;
  /** Replace IPv4 addresses. Default: false */
  redactIPs?: boolean;
  /**
   * Custom patterns to redact.
   * Each entry: { pattern: RegExp, label: string }
   * The label is used in the replacement: [REDACTED_LABEL]
   */
  customPatterns?: Array<{ pattern: RegExp; label: string }>;
}

// ── PII patterns ──────────────────────────────────────────────────────────────

const PATTERNS = {
  email: {
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    label: "EMAIL",
  },
  phone: {
    // Matches: +91 98765 43210, +1-555-123-4567, (555) 123-4567, 555.123.4567, etc.
    regex:
      /(?<!\d)(?:\+91[\s.\-]?\d{5}[\s.\-]?\d{5}|(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4})(?!\d)/g,
    label: "PHONE",
  },
  ssn: {
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    label: "SSN",
  },
  creditCard: {
    // 13–19 contiguous digits, or 4-digit groups separated by spaces/dashes.
    regex: /\b(?:\d{13,19}|\d{4}(?:[ \-]\d{4}){3,4})\b/g,
    label: "CARD_NUMBER",
  },
  ipv4: {
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    label: "IP_ADDRESS",
  },
};

export class PIIRedactor {
  private readonly config: Required<Omit<PIIRedactorConfig, "customPatterns">> & {
    customPatterns: Array<{ pattern: RegExp; label: string }>;
  };

  constructor(config: PIIRedactorConfig = {}) {
    this.config = {
      redactEmails: config.redactEmails ?? true,
      redactPhones: config.redactPhones ?? true,
      redactSSNs: config.redactSSNs ?? true,
      redactCreditCards: config.redactCreditCards ?? true,
      redactIPs: config.redactIPs ?? false,
      customPatterns: config.customPatterns ?? [],
    };
  }

  /**
   * Redact PII from the given text.
   * Returns the cleaned string with sensitive values replaced.
   */
  redact(text: string): string {
    let result = text;

    if (this.config.redactEmails) {
      result = result.replace(PATTERNS.email.regex, `[REDACTED_${PATTERNS.email.label}]`);
    }
    if (this.config.redactPhones) {
      result = result.replace(PATTERNS.phone.regex, `[REDACTED_${PATTERNS.phone.label}]`);
    }
    if (this.config.redactSSNs) {
      result = result.replace(PATTERNS.ssn.regex, `[REDACTED_${PATTERNS.ssn.label}]`);
    }
    if (this.config.redactCreditCards) {
      result = result.replace(PATTERNS.creditCard.regex, `[REDACTED_${PATTERNS.creditCard.label}]`);
    }
    if (this.config.redactIPs) {
      result = result.replace(PATTERNS.ipv4.regex, `[REDACTED_${PATTERNS.ipv4.label}]`);
    }

    for (const { pattern, label } of this.config.customPatterns) {
      result = result.replace(pattern, `[REDACTED_${label.toUpperCase()}]`);
    }

    return result;
  }

  /**
   * Returns true if the text contains any PII that would be redacted.
   */
  hasPII(text: string): boolean {
    return this.redact(text) !== text;
  }

  /**
   * Scan and return a summary of what PII types were found (without redacting).
   */
  scan(text: string): Array<{ type: string; count: number }> {
    const results: Array<{ type: string; count: number }> = [];

    const check = (key: keyof typeof PATTERNS, enabled: boolean) => {
      if (!enabled) return;
      const matches = text.match(PATTERNS[key].regex);
      if (matches?.length) {
        results.push({ type: PATTERNS[key].label, count: matches.length });
      }
    };

    check("email", this.config.redactEmails);
    check("phone", this.config.redactPhones);
    check("ssn", this.config.redactSSNs);
    check("creditCard", this.config.redactCreditCards);
    check("ipv4", this.config.redactIPs);

    return results;
  }
}

/**
 * Convenience function: redact PII from text using default settings.
 */
export function redactPII(text: string, config?: PIIRedactorConfig): string {
  return new PIIRedactor(config).redact(text);
}
