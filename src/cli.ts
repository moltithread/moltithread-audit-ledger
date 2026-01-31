#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";
import { appendEntry, makeId, readEntries, type LedgerOptions } from "./ledger.js";
import { formatExplain, type ExplainFormat } from "./explain.js";
import { AuditEntrySchema, ACTION_TYPES, isActionType, type AuditEntry, type ActionType } from "./schema.js";
import { redactObject, RedactionError, type RedactMode } from "./redact.js";
import { parseClawdbotJsonl } from "./adapters/clawdbot.js";

// =============================================================================
// Terminal color helpers
// =============================================================================

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const isatty = process.stderr.isTTY;
const c = (code: string, text: string): string => (isatty ? code + text + RESET : text);

// =============================================================================
// Argument parsing helpers (improved type safety)
// =============================================================================

/**
 * Get the value following a flag in argv.
 * Returns undefined if flag is not present.
 * @throws If flag is present but no value follows
 */
function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("-")) {
    exitWithError(`Flag ${flag} requires a value`);
  }
  return value;
}

/**
 * Collect all values following repeated flags (e.g., --artifact x --artifact y).
 * Returns empty array if flag is not present.
 */
function getArgs(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag) {
      const value = process.argv[i + 1];
      if (value && !value.startsWith("-")) {
        out.push(value);
      } else {
        exitWithError(`Flag ${flag} requires a value`);
      }
    }
  }
  return out;
}

/**
 * Check if a boolean flag is present in argv.
 */
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Get positional arguments (non-flag values) after a given start index.
 * Stops collecting when it hits a flag (starts with -).
 */
function getPositionalArgs(startIndex: number): string[] {
  const args: string[] = [];
  for (let i = startIndex; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg?.startsWith("-")) break;
    if (arg) args.push(arg);
  }
  return args;
}

// =============================================================================
// Output helpers
// =============================================================================

function exitWithError(message: string, hint?: string): never {
  console.error(`${c(RED, "error:")} ${message}`);
  if (hint) {
    console.error(`${c(DIM, "hint:")} ${hint}`);
  }
  process.exit(1);
}

function warn(message: string): void {
  console.error(`${c(YELLOW, "warn:")} ${message}`);
}

// =============================================================================
// Stdin reading
// =============================================================================

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });
    rl.on("line", (line: string) => {
      data += line + "\n";
    });
    rl.on("close", () => {
      resolve(data.trim());
    });
  });
}

function parseBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

// =============================================================================
// Validation helpers
// =============================================================================

/** Validate and return action type, or exit with error */
function parseActionType(typeArg: string): ActionType {
  if (!isActionType(typeArg)) {
    exitWithError(
      `Invalid type: "${typeArg}"`,
      `Valid types: ${ACTION_TYPES.join(", ")}`
    );
  }
  return typeArg;
}

/** Determine redaction mode from CLI flags */
interface RedactionConfig {
  enabled: boolean;
  mode: RedactMode;
}

function getRedactionConfig(): RedactionConfig {
  const noRedact = hasFlag("--no-redact");
  const strictMode = hasFlag("--strict");
  return {
    enabled: !noRedact,
    mode: strictMode ? "strict" : "redact",
  };
}

/** Apply redaction to an entry, handling errors with nice output */
function applyRedaction(entry: AuditEntry, config: RedactionConfig): AuditEntry {
  if (!config.enabled) return entry;

  try {
    return redactObject(entry, { mode: config.mode });
  } catch (e) {
    if (e instanceof RedactionError) {
      console.error(`${c(RED, "error:")} Entry contains potential secrets:`);
      for (const match of e.matches) {
        console.error(`  ${c(DIM, "•")} ${match}`);
      }
      console.error("");
      console.error(`${c(DIM, "hint:")} Use --no-redact to bypass (not recommended)`);
      process.exit(1);
    }
    throw e;
  }
}

// =============================================================================
// Ledger operations
// =============================================================================

function resolveLedgerPath(): string {
  // CLI flag takes precedence
  const flagPath = getArg("--ledger");
  if (flagPath) return flagPath;

  // Then environment variable
  const envPath = process.env.AUDIT_LEDGER_PATH;
  if (envPath) return envPath;

  // Default
  return "./memory/action-ledger.jsonl";
}

async function loadAllEntries(ledgerPath: string): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  try {
    for await (const e of readEntries({ ledgerPath })) {
      entries.push(e);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw e;
  }
  return entries;
}

