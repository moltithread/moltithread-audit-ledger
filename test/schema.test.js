import test from "node:test";
import assert from "node:assert/strict";
import {
  AuditEntrySchema,
  ACTION_TYPES,
  isActionType,
  ContextSchema,
  ActionSchema,
  VerificationSchema,
} from "../dist/schema.js";

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

test("ACTION_TYPES contains all expected types", () => {
  const expectedTypes = [
    "file_write",
    "file_edit",
    "browser",
    "api_call",
    "exec",
    "message_send",
    "config_change",
    "other",
  ];

  assert.deepEqual([...ACTION_TYPES], expectedTypes);
});

test("isActionType returns true for valid types", () => {
  for (const type of ACTION_TYPES) {
    assert.ok(isActionType(type), `Expected "${type}" to be a valid action type`);
  }
});

test("isActionType returns false for invalid types", () => {
  const invalidTypes = ["invalid", "FILE_WRITE", "write", "", "null", "undefined"];

  for (const type of invalidTypes) {
    assert.ok(!isActionType(type), `Expected "${type}" to be invalid`);
  }
});

test("ContextSchema accepts valid context", () => {
  const context = {
    channel: "discord",
    session: "main",
    request: "req-123",
  };

  const parsed = ContextSchema.parse(context);
  assert.equal(parsed.channel, "discord");
});

test("ContextSchema allows optional fields", () => {
  const minimal = {};
  const parsed = ContextSchema.parse(minimal);
  assert.equal(parsed.channel, undefined);
  assert.equal(parsed.session, undefined);
});

test("ActionSchema validates type enum", () => {
  const validAction = {
    type: "file_edit",
    summary: "Updated file",
  };

  const parsed = ActionSchema.parse(validAction);
  assert.equal(parsed.type, "file_edit");
  assert.deepEqual(parsed.artifacts, []); // default value
});

test("ActionSchema rejects invalid type", () => {
  const invalidAction = {
    type: "invalid_type",
    summary: "Some action",
  };

  assert.throws(() => ActionSchema.parse(invalidAction));
});

test("ActionSchema requires summary", () => {
  const missingRequired = {
    type: "exec",
  };

  assert.throws(() => ActionSchema.parse(missingRequired));
});

test("VerificationSchema applies defaults", () => {
  const empty = {};
  const parsed = VerificationSchema.parse(empty);
  assert.deepEqual(parsed.suggested, []);
  assert.deepEqual(parsed.observed, []);
});

test("VerificationSchema accepts full data", () => {
  const full = {
    suggested: ["Run tests", "Check logs"],
    observed: ["Tests passed"],
  };

  const parsed = VerificationSchema.parse(full);
  assert.deepEqual(parsed.suggested, full.suggested);
  assert.deepEqual(parsed.observed, full.observed);
});

test("AuditEntrySchema applies all defaults", () => {
  const minimal = {
    id: "test-id",
    ts: "2026-01-31T12:00:00.000Z",
    action: {
      type: "exec",
      summary: "Ran command",
    },
  };

  const parsed = AuditEntrySchema.parse(minimal);
  assert.deepEqual(parsed.what_i_did, []);
  assert.deepEqual(parsed.assumptions, []);
  assert.deepEqual(parsed.uncertainties, []);
  assert.deepEqual(parsed.action.artifacts, []);
});

test("AuditEntrySchema accepts full entry", () => {
  const full = {
    id: "20260131T120000Z-abcd",
    ts: "2026-01-31T12:00:00.000Z",
    context: {
      channel: "discord",
      session: "agent:main",
    },
    action: {
      type: "file_write",
      summary: "Created config file",
      artifacts: ["config.json"],
    },
    what_i_did: ["Generated default config", "Wrote to disk"],
    assumptions: ["Default values are appropriate"],
    uncertainties: ["User preferences unknown"],
    verification: {
      suggested: ["Check file contents"],
      observed: ["File exists"],
    },
  };

  const parsed = AuditEntrySchema.parse(full);
  assert.equal(parsed.id, full.id);
  assert.equal(parsed.context?.channel, "discord");
  assert.deepEqual(parsed.what_i_did, full.what_i_did);
});

test("AuditEntrySchema rejects invalid timestamp format", () => {
  const badTimestamp = {
    id: "test-id",
    ts: "not-a-timestamp",
    action: { type: "other", summary: "test" },
  };

  assert.throws(() => AuditEntrySchema.parse(badTimestamp));
});

test("AuditEntrySchema rejects empty id", () => {
  const emptyId = {
    id: "",
    ts: "2026-01-31T00:00:00.000Z",
    action: { type: "other", summary: "test" },
  };

  assert.throws(() => AuditEntrySchema.parse(emptyId));
});

test("AuditEntrySchema rejects empty summary", () => {
  const emptySummary = {
    id: "test-id",
    ts: "2026-01-31T00:00:00.000Z",
    action: { type: "other", summary: "" },
  };

  assert.throws(() => AuditEntrySchema.parse(emptySummary));
});
