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

export function* parseSystemEventsText(
  text: string,
  opts: { channel?: string; session?: string } = {},
): Generator<AuditEntry> {
  const lines = text.split("\n");
  let prev: ModelSwitch | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const sw = parseModelSwitchLine(line);
    if (!sw) continue;

    const from = prev?.toAlias ?? "unknown";
    const now = new Date();

    const entry = AuditEntrySchema.parse({
      id: makeId(now),
      ts: now.toISOString(),
      context: {
        channel: opts.channel,
        session: opts.session,
        request: "system event: model switch",
      },
      action: {
        type: "config_change",
        summary: `Model switched ${from} → ${sw.toAlias} (${sw.toModel})`,
        artifacts: [],
      },
      what_i_did: [
        `Parsed system event line: ${line}`,
        `Recorded model change ${from} → ${sw.toAlias}`,
      ],
      assumptions: [
        "System model switch events are reliable signals",
        "Auditing model switches helps interpret behavior and cost",
      ],
      uncertainties: [
        "Whether the switch was automatic or manual",
        "Whether other runtime toggles changed at the same time",
      ],
      verification: {
        suggested: [
          "Confirm future system messages reflect the new model",
          "Confirm behavior/cost changes align with the new model",
        ],
        observed: [],
      },
    });

    yield entry;
    prev = sw;
  }
}
