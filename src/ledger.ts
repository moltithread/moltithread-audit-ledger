import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { AuditEntrySchema, type AuditEntry } from "./schema.js";

export type LedgerOptions = {
  ledgerPath: string;
};

/**
 * Error thrown when a JSONL line fails to parse.
 */
export class JsonlParseError extends Error {
  constructor(
    message: string,
    public lineNumber: number,
    public lineContent: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = "JsonlParseError";
  }
}

/**
 * Options for reading ledger entries.
 */
export type ReadOptions = {
  /**
   * If true, skip invalid lines instead of throwing.
   * Invalid lines are logged to console.error.
   */
  skipInvalid?: boolean;
};

/**
 * Safely parse a JSON string, returning null on failure.
 */
function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read entries from a JSONL ledger file.
 *
 * By default, throws on invalid lines. Set `skipInvalid: true` to
 * skip invalid lines and continue processing.
 */
export async function* readEntries(
  opts: LedgerOptions,
  readOpts: ReadOptions = {},
): AsyncGenerator<AuditEntry> {
  const { skipInvalid = false } = readOpts;

  if (!fs.existsSync(opts.ledgerPath)) {
    return;
  }

  const stream = fs.createReadStream(opts.ledgerPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Attempt JSON parse
    const parsed = safeJsonParse(trimmed);
    if (parsed === null) {
      const error = new JsonlParseError(
        `Invalid JSON on line ${lineNumber}`,
        lineNumber,
        trimmed.slice(0, 100),
      );
      if (skipInvalid) {
        console.error(`Warning: ${error.message}`);
        continue;
      }
      throw error;
    }

    // Validate against schema
    try {
      const entry = AuditEntrySchema.parse(parsed);
      yield entry;
    } catch (err) {
      const schemaError = new JsonlParseError(
        `Schema validation failed on line ${lineNumber}`,
        lineNumber,
        trimmed.slice(0, 100),
        err instanceof Error ? err : undefined,
      );
      if (skipInvalid) {
        console.error(`Warning: ${schemaError.message}`);
        continue;
      }
      throw schemaError;
    }
  }
}

/**
 * Ensure the directory for a file path exists.
 */
export function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Append an entry to the ledger file.
 */
export function appendEntry(opts: LedgerOptions, entry: AuditEntry): void {
  ensureDir(opts.ledgerPath);
  const line = JSON.stringify(entry);
  fs.appendFileSync(opts.ledgerPath, line + "\n", { encoding: "utf8" });
}

/**
 * Generate a unique ID for a ledger entry.
 *
 * Format: YYYYMMDDTHHMMSSZ-XXXX where XXXX is a random hex suffix.
 */
export function makeId(now = new Date()): string {
  // 2026-01-31T03:46:56.406Z -> 20260131T034656Z
  const iso = now.toISOString();
  const compact = iso.replace(/[-:]/g, "").replace(/\..+Z$/, "Z");
  // Add a short random suffix for uniqueness
  const suffix = Math.random().toString(16).slice(2, 6);
  return `${compact}-${suffix}`;
}
