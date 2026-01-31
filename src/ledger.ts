import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { AuditEntrySchema, type AuditEntry } from "./schema.js";

export type LedgerOptions = {
  ledgerPath: string;
};

export async function* readEntries(opts: LedgerOptions): AsyncGenerator<AuditEntry> {
  if (!fs.existsSync(opts.ledgerPath)) return;

  const stream = fs.createReadStream(opts.ledgerPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed);
    const entry = AuditEntrySchema.parse(parsed);
    yield entry;
  }
}

export function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

export function appendEntry(opts: LedgerOptions, entry: AuditEntry) {
  ensureDir(opts.ledgerPath);
  const line = JSON.stringify(entry);
  fs.appendFileSync(opts.ledgerPath, line + "\n", { encoding: "utf8" });
}

export function makeId(now = new Date()) {
  // 2026-01-31T03:46:56.406Z -> 20260131T034656Z
  const iso = now.toISOString();
  const compact = iso
    .replace(/[-:]/g, "")
    .replace(/\..+Z$/, "Z")
    .replace("T", "T");
  // add a short random suffix
  const suffix = Math.random().toString(16).slice(2, 6);
  return `${compact}-${suffix}`;
}
