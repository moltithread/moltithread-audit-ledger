#!/usr/bin/env node

import { appendEntry, makeId, readEntries } from "./ledger.js";
import { formatExplain, type ExplainFormat } from "./explain.js";
import { AuditEntrySchema, type AuditEntry } from "./schema.js";
import { redactObject, RedactionError, type RedactMode } from "./redact.js";
import readline from "node:readline";

// =============================================================================
// Argument parsing helpers
// =============================================================================

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("-")) {
    error(`Flag ${flag} requires a value`);
  }
  return value;
}

function getArgs(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag) {
      const value = process.argv[i + 1];
      if (value && !value.startsWith("-")) {
        out.push(value);
      } else {
        error(`Flag ${flag} requires a value`);
      }
    }
  }
  return out;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Get positional arguments (non-flag values) after a command.
 * Stops collecting when it hits a flag (starts with -).
 */
function getPositionalArgs(startIndex: number): string[] {
  const args: string[] = [];
  for (let i = startIndex; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("-")) break;
    args.push(arg);
  }
  return args;
}

// =============================================================================
// Output helpers
// =============================================================================

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const isatty = process.stderr.isTTY;
const c = (code: string, text: string) => (isatty ? code + text + RESET : text);

function error(message: string, hint?: string): never {
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
    rl.on("line", (line) => {
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
// Help text
// =============================================================================

function usage(): void {
  console.log(`${c(BOLD, "audit-ledger")} - Append-only action ledger for AI agents

${c(BOLD, "USAGE")}
  audit-ledger <command> [options]

${c(BOLD, "COMMANDS")}
  ${c(CYAN, "add")}       Add a new entry to the ledger
  ${c(CYAN, "last")}      Show the N most recent entries (default: 10)
  ${c(CYAN, "show")}      Display a single entry by ID (JSON output)
  ${c(CYAN, "explain")}   Human-readable explanation of an entry
  ${c(CYAN, "search")}    Search entries by keyword
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
  --stdin             Read bullet items from stdin (see examples)
  --strict            Reject entry if secrets are detected
  --no-redact         Disable automatic secret redaction ${c(DIM, "(not recommended)")}

${c(BOLD, "ACTION TYPES")}
  file_write    Created a new file
  file_edit     Modified an existing file
  browser       Browser interaction
  api_call      External API request
  exec          Shell command execution
  message_send  Sent a message (email, chat, etc.)
  config_change Changed configuration
  other         Anything else

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

  ${c(DIM, "# Use environment variable for ledger path")}
  export AUDIT_LEDGER_PATH=./logs/audit.jsonl
  audit-ledger last 5

  ${c(DIM, "# View recent entries")}
  audit-ledger last 10

  ${c(DIM, "# Get detailed explanation")}
  audit-ledger explain last --md

  ${c(DIM, "# Search for entries")}
  audit-ledger search "deploy"

${c(BOLD, "ENVIRONMENT")}
  AUDIT_LEDGER_PATH   Default ledger file path
`);
}

// =============================================================================
// Ledger path resolution
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

// =============================================================================
// Commands
// =============================================================================

const cmd = process.argv[2];
const ledgerPath = resolveLedgerPath();

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  usage();
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log("0.1.0");
  process.exit(0);
}

// -----------------------------------------------------------------------------
// add command
// -----------------------------------------------------------------------------

if (cmd === "add") {
  const jsonMode = hasFlag("--json");
  const stdinField = getArg("--stdin");
  const strictMode = hasFlag("--strict");
  const noRedact = hasFlag("--no-redact");

  let entry: AuditEntry;

  if (jsonMode) {
    // Read full entry from stdin as JSON
    if (process.stdin.isTTY) {
      error(
        "--json requires input from stdin",
        "echo '{...}' | audit-ledger add --json",
      );
    }

    const input = await readStdin();
    if (!input) {
      error("No JSON input received on stdin");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      error("Invalid JSON input", "Ensure valid JSON is piped to stdin");
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
      if (e instanceof Error) {
        error("Invalid entry schema", e.message);
      }
      throw e;
    }
  } else {
    // Regular flag-based input
    const type = getArg("--type");
    const summary = getArg("--summary");

    if (!type) {
      error(
        "Missing required flag: --type",
        "Specify action type: --type file_edit",
      );
    }

    const validTypes = [
      "file_write",
      "file_edit",
      "browser",
      "api_call",
      "exec",
      "message_send",
      "config_change",
      "other",
    ];
    if (!validTypes.includes(type)) {
      error(`Invalid type: "${type}"`, `Valid types: ${validTypes.join(", ")}`);
    }

    if (!summary) {
      error(
        "Missing required flag: --summary",
        'Provide a brief description: --summary "Updated config"',
      );
    }

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
        error(
          "--stdin requires piped input",
          'echo "line1\\nline2" | audit-ledger add --stdin did ...',
        );
      }

      const validFields = [
        "did",
        "assume",
        "unsure",
        "suggest",
        "observed",
        "artifact",
      ];
      if (!validFields.includes(stdinField)) {
        error(
          `Invalid --stdin field: "${stdinField}"`,
          `Valid fields: ${validFields.join(", ")}`,
        );
      }

      const bullets = parseBullets(await readStdin());

      switch (stdinField) {
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
        type: type as AuditEntry["action"]["type"],
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
      if (e instanceof Error) {
        error("Invalid entry", e.message);
      }
      throw e;
    }
  }

  // Apply redaction unless explicitly disabled
  if (!noRedact) {
    const mode: RedactMode = strictMode ? "strict" : "redact";
    try {
      entry = redactObject(entry, { mode });
    } catch (e) {
      if (e instanceof RedactionError) {
        console.error(`${c(RED, "error:")} Entry contains potential secrets:`);
        for (const match of e.matches) {
          console.error(`  ${c(DIM, "•")} ${match}`);
        }
        console.error("");
        console.error(
          `${c(DIM, "hint:")} Use --no-redact to bypass (not recommended)`,
        );
        process.exit(1);
      }
      throw e;
    }
  }

  appendEntry({ ledgerPath }, entry);
  console.log(entry.id);
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Helper to load all entries
// -----------------------------------------------------------------------------

async function loadAll(): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  try {
    for await (const e of readEntries({ ledgerPath })) entries.push(e);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // Ledger file doesn't exist yet
      return [];
    }
    throw e;
  }
  return entries;
}

