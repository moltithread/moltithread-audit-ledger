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

test("parseSystemEventsText never throws on arbitrary input (property-based)", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      assert.doesNotThrow(() => Array.from(parseSystemEventsText(s)));
    }),
  );
});
