/**
 * Redaction utilities for stripping sensitive values from ledger entries.
 *
 * Two modes:
 *   - "redact" (default): replaces detected secrets with "[REDACTED]"
 *   - "strict": throws RedactionError if any secrets are detected
 */

/** Error thrown when secrets are detected in strict mode */
export class RedactionError extends Error {
  /** List of detected secret patterns with their locations */
  public readonly matches: readonly string[];

  constructor(message: string, matches: readonly string[]) {
    super(message);
    this.name = "RedactionError";
    this.matches = matches;
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RedactionError.prototype);
  }
}

/** Redaction mode: "redact" replaces secrets, "strict" throws on detection */
export type RedactMode = "redact" | "strict";

/** Configuration options for redaction operations */
export interface RedactOptions {
  /** Mode: "redact" replaces secrets, "strict" throws if secrets found */
  mode?: RedactMode;
  /** Additional key patterns to treat as sensitive (case-insensitive) */
  extraKeyPatterns?: readonly RegExp[];
  /** Additional value patterns to treat as sensitive */
  extraValuePatterns?: readonly RegExp[];
  /** Replacement string for redacted values */
  replacement?: string;
}

const DEFAULT_REPLACEMENT = "[REDACTED]" as const;

/**
 * Key name patterns that indicate sensitive data (case-insensitive).
 * Matches common credential/token field names.
 */
const SENSITIVE_KEY_PATTERNS = [
  /^(api[_-]?key|apikey)$/i,
  /^(auth[_-]?token|authtoken)$/i,
  /^(access[_-]?token|accesstoken)$/i,
  /^(refresh[_-]?token|refreshtoken)$/i,
  /^(bearer[_-]?token|bearertoken)$/i,
  /^(secret|secret[_-]?key|secretkey)$/i,
  /^(password|passwd|pwd)$/i,
  /^(token)$/i,
  /^(ct0)$/i, // Twitter auth cookie
  /^(private[_-]?key|privatekey)$/i,
  /^(session[_-]?id|sessionid)$/i,
  /^(session[_-]?token|sessiontoken)$/i,
  /^(cookie|cookies)$/i,
  /^(authorization)$/i,
  /^(credential|credentials)$/i,
  /^(client[_-]?secret|clientsecret)$/i,
  /^(signing[_-]?key|signingkey)$/i,
  /^(encryption[_-]?key|encryptionkey)$/i,
] as const satisfies readonly RegExp[];

/**
 * Value patterns that indicate sensitive data regardless of key name.
 * These are designed to be conservative to avoid false positives.
 */