function formatEntryLine(entry: AuditEntry): string {
  return `${c(CYAN, entry.id)}  ${c(DIM, entry.ts)}  ${entry.action.type}  ${entry.action.summary}`;
}

// =============================================================================
// Help text
// =============================================================================

function printUsage(): void {
  console.log(`${c(BOLD, "audit-ledger")} - Append-only action ledger for AI agents

${c(BOLD, "USAGE")}
  audit-ledger <command> [options]

${c(BOLD, "COMMANDS")}
  ${c(CYAN, "add")}       Add a new entry to the ledger
  ${c(CYAN, "last")}      Show the N most recent entries (default: 10)
  ${c(CYAN, "show")}      Display a single entry by ID (JSON output)
  ${c(CYAN, "explain")}   Human-readable explanation of an entry
  ${c(CYAN, "search")}    Search entries by keyword
  ${c(CYAN, "import")}    Import entries from external formats
  ${c(CYAN, "help")}      Show this help message

${c(BOLD, "GLOBAL OPTIONS")}
  --ledger <path>   Path to ledger file (default: ./memory/action-ledger.jsonl)
                    Can also be set via ${c(CYAN, "AUDIT_LEDGER_PATH")} env var

${c(BOLD, "ADD OPTIONS")}
  --type <type>       ${c(DIM, "(required)")} Action type (see types below)
  --summary <text>    ${c(DIM, "(required)")} Brief description of the action
  --artifact <path>   Files or URLs affected (repeatable)
  --did <text>        What was done (repeatable)
  --assume <text>     Assumptions made (repeatable)
  --unsure <text>     Uncertainties (repeatable)
  --suggest <text>    Suggested verification steps (repeatable)
  --observed <text>   Observed results (repeatable)
  --json              Read full entry from stdin as JSON
  --stdin <field>     Read bullet items for a field from stdin
  --strict            Reject entry if secrets are detected
  --no-redact         Disable automatic secret redaction ${c(DIM, "(not recommended)")}

${c(BOLD, "ACTION TYPES")}
  ${ACTION_TYPES.join("  ")}

${c(BOLD, "IMPORT FORMATS")}
  clawdbot    Clawdbot tool-call events (JSONL with tool, arguments, result, timestamp)

${c(BOLD, "EXAMPLES")}
  ${c(DIM, "# Basic add")}
  audit-ledger add --type file_edit --summary "Updated README" \\
    --artifact README.md --did "Added install instructions"

  ${c(DIM, "# Add with assumptions and uncertainties")}
  audit-ledger add --type api_call --summary "Posted to API" \\
    --assume "API key is valid" --unsure "Rate limits unclear"

  ${c(DIM, "# Read full entry from JSON (stdin)")}
  echo '{"type":"exec","summary":"Ran tests"}' | audit-ledger add --json

  ${c(DIM, "# Read bullet points from stdin")}
  echo -e "Compiled TypeScript\\nRan unit tests" | audit-ledger add \\
    --type exec --summary "Build and test" --stdin did

  ${c(DIM, "# View recent entries")}
  audit-ledger last 10

  ${c(DIM, "# Get detailed explanation")}
  audit-ledger explain last --md

  ${c(DIM, "# Search for entries")}
  audit-ledger search "deploy"

  ${c(DIM, "# Import from clawdbot logs")}
  audit-ledger import clawdbot events.jsonl --dry-run

${c(BOLD, "ENVIRONMENT")}
  AUDIT_LEDGER_PATH   Default ledger file path
`);
}

// =============================================================================
// Command handlers
// =============================================================================