// -----------------------------------------------------------------------------
// last command
// -----------------------------------------------------------------------------

if (cmd === "last") {
  const positional = getPositionalArgs(3);
  const nArg = positional[0];
  const n = nArg ? Number(nArg) : 10;

  if (nArg && (isNaN(n) || n < 1)) {
    error(`Invalid count: "${nArg}"`, "Provide a positive number");
  }

  const entries = await loadAll();

  if (entries.length === 0) {
    warn("Ledger is empty");
    process.exit(0);
  }

  const slice = entries.slice(-n);
  for (const e of slice) {
    console.log(
      `${c(CYAN, e.id)}  ${c(DIM, e.ts)}  ${e.action.type}  ${e.action.summary}`,
    );
  }
  process.exit(0);
}

// -----------------------------------------------------------------------------
// show command
// -----------------------------------------------------------------------------

if (cmd === "show") {
  const id = process.argv[3];
  if (!id) {
    error("Missing entry ID", "Usage: audit-ledger show <id>");
  }

  const entries = await loadAll();
  const entry = entries.find((x) => x.id === id);

  if (!entry) {
    error(
      `Entry not found: "${id}"`,
      "Use 'audit-ledger last' to see recent IDs",
    );
  }

  console.log(JSON.stringify(entry, null, 2));
  process.exit(0);
}

// -----------------------------------------------------------------------------
// search command
// -----------------------------------------------------------------------------

if (cmd === "search") {
  const termParts = getPositionalArgs(3);
  const term = termParts.join(" ");
  if (!term) {
    error("Missing search term", "Usage: audit-ledger search <term>");
  }

  const entries = await loadAll();

  if (entries.length === 0) {
    warn("Ledger is empty");
    process.exit(0);
  }

  const low = term.toLowerCase();
  const hits = entries.filter((e) =>
    JSON.stringify(e).toLowerCase().includes(low),
  );

  if (hits.length === 0) {
    console.error(`${c(DIM, "No matches for:")} ${term}`);
    process.exit(0);
  }

  for (const e of hits) {
    console.log(
      `${c(CYAN, e.id)}  ${c(DIM, e.ts)}  ${e.action.type}  ${e.action.summary}`,
    );
  }
  process.exit(0);
}

// -----------------------------------------------------------------------------
// explain command
// -----------------------------------------------------------------------------

if (cmd === "explain") {
  const positional = getPositionalArgs(3);
  const arg = positional[0];
  if (!arg) {
    error(
      "Missing entry reference",
      "Usage: audit-ledger explain <id>  or  audit-ledger explain last [<n>]",
    );
  }

  const format: ExplainFormat = hasFlag("--md") ? "markdown" : "text";
  const entries = await loadAll();

  if (entries.length === 0) {
    error("Ledger is empty", "Add entries with 'audit-ledger add'");
  }

  let entry: AuditEntry | undefined;

  if (arg === "last") {
    const nArg = positional[1];
    const n = nArg ? Number(nArg) : 1;

    if (nArg && (isNaN(n) || n < 1)) {
      error(`Invalid offset: "${nArg}"`, "Provide a positive number");
    }

    if (n > entries.length) {
      error(
        `Offset ${n} exceeds ledger size (${entries.length} entries)`,
        `Use a value between 1 and ${entries.length}`,
      );
    }

    entry = entries[entries.length - n];
  } else {
    entry = entries.find((x) => x.id === arg);
  }

  if (!entry) {
    error(
      `Entry not found: "${arg}"`,
      "Use 'audit-ledger last' to see recent IDs",
    );
  }

  console.log(formatExplain(entry, format));
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Unknown command
// -----------------------------------------------------------------------------

error(
  `Unknown command: "${cmd}"`,
  "Run 'audit-ledger help' for available commands",
);
