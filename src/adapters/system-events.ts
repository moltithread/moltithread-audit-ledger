import { AuditEntrySchema, type AuditEntry } from "../schema.js";
import { makeId } from "../ledger.js";

export type ModelSwitch = {
  toAlias: string;
  toModel: string;
};

// Accepts:
// - "Model switched to opus (anthropic/claude-opus-4-5)."
// - "System: [..] Model switched to gpt (openai-codex/gpt-5.2)."
const MODEL_SWITCH_RE = /\bModel switched to\s+([^\s]+)\s+\(([^)]+)\)\./;

/**
 * Total function: returns null if the line is not a model switch.
 */
export function parseModelSwitchLine(line: string): ModelSwitch | null {
  const m = MODEL_SWITCH_RE.exec(line);
  if (!m) return null;

  const toAlias = m[1];
  const toModel = m[2];
  if (!toAlias || !toModel) return null;

  return { toAlias, toModel };
}

type ParseCtx = { channel?: string; session?: string };

type State = {
  lastModelAlias?: string;
};

type LineParser = (line: string, state: State, ctx: ParseCtx) => AuditEntry | null;

function parseLedgerRestoreLine(line: string) {
  const m = /^RESTORED ledger from backup due to (.+)\. restoredFrom=(\S+) currentBackup=(\S+)$/.exec(line);
  if (!m) return null;
  return { reason: m[1], restoredFrom: m[2], currentBackup: m[3] };
}

function parseCronFailureLine(line: string) {
  const m = /\bCron:\s+.*Exec:\s+`([^`]+)`\s+failed:\s*(.+)$/.exec(line);
  if (!m) return null;
  return { command: m[1], detail: m[2] };
}

function parseSecretsDetectedLine(line: string) {
  if (!/secrets detected/i.test(line)) return null;
  return { line };
}

function makeEntry(now: Date, ctx: ParseCtx, action: AuditEntry["action"], what: string[], assume: string[], unsure: string[]) {
  return AuditEntrySchema.parse({
    id: makeId(now),
    ts: now.toISOString(),
    context: {
      channel: ctx.channel,
      session: ctx.session,
      request: "system event",
    },
    action,
    what_i_did: what,
    assumptions: assume,
    uncertainties: unsure,
    verification: {
      suggested: [],
      observed: [],
    },
  });
}

const PARSERS: LineParser[] = [
  (line, state, ctx) => {
    const sw = parseModelSwitchLine(line);
    if (!sw) return null;

    const from = state.lastModelAlias ?? "unknown";
    state.lastModelAlias = sw.toAlias;

    const now = new Date();
    return makeEntry(
      now,
      ctx,
      {
        type: "config_change",
        summary: `Model switched ${from} → ${sw.toAlias} (${sw.toModel})`,
        artifacts: [],
      },
      [`Parsed system event line: ${line}`, `Recorded model change ${from} → ${sw.toAlias}`],
      ["System model switch events are reliable signals"],
      ["Whether the switch was automatic or manual"],
    );
  },

  (line, _state, ctx) => {
    const r = parseLedgerRestoreLine(line);
    if (!r) return null;

    const now = new Date();
    return makeEntry(
      now,
      ctx,
      {
        type: "other",
        summary: `Ledger restored from backup (${r.reason})`,
        artifacts: [r.restoredFrom, r.currentBackup],
      },
      [
        `Observed guard restore event: ${line}`,
        `Restored from ${r.restoredFrom} (current backup ${r.currentBackup})`,
      ],
      ["Guard restore output is a reliable indicator of data integrity recovery"],
      ["Whether any entries were lost between backup intervals"],
    );
  },

  (line, _state, ctx) => {
    const f = parseCronFailureLine(line);
    if (!f) return null;

    const now = new Date();
    return makeEntry(
      now,
      ctx,
      {
        type: "other",
        summary: `Cron exec failed: ${f.command}`,
        artifacts: [],
      },
      [`Observed cron failure system event`, `Command: ${f.command}`, `Detail: ${f.detail}`],
      ["Cron failure lines indicate unattended automation failure"],
      ["Which specific job emitted this line (may be missing from the message)"],
    );
  },

  (line, _state, ctx) => {
    const s = parseSecretsDetectedLine(line);
    if (!s) return null;

    const now = new Date();
    return makeEntry(
      now,
      ctx,
      {
        type: "other",
        summary: "Secrets detected (redaction/strict mode)",
        artifacts: [],
      },
      [`Observed secrets-detected signal: ${s.line}`],
      ["A secrets-detected signal should be treated as a security boundary event"],
      ["Whether the secret was fully redacted everywhere it appeared"],
    );
  },
];

export function* parseSystemEventsText(
  text: string,
  opts: ParseCtx = {},
): Generator<AuditEntry> {
  const state: State = {};

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    for (const parse of PARSERS) {
      const entry = parse(line, state, opts);
      if (entry) {
        yield entry;
        break;
      }
    }
  }
}