async function handleAdd(ledgerPath: string): Promise<void> {
  const jsonMode = hasFlag("--json");
  const stdinField = getArg("--stdin");
  const redactionConfig = getRedactionConfig();

  let entry: AuditEntry;

  if (jsonMode) {
    // Read full entry from stdin as JSON
    if (process.stdin.isTTY) {
      exitWithError(
        "--json requires input from stdin",
        "echo '{...}' | audit-ledger add --json"
      );
    }

    const input = await readStdin();
    if (!input) {
      exitWithError("No JSON input received on stdin");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      exitWithError("Invalid JSON input", "Ensure valid JSON is piped to stdin");
    }

    // Allow shorthand: just action fields, we'll add id/ts
    const data = parsed as Record<string, unknown>;
    if (!data.id) data.id = makeId();
    if (!data.ts) data.ts = new Date().toISOString();

    // If 'type' and 'summary' are top-level, wrap in action
    if (data.type && data.summary && !data.action) {
      data.action = {
        type: data.type,
        summary: data.summary,
        artifacts: data.artifacts || [],
      };
      delete data.type;
      delete data.summary;
      delete data.artifacts;
    }

    // Set defaults for optional arrays
    if (!data.what_i_did) data.what_i_did = [];
    if (!data.assumptions) data.assumptions = [];
    if (!data.uncertainties) data.uncertainties = [];

    try {
      entry = AuditEntrySchema.parse(data);
    } catch (e) {
      exitWithError("Invalid entry schema", e instanceof Error ? e.message : String(e));
    }
  } else {
    // Regular flag-based input
    const typeArg = getArg("--type");
    const summary = getArg("--summary");

    if (!typeArg) {
      exitWithError(
        "Missing required flag: --type",
        `Valid types: ${ACTION_TYPES.join(", ")}`
      );
    }

    if (!summary) {
      exitWithError(
        "Missing required flag: --summary",
        'Provide a brief description: --summary "Updated config"'
      );
    }

    const actionType = parseActionType(typeArg);

    // Collect arrays
    let whatIDid = getArgs("--did");
    let assumptions = getArgs("--assume");
    let uncertainties = getArgs("--unsure");
    let suggested = getArgs("--suggest");
    let observed = getArgs("--observed");
    const artifacts = getArgs("--artifact");

    // Handle stdin for bullet fields
    if (stdinField) {
      if (process.stdin.isTTY) {
        exitWithError(
          "--stdin requires piped input",
          'echo "line1\\nline2" | audit-ledger add --stdin did ...'
        );
      }

      const validFields = ["did", "assume", "unsure", "suggest", "observed", "artifact"] as const;
      type StdinField = (typeof validFields)[number];

      if (!validFields.includes(stdinField as StdinField)) {
        exitWithError(
          `Invalid --stdin field: "${stdinField}"`,
          `Valid fields: ${validFields.join(", ")}`
        );
      }

      const bullets = parseBullets(await readStdin());

      switch (stdinField as StdinField) {
        case "did":
          whatIDid = [...whatIDid, ...bullets];
          break;
        case "assume":
          assumptions = [...assumptions, ...bullets];
          break;
        case "unsure":
          uncertainties = [...uncertainties, ...bullets];
          break;
        case "suggest":
          suggested = [...suggested, ...bullets];
          break;
        case "observed":
          observed = [...observed, ...bullets];
          break;
        case "artifact":
          artifacts.push(...bullets);
          break;
      }
    }

    entry = {
      id: makeId(),
      ts: new Date().toISOString(),
      action: {
        type: actionType,
        summary,
        artifacts,
      },
      what_i_did: whatIDid,
      assumptions,
      uncertainties,
      verification: {
        suggested,
        observed,
      },
    };

    try {
      entry = AuditEntrySchema.parse(entry);
    } catch (e) {
      exitWithError("Invalid entry", e instanceof Error ? e.message : String(e));
    }
  }

  const finalEntry = applyRedaction(entry, redactionConfig);
  appendEntry({ ledgerPath }, finalEntry);
  console.log(finalEntry.id);
}

async function handleLast(ledgerPath: string): Promise<void> {
  const positional = getPositionalArgs(3);
  const nArg = positional[0];
  const n = nArg ? Number(nArg) : 10;

  if (nArg && (isNaN(n) || n < 1)) {
    exitWithError(`Invalid count: "${nArg}"`, "Provide a positive number");
  }

  const entries = await loadAllEntries(ledgerPath);

  if (entries.length === 0) {
    warn("Ledger is empty");
    return;
  }

  const slice = entries.slice(-n);
  for (const entry of slice) {
    console.log(formatEntryLine(entry));
  }
}

async function handleShow(ledgerPath: string): Promise<void> {
  const id = process.argv[3];
  if (!id || id.startsWith("-")) {
    exitWithError("Missing entry ID", "Usage: audit-ledger show <id>");
  }

  const entries = await loadAllEntries(ledgerPath);
  const entry = entries.find((x) => x.id === id);

  if (!entry) {
    exitWithError(`Entry not found: "${id}"`, "Use 'audit-ledger last' to see recent IDs");
  }

  console.log(JSON.stringify(entry, null, 2));
}

