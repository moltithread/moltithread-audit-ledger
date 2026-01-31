import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { AuditEntrySchema } from "../dist/schema.js";
import { parseSystemEventsText, parseModelSwitchLine } from "../dist/adapters/system-events.js";

test("parseModelSwitchLine parses standard system message", () => {
  const line = "System: [2026-01-31 16:33:43 CST] Model switched to gpt (openai-codex/gpt-5.2).";
  assert.deepEqual(parseModelSwitchLine(line), {
    toAlias: "gpt",
    toModel: "openai-codex/gpt-5.2",
  });
});

test("parseModelSwitchLine ignores unrelated lines", () => {
  assert.equal(parseModelSwitchLine("hello"), null);
});

test("parseModelSwitchLine is total on arbitrary input (property-based)", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      assert.doesNotThrow(() => parseModelSwitchLine(s));
    }),
  );
});

test("parseSystemEventsText yields audit entries for model switches", () => {
  const text = [
    "noise",
    "Model switched to gpt (openai-codex/gpt-5.2).",
    "Model switched to opus (anthropic/claude-opus-4-5).",
  ].join("\n");

  const entries = Array.from(parseSystemEventsText(text));
  assert.equal(entries.length, 2);

  for (const e of entries) {
    assert.ok(AuditEntrySchema.safeParse(e).success);
    assert.equal(e.action.type, "config_change");
  }

  assert.match(entries[0].action.summary, /unknown → gpt/);
  assert.match(entries[1].action.summary, /gpt → opus/);
});

test("parseSystemEventsText yields entry for ledger restore (data integrity)", () => {
  const text = "RESTORED ledger from backup due to shrink (10 bytes vs prior 100 bytes). restoredFrom=action-ledger.a.jsonl currentBackup=action-ledger.b.jsonl";
  const entries = Array.from(parseSystemEventsText(text));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action.type, "other");
  assert.match(entries[0].action.summary, /Ledger restored from backup/);
});

test("parseSystemEventsText yields entry for cron exec failure (automation)", () => {
  const text = "System: [2026-01-31 16:40:46 CST] Cron: ⚠️ 🛠️ Exec: `node foo` failed: /tmp/x:13";
  const entries = Array.from(parseSystemEventsText(text));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action.type, "other");
  assert.match(entries[0].action.summary, /Cron exec failed: node foo/);
});

test("parseSystemEventsText yields entry for secrets detected (security)", () => {
  const text = "Skipping entry (secrets detected): 20260131T000000Z-secret";
  const entries = Array.from(parseSystemEventsText(text));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action.type, "other");
  assert.match(entries[0].action.summary, /Secrets detected/);
});

test("parseSystemEventsText never throws on arbitrary input (property-based)", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      assert.doesNotThrow(() => Array.from(parseSystemEventsText(s)));
    }),
  );
});
