#!/usr/bin/env node

import fs from "node:fs";
import { appendEntry, makeId, readEntries } from "./ledger.js";
import { formatExplain, type ExplainFormat } from "./explain.js";
import { AuditEntrySchema, type AuditEntry } from "./schema.js";
import { redactObject, RedactionError, type RedactMode } from "./redact.js";
import { parseClawdbotJsonl } from "./adapters/clawdbot.js";

// ==================== CLI Argument Helpers ====================

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function getArgs(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) {
      out.push(process.argv[i + 1]);
    }
  }
  return out;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ==================== Output Helpers ====================

function printEntryLine(e: AuditEntry): void {
  console.log(`${e.id}  ${e.ts}  ${e.action.type}  ${e.action.summary}`);
}

function printRedactionError(err: RedactionError): void {
  console.error("Error: Entry contains potential secrets:");
  for (const match of err.matches) {
    console.error(`  - ${match}`);
  }
  console.error("\nUse --no-redact to bypass (not recommended).");
}

// ==================== Redaction Wrapper ====================

type RedactResult =
  | { ok: true; entry: AuditEntry }
  | { ok: false; error: RedactionError };

function applyRedaction(entry: AuditEntry, mode: RedactMode): RedactResult {
  try {
    const redacted = redactObject(entry, { mode });
    return { ok: true, entry: redacted };
  } catch (e) {
    if (e instanceof RedactionError) {
      return { ok: false, error: e };
    }
    throw e;
  }
}

// ==================== Usage ====================

function usage(): void {
  console.log(`audit-ledger

Commands:
  add --type <type> --summary <text> [--artifact <x> ...] [--did <x> ...] [--assume <x> ...] [--unsure <x> ...] [--suggest <x> ...] [--observed <x> ...] [--ledger <path>] [--strict] [--no-redact]
  last <n> [--ledger <path>]
  show <id> [--ledger <path>]
  explain <id> [--md] [--ledger <path>]
  explain last [<n>] [--md] [--ledger <path>]
  search <term> [--ledger <path>]
  import clawdbot <file.jsonl> [--ledger <path>] [--dry-run] [--strict] [--no-redact]

Types:
  file_write | file_edit | browser | api_call | exec | message_send | config_change | other

Options:
  --strict     Reject entries containing detected secrets (fail instead of redact)
  --no-redact  Disable automatic redaction (not recommended)
  --dry-run    Preview import without writing to ledger

Import Formats:
  clawdbot    Clawdbot tool-call events (JSONL with tool, arguments, result, timestamp, files)
`);
}

// ==================== Entry Loading ====================

async function loadAllEntries(ledgerPath: string): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  for await (const e of readEntries({ ledgerPath })) {
    entries.push(e);
  }
  return entries;
}

// ==================== Command Handlers ====================

function handleAdd(ledgerPath: string): void {
  const type = getArg("--type");
  const summary = getArg("--summary");

  if (!type || !summary) {
    console.error("Missing --type or --summary");
    process.exit(1);
  }

  const strictMode = hasFlag("--strict");
  const noRedact = hasFlag("--no-redact");

  const entry: AuditEntry = {
    id: makeId(),
    ts: new Date().toISOString(),
    action: {
      type: type as AuditEntry["action"]["type"],
      summary,
      artifacts: getArgs("--artifact"),
    },
    what_i_did: getArgs("--did"),
    assumptions: getArgs("--assume"),
    uncertainties: getArgs("--unsure"),
    verification: {
      suggested: getArgs("--suggest"),
      observed: getArgs("--observed"),
    },
  };

  let validated = AuditEntrySchema.parse(entry);

  if (!noRedact) {
    const mode: RedactMode = strictMode ? "strict" : "redact";
    const result = applyRedaction(validated, mode);
    if (!result.ok) {
      printRedactionError(result.error);
      process.exit(1);
    }
    validated = result.entry;
  }

  appendEntry({ ledgerPath }, validated);
  console.log(validated.id);
}