async function handleSearch(ledgerPath: string): Promise<void> {
  const termParts = getPositionalArgs(3);
  const term = termParts.join(" ");
  if (!term) {
    exitWithError("Missing search term", "Usage: audit-ledger search <term>");
  }

  const entries = await loadAllEntries(ledgerPath);

  if (entries.length === 0) {
    warn("Ledger is empty");
    return;
  }

  const searchLower = term.toLowerCase();
  const hits = entries.filter((e) =>
    JSON.stringify(e).toLowerCase().includes(searchLower)
  );

  if (hits.length === 0) {
    console.error(`${c(DIM, "No matches for:")} ${term}`);
    return;
  }

  for (const entry of hits) {
    console.log(formatEntryLine(entry));
  }
}

async function handleExplain(ledgerPath: string): Promise<void> {
  const positional = getPositionalArgs(3);
  const arg = positional[0];
  if (!arg) {
    exitWithError(
      "Missing entry reference",
      "Usage: audit-ledger explain <id>  or  audit-ledger explain last [<n>]"
    );
  }

  const format: ExplainFormat = hasFlag("--md") ? "markdown" : "text";
  const entries = await loadAllEntries(ledgerPath);

  if (entries.length === 0) {
    exitWithError("Ledger is empty", "Add entries with 'audit-ledger add'");
  }

  let entry: AuditEntry | undefined;

  if (arg === "last") {
    const nArg = positional[1];
    const n = nArg ? Number(nArg) : 1;

    if (nArg && (isNaN(n) || n < 1)) {
      exitWithError(`Invalid offset: "${nArg}"`, "Provide a positive number");
    }

    if (n > entries.length) {
      exitWithError(
        `Offset ${n} exceeds ledger size (${entries.length} entries)`,
        `Use a value between 1 and ${entries.length}`
      );
    }

    entry = entries[entries.length - n];
  } else {
    entry = entries.find((x) => x.id === arg);
  }

  if (!entry) {
    exitWithError(`Entry not found: "${arg}"`, "Use 'audit-ledger last' to see recent IDs");
  }

  console.log(formatExplain(entry, format));
}

async function handleImport(ledgerPath: string): Promise<void> {
  const format = process.argv[3];
  const inputFile = process.argv[4];

  if (format !== "clawdbot") {
    exitWithError(
      `Unknown import format: ${format ?? "(none)"}`,
      "Supported formats: clawdbot"
    );
  }

  if (!inputFile) {
    exitWithError(
      "Missing input file",
      "Usage: audit-ledger import clawdbot <file.jsonl> [--dry-run]"
    );
  }

  if (!fs.existsSync(inputFile)) {
    exitWithError(`File not found: ${inputFile}`);
  }

  const dryRun = hasFlag("--dry-run");
  const redactionConfig = getRedactionConfig();

  const content = fs.readFileSync(inputFile, "utf8");
  let imported = 0;
  let skipped = 0;

  for (const entry of parseClawdbotJsonl(content)) {
    try {
      let finalEntry = entry;

      if (redactionConfig.enabled) {
        try {
          finalEntry = redactObject(entry, { mode: redactionConfig.mode });
        } catch (e) {
          if (e instanceof RedactionError) {
            console.error(`Skipping entry (secrets detected): ${entry.id}`);
            for (const match of e.matches) {
              console.error(`  ${c(DIM, "•")} ${match}`);
            }
            skipped++;
            continue;
          }
          throw e;
        }
      }

      if (dryRun) {
        console.log(`${c(DIM, "[dry-run]")} ${formatEntryLine(finalEntry)}`);
      } else {
        appendEntry({ ledgerPath }, finalEntry);
        console.log(formatEntryLine(finalEntry));
      }
      imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${c(YELLOW, "warn:")} Error processing entry: ${message}`);
      skipped++;
    }
  }

  console.log(`\nImported: ${imported}, Skipped: ${skipped}${dryRun ? " (dry-run)" : ""}`);
}

// =============================================================================
// Main entry point
// =============================================================================

async function main(): Promise<void> {
  const command = process.argv[2];
  const ledgerPath = resolveLedgerPath();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log("0.1.0");
    return;
  }

  switch (command) {
    case "add":
      await handleAdd(ledgerPath);
      break;
    case "last":
      await handleLast(ledgerPath);
      break;
    case "show":
      await handleShow(ledgerPath);
      break;
    case "search":
      await handleSearch(ledgerPath);
      break;
    case "explain":
      await handleExplain(ledgerPath);
      break;
    case "import":
      await handleImport(ledgerPath);
      break;
    default:
      exitWithError(`Unknown command: "${command}"`, "Run 'audit-ledger help' for available commands");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
