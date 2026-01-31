import test from "node:test";
import assert from "node:assert/strict";
import { AuditEntrySchema } from "../dist/schema.js";

test("schema accepts minimal valid entry", () => {
  const e = {
    id: "20260131T000000Z-abcd",
    ts: "2026-01-31T00:00:00.000Z",
    action: { type: "other", summary: "x", artifacts: [] },
    what_i_did: [],
    assumptions: [],
    uncertainties: [],
  };

  const parsed = AuditEntrySchema.parse(e);
  assert.equal(parsed.id, e.id);
});