async function handleLast(ledgerPath: string): Promise<void> {
  const n = Number(process.argv[3] || 10);
  const entries = await loadAllEntries(ledgerPath);
  const slice = entries.slice(-n);

  for (const e of slice) {
    printEntryLine(e);
  }
}

async function handleShow(ledgerPath: string): Promise<void> {
  const id = process.argv[3];
  if (!id) {
    console.error("Missing id");
    process.exit(1);
  }

  const entries = await loadAllEntries(ledgerPath);
  const entry = entries.find((x) => x.id === id);

  if (!entry) {
    console.error("Not found:", id);
    process.exit(1);
  }

  console.log(JSON.stringify(entry, null, 2));
}

async function handleSearch(ledgerPath: string): Promise<void> {
  const term = process.argv.slice(3).join(" ");
  if (!term) {
    console.error("Missing search term");
    process.exit(1);
  }

  const lowTerm = term.toLowerCase();
  const entries = await loadAllEntries(ledgerPath);
  const hits = entries.filter((e) =>
    JSON.stringify(e).toLowerCase().includes(lowTerm),
  );

  for (const e of hits) {
    printEntryLine(e);
  }
}

async function handleExplain(ledgerPath: string): Promise<void> {
  const arg = process.argv[3];
  if (!arg) {
    console.error("Usage: explain <id> or explain last [<n>]");
    process.exit(1);
  }

  const format: ExplainFormat = hasFlag("--md") ? "markdown" : "text";
  const entries = await loadAllEntries(ledgerPath);

  if (entries.length === 0) {
    console.error("No entries in ledger");
    process.exit(1);
  }

  let entry: AuditEntry | undefined;

  if (arg === "last") {
    const n = Number(process.argv[4]) || 1;
    if (n < 1 || n > entries.length) {
      console.error(
        `Invalid offset: ${n} (ledger has ${entries.length} entries)`,
      );
      process.exit(1);
    }
    entry = entries[entries.length - n];
  } else {
    entry = entries.find((x) => x.id === arg);
  }

  if (!entry) {
    console.error("Not found:", arg);
    process.exit(1);
  }

  console.log(formatExplain(entry, format));
}

function handleImport(ledgerPath: string): void {
  const format = process.argv[3];
  const inputFile = process.argv[4];

  if (format !== "clawdbot") {
    console.error(`Unknown import format: ${format}`);
    console.error("Supported formats: clawdbot");
    process.exit(1);
  }

  if (!inputFile) {
    console.error(
      "Usage: import clawdbot <file.jsonl> [--ledger <path>] [--dry-run]",
    );
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
  }

  const dryRun = hasFlag("--dry-run");
  const strictMode = hasFlag("--strict");
  const noRedact = hasFlag("--no-redact");
  const mode: RedactMode = strictMode ? "strict" : "redact";

  const content = fs.readFileSync(inputFile, "utf8");
  let imported = 0;
  let skipped = 0;

  for (const entry of parseClawdbotJsonl(content)) {
    let finalEntry = entry;

    if (!noRedact) {
      const result = applyRedaction(entry, mode);
      if (!result.ok) {
        console.error(`Skipping entry (secrets detected): ${entry.id}`);
        for (const match of result.error.matches) {
          console.error(`  - ${match}`);
        }
        skipped++;
        continue;
      }
      finalEntry = result.entry;
    }

    if (dryRun) {
      console.log(
        `[dry-run] ${finalEntry.id}  ${finalEntry.action.type}  ${finalEntry.action.summary}`,
      );
    } else {
      appendEntry({ ledgerPath }, finalEntry);
      printEntryLine(finalEntry);
    }
    imported++;
  }

  console.log(
    `\nImported: ${imported}, Skipped: ${skipped}${dryRun ? " (dry-run)" : ""}`,
  );
}

// ==================== Main ====================

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const ledgerPath = getArg("--ledger") || "./memory/action-ledger.jsonl";

  if (!cmd || cmd === "help" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  switch (cmd) {
    case "add":
      handleAdd(ledgerPath);
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
      handleImport(ledgerPath);
      break;
    default:
      console.error("Unknown command:", cmd);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
