#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";
import {
  appendEntry,
  makeId,
  readEntries,
  type LedgerOptions,
} from "./ledger.js";
import { formatExplain, type ExplainFormat } from "./explain.js";
import {
  AuditEntrySchema,
  ACTION_TYPES,
  isActionType,
  resolveTypeAlias,
  TYPE_ALIASES,
  type AuditEntry,
  type ActionType,
} from "./schema.js";
import { redactObject, RedactionError, type RedactMode } from "./redact.js";
import { parseClawdbotJsonl } from "./adapters/clawdbot.js";
import {
  parseClaudeCodeJsonl,
  parseClaudeCodeEvent,
} from "./adapters/claude-code.js";

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
const c = (code: string, text: string): string =>
  isatty ? code + text + RESET : text;

// =============================================================================
// Argument parsing helpers (improved type safety)
// =============================================================================

/**
 * Get the value following a flag in argv.
 * Returns undefined if flag is not present.
 * @throws If flag is present but no value follows
 */
function getArg(flag: string, altFlag?: string): string | undefined {
  for (const f of [flag, altFlag].filter(Boolean) as string[]) {
    const i = process.argv.indexOf(f);
    if (i !== -1) {
      const value = process.argv[i + 1];
      if (!value || value.startsWith("-")) {
        exitWithError(`Flag ${f} requires a value`);
      }
      return value;
    }
  }
  return undefined;
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

/** Get the default action type from environment variable */
function getDefaultActionType(): ActionType | undefined {
  const envType = process.env.AUDIT_DEFAULT_TYPE;
  if (!envType) return undefined;
  const resolved = resolveTypeAlias(envType);
  if (!resolved) {
    warn(`Invalid AUDIT_DEFAULT_TYPE: "${envType}" - ignoring`);
    return undefined;
  }
  return resolved;
}

/** Format type aliases for help/error messages */
function formatTypeAliases(): string {
  const entries = Object.entries(TYPE_ALIASES);
  return entries.map(([alias, type]) => `${alias}=${type}`).join(", ");
}

/** Validate and return action type, or exit with error */
function parseActionType(typeArg: string): ActionType {
  const resolved = resolveTypeAlias(typeArg);
  if (!resolved) {
    exitWithError(
      `Invalid type: "${typeArg}"`,
      `Valid types: ${ACTION_TYPES.join(", ")}\nAliases: ${formatTypeAliases()}`,
    );
  }
  return resolved;
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
function applyRedaction(
  entry: AuditEntry,
  config: RedactionConfig,
): AuditEntry {
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
      console.error(
        `${c(DIM, "hint:")} Use --no-redact to bypass (not recommended)`,
      );
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
  const aliasStr = Object.entries(TYPE_ALIASES)
    .map(([a, t]) => `${a}=${t}`)
    .join(", ");

  console.log(`${c(BOLD, "audit-ledger")} - Append-only action ledger for AI agents

${c(BOLD, "USAGE")}
  audit-ledger <command> [options]

${c(BOLD, "COMMANDS")}
  ${c(CYAN, "add")}       Add a new entry to the ledger
  ${c(CYAN, "q")}         Quick capture: audit-ledger q [type] "summary"
  ${c(CYAN, "last")}      Show the N most recent entries (default: 10)
  ${c(CYAN, "today")}     Show entries from today
  ${c(CYAN, "summary")}   Show entries since a time (--since 2h/1d/1w)
  ${c(CYAN, "show")}      Display a single entry by ID (JSON output)
  ${c(CYAN, "explain")}   Human-readable explanation of an entry
  ${c(CYAN, "search")}    Search entries by keyword
  ${c(CYAN, "import")}    Import entries from external formats
  ${c(CYAN, "help")}      Show this help message

${c(BOLD, "GLOBAL OPTIONS")}
  --ledger <path>   Path to ledger file (default: ./memory/action-ledger.jsonl)
                    Can also be set via ${c(CYAN, "AUDIT_LEDGER_PATH")} env var

${c(BOLD, "ADD OPTIONS")}
  -t, --type <type>   ${c(DIM, "(required)")} Action type or alias (see below)
  --summary <text>    ${c(DIM, "(required)")} Brief description of the action
  -i, --interactive   Interactive guided entry creation
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

${c(BOLD, "SUMMARY OPTIONS")}
  --since <time>      Time range: 2h (hours), 1d (days), 1w (weeks)
  --format md         Output as markdown (for standups)
  --md                Shorthand for --format md

${c(BOLD, "ACTION TYPES")}
  ${ACTION_TYPES.join("  ")}

${c(BOLD, "TYPE ALIASES")}
  ${aliasStr}

${c(BOLD, "IMPORT FORMATS")}
  clawdbot      Clawdbot tool-call events (JSONL)
  claude-code   Claude Code PostToolUse hook events (JSONL or --stdin)

${c(BOLD, "EXAMPLES")}
  ${c(DIM, "# Quick capture")}
  audit-ledger q "deployed to prod"
  audit-ledger q e "ran npm test"   ${c(DIM, "# e = exec")}

  ${c(DIM, "# Basic add with alias")}
  audit-ledger add -t d --summary "Updated README"  ${c(DIM, "# d = file_edit")}

  ${c(DIM, "# Interactive mode")}
  audit-ledger add -i

  ${c(DIM, "# Today's activity")}
  audit-ledger today
  audit-ledger today --md  ${c(DIM, "# markdown for standup")}

  ${c(DIM, "# Recent activity")}
  audit-ledger summary --since 2h
  audit-ledger summary --since 1d --format md

  ${c(DIM, "# Add with assumptions and uncertainties")}
  audit-ledger add -t a --summary "Posted to API" \\
    --assume "API key is valid" --unsure "Rate limits unclear"

  ${c(DIM, "# Import from Claude Code hook")}
  echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"success":true}' | \\
    audit-ledger import claude-code --stdin

  ${c(DIM, "# Import from clawdbot logs")}
  audit-ledger import clawdbot events.jsonl --dry-run

${c(BOLD, "ENVIRONMENT")}
  AUDIT_LEDGER_PATH    Default ledger file path
  AUDIT_DEFAULT_TYPE   Default type for quick capture (e.g., "exec" or "e")
`);
}

// =============================================================================
// Command handlers
// =============================================================================

async function handleAdd(ledgerPath: string): Promise<void> {
  // Check for interactive mode first
  if (hasFlag("-i") || hasFlag("--interactive")) {
    return handleInteractiveAdd(ledgerPath);
  }

  const jsonMode = hasFlag("--json");
  const stdinField = getArg("--stdin");
  const redactionConfig = getRedactionConfig();

  let entry: AuditEntry;

  if (jsonMode) {
    // Read full entry from stdin as JSON
    if (process.stdin.isTTY) {
      exitWithError(
        "--json requires input from stdin",
        "echo '{...}' | audit-ledger add --json",
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
      exitWithError(
        "Invalid JSON input",
        "Ensure valid JSON is piped to stdin",
      );
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
      exitWithError(
        "Invalid entry schema",
        e instanceof Error ? e.message : String(e),
      );
    }
  } else {
    // Regular flag-based input
    const typeArg = getArg("--type", "-t");
    const summary = getArg("--summary");

    if (!typeArg) {
      exitWithError(
        "Missing required flag: --type (or use -t)",
        `Valid types: ${ACTION_TYPES.join(", ")}\nAliases: ${formatTypeAliases()}`,
      );
    }

    if (!summary) {
      exitWithError(
        "Missing required flag: --summary",
        'Provide a brief description: --summary "Updated config"',
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
      ] as const;
      type StdinField = (typeof validFields)[number];

      if (!validFields.includes(stdinField as StdinField)) {
        exitWithError(
          `Invalid --stdin field: "${stdinField}"`,
          `Valid fields: ${validFields.join(", ")}`,
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
      exitWithError(
        "Invalid entry",
        e instanceof Error ? e.message : String(e),
      );
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
    exitWithError(
      `Entry not found: "${id}"`,
      "Use 'audit-ledger last' to see recent IDs",
    );
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
    JSON.stringify(e).toLowerCase().includes(searchLower),
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
      "Usage: audit-ledger explain <id>  or  audit-ledger explain last [<n>]",
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
        `Use a value between 1 and ${entries.length}`,
      );
    }

    entry = entries[entries.length - n];
  } else {
    entry = entries.find((x) => x.id === arg);
  }

  if (!entry) {
    exitWithError(
      `Entry not found: "${arg}"`,
      "Use 'audit-ledger last' to see recent IDs",
    );
  }

  console.log(formatExplain(entry, format));
}

async function handleImport(ledgerPath: string): Promise<void> {
  const format = process.argv[3];
  const inputArg = process.argv[4];
  const useStdin = hasFlag("--stdin");

  const validFormats = ["clawdbot", "claude-code"];
  if (!format || !validFormats.includes(format)) {
    exitWithError(
      `Unknown import format: ${format ?? "(none)"}`,
      `Supported formats: ${validFormats.join(", ")}`,
    );
  }

  // Determine input source
  let content: string;

  if (useStdin) {
    if (process.stdin.isTTY) {
      exitWithError(
        "--stdin requires piped input",
        `echo '{"tool_name":"Bash",...}' | audit-ledger import ${format} --stdin`,
      );
    }
    content = await readStdin();
    if (!content) {
      exitWithError("No input received on stdin");
    }
  } else {
    if (!inputArg) {
      exitWithError(
        "Missing input file",
        `Usage: audit-ledger import ${format} <file.jsonl> [--dry-run]\n       audit-ledger import ${format} --stdin`,
      );
    }

    if (!fs.existsSync(inputArg)) {
      exitWithError(`File not found: ${inputArg}`);
    }

    content = fs.readFileSync(inputArg, "utf8");
  }

  const dryRun = hasFlag("--dry-run");
  const redactionConfig = getRedactionConfig();

  // Select parser based on format
  const parser =
    format === "claude-code" ? parseClaudeCodeJsonl : parseClawdbotJsonl;

  let imported = 0;
  let skipped = 0;

  for (const entry of parser(content)) {
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

  console.log(
    `\nImported: ${imported}, Skipped: ${skipped}${dryRun ? " (dry-run)" : ""}`,
  );
}

// =============================================================================
// Time parsing helpers
// =============================================================================

/**
 * Parse a time specification like "2h", "1d", "1w" into milliseconds.
 * Returns undefined if the format is invalid.
 */
function parseTimeSpec(spec: string): number | undefined {
  const match = spec.match(/^(\d+)([hdw])$/i);
  if (!match) return undefined;

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  const MS_PER_HOUR = 60 * 60 * 1000;
  const MS_PER_DAY = 24 * MS_PER_HOUR;
  const MS_PER_WEEK = 7 * MS_PER_DAY;

  switch (unit) {
    case "h":
      return value * MS_PER_HOUR;
    case "d":
      return value * MS_PER_DAY;
    case "w":
      return value * MS_PER_WEEK;
    default:
      return undefined;
  }
}

/**
 * Get the start of today (midnight local time).
 */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Filter entries to those since a given timestamp.
 */
function filterEntriesSince(entries: AuditEntry[], since: Date): AuditEntry[] {
  const sinceMs = since.getTime();
  return entries.filter((e) => new Date(e.ts).getTime() >= sinceMs);
}

/**
 * Group entries by action type.
 */
function groupByType(entries: AuditEntry[]): Map<ActionType, AuditEntry[]> {
  const groups = new Map<ActionType, AuditEntry[]>();
  for (const entry of entries) {
    const type = entry.action.type;
    const existing = groups.get(type) ?? [];
    existing.push(entry);
    groups.set(type, existing);
  }
  return groups;
}

/**
 * Format entries as markdown grouped by type (for standups).
 */
function formatEntriesMarkdown(entries: AuditEntry[]): string {
  if (entries.length === 0) {
    return "_No entries found_\n";
  }

  const groups = groupByType(entries);
  const lines: string[] = [];

  for (const [type, typeEntries] of groups) {
    lines.push(`## ${type}`);
    lines.push("");
    for (const entry of typeEntries) {
      const time = new Date(entry.ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      lines.push(`- **${time}** ${entry.action.summary}`);
      if (entry.what_i_did.length > 0) {
        for (const item of entry.what_i_did) {
          lines.push(`  - ${item}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// Summary commands
// =============================================================================

async function handleToday(ledgerPath: string): Promise<void> {
  const format = hasFlag("--format")
    ? getArg("--format")
    : hasFlag("--md")
      ? "md"
      : "text";

  const entries = await loadAllEntries(ledgerPath);
  const todayStart = startOfToday();
  const filtered = filterEntriesSince(entries, todayStart);

  if (filtered.length === 0) {
    warn("No entries from today");
    return;
  }

  if (format === "md") {
    console.log(`# Activity for ${todayStart.toLocaleDateString()}`);
    console.log("");
    console.log(formatEntriesMarkdown(filtered));
  } else {
    for (const entry of filtered) {
      console.log(formatEntryLine(entry));
    }
  }
}

async function handleSummary(ledgerPath: string): Promise<void> {
  const sinceArg = getArg("--since");
  const format = hasFlag("--format")
    ? getArg("--format")
    : hasFlag("--md")
      ? "md"
      : "text";

  if (!sinceArg) {
    exitWithError(
      "Missing --since argument",
      "Usage: audit-ledger summary --since 2h (hours/days/weeks: h/d/w)",
    );
  }

  const ms = parseTimeSpec(sinceArg);
  if (ms === undefined) {
    exitWithError(
      `Invalid time spec: "${sinceArg}"`,
      "Use format like: 2h (hours), 1d (days), 1w (weeks)",
    );
  }

  const entries = await loadAllEntries(ledgerPath);
  const since = new Date(Date.now() - ms);
  const filtered = filterEntriesSince(entries, since);

  if (filtered.length === 0) {
    warn(`No entries in the last ${sinceArg}`);
    return;
  }

  if (format === "md") {
    console.log(`# Activity since ${since.toLocaleString()}`);
    console.log("");
    console.log(formatEntriesMarkdown(filtered));
  } else {
    for (const entry of filtered) {
      console.log(formatEntryLine(entry));
    }
  }
}

// =============================================================================
// Interactive mode
// =============================================================================

/**
 * Create readline interface for interactive prompts.
 */
function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
}

/**
 * Prompt user for a single line of input.
 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt user for multiple lines of input (blank line to finish).
 */
async function promptMultiline(
  rl: readline.Interface,
  header: string,
): Promise<string[]> {
  console.log(header);
  const lines: string[] = [];

  while (true) {
    const line = await prompt(rl, `  ${c(DIM, ">")} `);
    if (line === "") break;
    lines.push(line);
  }

  return lines;
}

/**
 * Format entry for preview display.
 */
function formatEntryPreview(entry: AuditEntry): string {
  const lines: string[] = [];
  lines.push(`${c(BOLD, "Type:")} ${entry.action.type}`);
  lines.push(`${c(BOLD, "Summary:")} ${entry.action.summary}`);

  if (entry.action.artifacts.length > 0) {
    lines.push(`${c(BOLD, "Artifacts:")} ${entry.action.artifacts.join(", ")}`);
  }

  if (entry.what_i_did.length > 0) {
    lines.push(`${c(BOLD, "What I did:")}`);
    for (const item of entry.what_i_did) {
      lines.push(`  • ${item}`);
    }
  }

  if (entry.assumptions.length > 0) {
    lines.push(`${c(BOLD, "Assumptions:")}`);
    for (const item of entry.assumptions) {
      lines.push(`  • ${item}`);
    }
  }

  if (entry.uncertainties.length > 0) {
    lines.push(`${c(BOLD, "Uncertainties:")}`);
    for (const item of entry.uncertainties) {
      lines.push(`  • ${item}`);
    }
  }

  return lines.join("\n");
}

async function handleInteractiveAdd(ledgerPath: string): Promise<void> {
  if (!process.stdin.isTTY) {
    exitWithError(
      "Interactive mode requires a terminal",
      "Use --json or flags for non-interactive input",
    );
  }

  const rl = createRl();
  const redactionConfig = getRedactionConfig();

  try {
    console.log(`\n${c(BOLD, "Add new audit entry")}`);
    console.log(
      `${c(DIM, `Aliases: ${Object.entries(TYPE_ALIASES).map(([a, t]) => `${a}=${t}`).join(", ")}`)}\n`,
    );

    // Type
    const typeInput = await prompt(
      rl,
      `${c(CYAN, "Type")} (e=exec, w=file_write, d=file_edit, ...): `,
    );
    if (!typeInput) {
      console.log("Aborted.");
      return;
    }

    const actionType = resolveTypeAlias(typeInput);
    if (!actionType) {
      console.error(
        `${c(RED, "error:")} Invalid type: "${typeInput}". Valid: ${ACTION_TYPES.join(", ")}`,
      );
      return;
    }

    // Summary
    const summary = await prompt(rl, `${c(CYAN, "Summary")}: `);
    if (!summary) {
      console.log("Aborted (summary is required).");
      return;
    }

    // Artifacts (optional)
    const artifactsInput = await prompt(
      rl,
      `${c(CYAN, "Artifacts")} (comma-sep, optional): `,
    );
    const artifacts = artifactsInput
      ? artifactsInput.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // What I did (optional, multiline)
    const whatIDid = await promptMultiline(
      rl,
      `${c(CYAN, "What I did")} (line per item, blank to finish):`,
    );

    // Build entry
    let entry: AuditEntry = {
      id: makeId(),
      ts: new Date().toISOString(),
      action: {
        type: actionType,
        summary,
        artifacts,
      },
      what_i_did: whatIDid,
      assumptions: [],
      uncertainties: [],
    };

    entry = AuditEntrySchema.parse(entry);

    // Preview
    console.log(`\n${c(BOLD, "Preview:")}`);
    console.log(formatEntryPreview(entry));
    console.log("");

    // Confirm
    const confirm = await prompt(rl, `${c(CYAN, "Save?")} (Y/n): `);
    if (confirm.toLowerCase() === "n") {
      console.log("Aborted.");
      return;
    }

    const finalEntry = applyRedaction(entry, redactionConfig);
    appendEntry({ ledgerPath }, finalEntry);
    console.log(`\n${c(CYAN, "Saved:")} ${finalEntry.id}`);
  } finally {
    rl.close();
  }
}

// =============================================================================
// Quick capture command
// =============================================================================

async function handleQuickCapture(ledgerPath: string): Promise<void> {
  const positional = getPositionalArgs(3);
  const redactionConfig = getRedactionConfig();

  if (positional.length === 0) {
    exitWithError(
      "Missing summary",
      'Usage: audit-ledger q "summary" or audit-ledger q <type> "summary"',
    );
  }

  let actionType: ActionType;
  let summary: string;

  // Check if first positional arg is a valid type/alias
  const firstArg = positional[0]!;
  const maybeType = resolveTypeAlias(firstArg);

  if (maybeType && positional.length > 1) {
    // First arg is a type, rest is the summary
    actionType = maybeType;
    summary = positional.slice(1).join(" ");
  } else {
    // All args are the summary, use default type
    actionType = getDefaultActionType() ?? "other";
    summary = positional.join(" ");
  }

  if (!summary.trim()) {
    exitWithError("Summary cannot be empty");
  }

  let entry: AuditEntry = {
    id: makeId(),
    ts: new Date().toISOString(),
    action: {
      type: actionType,
      summary: summary.trim(),
      artifacts: [],
    },
    what_i_did: [],
    assumptions: [],
    uncertainties: [],
  };

  entry = AuditEntrySchema.parse(entry);
  const finalEntry = applyRedaction(entry, redactionConfig);
  appendEntry({ ledgerPath }, finalEntry);
  console.log(finalEntry.id);
}

// =============================================================================
// Main entry point
// =============================================================================

async function main(): Promise<void> {
  const command = process.argv[2];
  const ledgerPath = resolveLedgerPath();

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
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
    case "q":
      await handleQuickCapture(ledgerPath);
      break;
    case "last":
      await handleLast(ledgerPath);
      break;
    case "today":
      await handleToday(ledgerPath);
      break;
    case "summary":
      await handleSummary(ledgerPath);
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
      exitWithError(
        `Unknown command: "${command}"`,
        "Run 'audit-ledger help' for available commands",
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
