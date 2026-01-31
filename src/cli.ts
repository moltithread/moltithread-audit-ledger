#!/usr/bin/env node

import { appendEntry, makeId, readEntries } from "./ledger.js";
import { AuditEntrySchema, type AuditEntry } from "./schema.js";
import { redactObject, RedactionError, type RedactMode } from "./redact.js";

function getArg(flag: string) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function getArgs(flag: string) {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag) out.push(process.argv[i + 1]);
  }
  return out.filter(Boolean);
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function usage() {
  console.log(`audit-ledger

Commands:
  add --type <type> --summary <text> [--artifact <x> ...] [--did <x> ...] [--assume <x> ...] [--unsure <x> ...] [--suggest <x> ...] [--observed <x> ...] [--ledger <path>] [--strict] [--no-redact]
  last <n> [--ledger <path>]
  show <id> [--ledger <path>]
  search <term> [--ledger <path>]

Types:
  file_write | file_edit | browser | api_call | exec | message_send | config_change | other

Options:
  --strict     Reject entries containing detected secrets (fail instead of redact)
  --no-redact  Disable automatic redaction (not recommended)
`);
}

const cmd = process.argv[2];
const ledgerPath = getArg("--ledger") || "./memory/action-ledger.jsonl";

if (!cmd || cmd === "help" || cmd === "--help") {
  usage();
  process.exit(0);
}

if (cmd === "add") {
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
      // runtime validated by schema
      type: type as AuditEntry["action"]["type"],
      summary,
      artifacts: getArgs("--artifact")
    },
    what_i_did: getArgs("--did"),
    assumptions: getArgs("--assume"),
    uncertainties: getArgs("--unsure"),
    verification: {
      suggested: getArgs("--suggest"),
      observed: getArgs("--observed")
    }
  };

  let validated = AuditEntrySchema.parse(entry);

  // Apply redaction unless explicitly disabled
  if (!noRedact) {
    const mode: RedactMode = strictMode ? "strict" : "redact";
    try {
      validated = redactObject(validated, { mode });
    } catch (e) {
      if (e instanceof RedactionError) {
        console.error("Error: Entry contains potential secrets:");
        for (const match of e.matches) {
          console.error(`  - ${match}`);
        }
        console.error("\nUse --no-redact to bypass (not recommended).");
        process.exit(1);
      }
      throw e;
    }
  }

  appendEntry({ ledgerPath }, validated);
  console.log(validated.id);
  process.exit(0);
}

async function loadAll() {
  const entries: AuditEntry[] = [];
  for await (const e of readEntries({ ledgerPath })) entries.push(e);
  return entries;
}

if (cmd === "last") {
  const n = Number(process.argv[3] || 10);
  const entries = await loadAll();
  const slice = entries.slice(-n);
  for (const e of slice) {
    console.log(`${e.id}  ${e.ts}  ${e.action.type}  ${e.action.summary}`);
  }
  process.exit(0);
}

if (cmd === "show") {
  const id = process.argv[3];
  if (!id) {
    console.error("Missing id");
    process.exit(1);
  }
  const entries = await loadAll();
  const e = entries.find((x) => x.id === id);
  if (!e) {
    console.error("Not found:", id);
    process.exit(1);
  }
  console.log(JSON.stringify(e, null, 2));
  process.exit(0);
}

if (cmd === "search") {
  const term = process.argv.slice(3).join(" ");
  if (!term) {
    console.error("Missing search term");
    process.exit(1);
  }
  const low = term.toLowerCase();
  const entries = await loadAll();
  const hits = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(low));
  for (const e of hits) {
    console.log(`${e.id}  ${e.ts}  ${e.action.type}  ${e.action.summary}`);
  }
  process.exit(0);
}

console.error("Unknown command:", cmd);
usage();
process.exit(1);