const SENSITIVE_VALUE_PATTERNS = [
  // Bearer tokens: "Bearer <token>" or "bearer <token>"
  /\bBearer\s+[A-Za-z0-9\-_\.]{20,}\b/i,

  // AWS access keys (AKIA...)
  /\bAKIA[0-9A-Z]{16}\b/,

  // AWS secret keys (40 chars, mixed case + digits)
  /\b[A-Za-z0-9\/+=]{40}\b/,

  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,

  // Slack tokens (xox[baprs]-)
  /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/,

  // Generic API keys: long alphanumeric strings (32+ chars, mixed)
  // Conservative: requires mix of upper, lower, digits
  /\b(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{32,}\b/,

  // Long hex strings (64+ chars) - likely hashes or keys
  /\b[a-fA-F0-9]{64,}\b/,

  // Private keys (PEM format markers)
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/,
  /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,

  // JWT tokens (eyJ...)
  /\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/,

  // Basic auth header value
  /\bBasic\s+[A-Za-z0-9+\/=]{20,}\b/i,

  // Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_)
  /\b(sk|pk)_(live|test)_[A-Za-z0-9]{24,}\b/,

  // SendGrid/Twilio style keys
  /\bSG\.[A-Za-z0-9\-_]{22,}\.[A-Za-z0-9\-_]{22,}\b/,

  // Inline key=value patterns for sensitive keys in strings
  // Matches: password=xxx, token=xxx, api_key=xxx, secret=xxx (with quotes or without)
  /\b(password|passwd|pwd|token|api[_-]?key|secret|auth[_-]?token|access[_-]?token)\s*[=:]\s*["']?[^\s"',;]{4,}["']?/i,
] as const satisfies readonly RegExp[];

/**
 * Check if a key name is sensitive.
 *
 * @param key - The key name to check
 * @param extraPatterns - Additional patterns to check against
 * @returns true if the key matches a sensitive pattern
 */
export function isSensitiveKey(
  key: string,
  extraPatterns: readonly RegExp[] = [],
): boolean {
  const allPatterns: readonly RegExp[] = [
    ...SENSITIVE_KEY_PATTERNS,
    ...extraPatterns,
  ];
  return allPatterns.some((p) => p.test(key));
}

/**
 * Check if a value contains sensitive patterns.
 * Returns array of matched patterns for error reporting.
 *
 * @param value - The string value to scan
 * @param extraPatterns - Additional patterns to check against
 * @returns Array of truncated match previews (empty if no secrets found)
 */
export function findSensitivePatterns(
  value: string,
  extraPatterns: readonly RegExp[] = [],
): string[] {
  const matches: string[] = [];
  const allPatterns: readonly RegExp[] = [
    ...SENSITIVE_VALUE_PATTERNS,
    ...extraPatterns,
  ];

  for (const pattern of allPatterns) {
    const match = value.match(pattern);
    if (match) {
      // Return a truncated preview for error messages
      const preview =
        match[0].length > 20 ? match[0].slice(0, 20) + "..." : match[0];
      matches.push(preview);
    }
  }

  return matches;
}

/**
 * Redact sensitive patterns from a string value.
 *
 * @param value - The string to redact
 * @param replacement - Text to replace secrets with
 * @param extraPatterns - Additional patterns to redact
 * @returns The redacted string
 */
export function redactValue(
  value: string,
  replacement: string = DEFAULT_REPLACEMENT,
  extraPatterns: readonly RegExp[] = [],
): string {
  let result = value;
  const allPatterns: readonly RegExp[] = [
    ...SENSITIVE_VALUE_PATTERNS,
    ...extraPatterns,
  ];

  for (const pattern of allPatterns) {
    // Create a global version of the pattern
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : pattern.flags + "g";
    const globalPattern = new RegExp(pattern.source, flags);
    result = result.replace(globalPattern, replacement);
  }

  return result;
}

/**
 * Recursively redact sensitive values in an object.
 * Handles nested objects, arrays, and string values.
 * Preserves the structure while replacing sensitive content.
 *
 * @typeParam T - The input object type
 * @param obj - Object to redact
 * @param opts - Redaction options
 * @returns A new object with sensitive values redacted
 * @throws {RedactionError} In strict mode when secrets are detected
 */
export function redactObject<T>(obj: T, opts: RedactOptions = {}): T {
  const {
    mode = "redact",
    extraKeyPatterns = [],
    extraValuePatterns = [],
    replacement = DEFAULT_REPLACEMENT,
  } = opts;

  const detectedSecrets: string[] = [];

  function processValue(value: unknown, keyPath: string): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      const patterns = findSensitivePatterns(value, extraValuePatterns);
      if (patterns.length > 0) {
        if (mode === "strict") {
          detectedSecrets.push(`${keyPath}: ${patterns.join(", ")}`);
          return value; // Will throw at the end
        }
        return redactValue(value, replacement, extraValuePatterns);
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item, i) => processValue(item, `${keyPath}[${i}]`));
    }

    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        const currentPath = keyPath ? `${keyPath}.${key}` : key;

        // Check if the key itself indicates sensitive data
        if (isSensitiveKey(key, extraKeyPatterns)) {
          if (typeof val === "string" && val.length > 0) {
            if (mode === "strict") {
              detectedSecrets.push(`${currentPath}: sensitive key name`);
              result[key] = val;
            } else {
              result[key] = replacement;
            }
            continue;
          }
        }

        result[key] = processValue(val, currentPath);
      }
      return result;
    }

    // Numbers, booleans, etc. pass through unchanged
    return value;
  }

  const processed = processValue(obj, "");

  if (mode === "strict" && detectedSecrets.length > 0) {
    throw new RedactionError(
      `Detected ${detectedSecrets.length} potential secret(s) in data`,
      detectedSecrets,
    );
  }

  return processed as T;
}

/**
 * Redact a single string value (convenience wrapper).
 *
 * @param value - String to redact
 * @param opts - Redaction options
 * @returns The redacted string
 * @throws {RedactionError} In strict mode when secrets are detected
 */
export function redactString(value: string, opts: RedactOptions = {}): string {
  const {
    mode = "redact",
    extraValuePatterns = [],
    replacement = DEFAULT_REPLACEMENT,
  } = opts;

  const patterns = findSensitivePatterns(value, extraValuePatterns);

  if (patterns.length > 0) {
    if (mode === "strict") {
      throw new RedactionError(
        `Detected potential secret(s) in string`,
        patterns,
      );
    }
    return redactValue(value, replacement, extraValuePatterns);
  }

  return value;
}

/**
 * Check if an object contains any secrets without modifying it.
 * Returns true if secrets are detected.
 *
 * @param obj - Object to check
 * @param extraKeyPatterns - Additional key patterns to check
 * @param extraValuePatterns - Additional value patterns to check
 * @returns true if secrets are detected, false otherwise
 */
export function containsSecrets<T>(
  obj: T,
  extraKeyPatterns: readonly RegExp[] = [],
  extraValuePatterns: readonly RegExp[] = [],
): boolean {
  try {
    redactObject(obj, {
      mode: "strict",
      extraKeyPatterns,
      extraValuePatterns,
    });
    return false;
  } catch (e) {
    if (e instanceof RedactionError) {
      return true;
    }
    throw e;
  }
}
