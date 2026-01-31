import test from "node:test";
import assert from "node:assert/strict";
import {
  transformToolCall,
  parseClawdbotJsonl,
  transformBatch,
  parseJsonlLine,
  ClawdbotToolCallSchema,
} from "../dist/adapters/clawdbot.js";

// ==================== Schema validation tests ====================

test("ClawdbotToolCallSchema validates minimal event", () => {
  const event = {
    tool: "Read",
    result: "success",
  };
  const parsed = ClawdbotToolCallSchema.parse(event);
  assert.equal(parsed.tool, "Read");
  assert.equal(parsed.result, "success");
  assert.deepEqual(parsed.arguments, {});
  assert.deepEqual(parsed.files, []);
});

test("ClawdbotToolCallSchema validates full event", () => {
  const event = {
    tool: "exec",
    arguments: { command: "ls -la" },
    result: "success",
    timestamp: "2026-01-31T00:00:00.000Z",
    files: ["output.txt"],
    channel: "discord",
    session: "main",
    request: "list files",
    output: "file1.txt\nfile2.txt",
  };
  const parsed = ClawdbotToolCallSchema.parse(event);
  assert.equal(parsed.tool, "exec");
  assert.equal(parsed.arguments.command, "ls -la");
  assert.equal(parsed.channel, "discord");
});

test("ClawdbotToolCallSchema rejects invalid result", () => {
  const event = {
    tool: "Read",
    result: "maybe",
  };
  assert.throws(() => ClawdbotToolCallSchema.parse(event));
});

// ==================== transformToolCall tests ====================

test("transformToolCall creates valid audit entry", () => {
  const event = {
    tool: "Write",
    arguments: { path: "test.txt" },
    result: "success",
    timestamp: "2026-01-31T10:00:00.000Z",
  };

  const entry = transformToolCall(event);
  assert.ok(entry.id);
  assert.equal(entry.ts, "2026-01-31T10:00:00.000Z");
  assert.equal(entry.action.type, "file_write");
  assert.ok(entry.action.summary.includes("Write file"));
  assert.ok(entry.action.artifacts.includes("test.txt"));
});

test("transformToolCall maps tool types correctly", () => {
  const toolMappings = [
    { tool: "Read", expectedType: "file_write" },
    { tool: "Write", expectedType: "file_write" },
    { tool: "Edit", expectedType: "file_edit" },
    { tool: "exec", expectedType: "exec" },
    { tool: "browser", expectedType: "browser" },
    { tool: "web_search", expectedType: "api_call" },
    { tool: "message", expectedType: "message_send" },
    { tool: "unknown_tool", expectedType: "other" },
  ];

  for (const { tool, expectedType } of toolMappings) {
    const event = { tool, result: "success" };
    const entry = transformToolCall(event);
    assert.equal(
      entry.action.type,
      expectedType,
      `Tool "${tool}" should map to "${expectedType}"`,
    );
  }
});

test("transformToolCall generates appropriate summaries", () => {
  const cases = [
    {
      tool: "Read",
      args: { path: "/foo/bar.txt" },
      expect: "Read file: /foo/bar.txt",
    },
    {
      tool: "exec",
      args: { command: "npm test" },
      expect: "Execute: npm test",
    },
    {
      tool: "web_search",
      args: { query: "hello world" },
      expect: "Web search: hello world",
    },
  ];

  for (const { tool, args, expect } of cases) {
    const entry = transformToolCall({
      tool,
      arguments: args,
      result: "success",
    });
    assert.ok(
      entry.action.summary.includes(expect),
      `Summary for ${tool} should include "${expect}", got "${entry.action.summary}"`,
    );
  }
});

test("transformToolCall includes failure status in summary", () => {
  const event = {
    tool: "exec",
    arguments: { command: "false" },
    result: "failure",
    error: "Command failed",
  };

  const entry = transformToolCall(event);
  assert.ok(entry.action.summary.includes("(failed)"));
  assert.ok(entry.uncertainties.some((u) => u.includes("failed")));
});

test("transformToolCall extracts artifacts from file operations", () => {
  const event = {
    tool: "Edit",
    arguments: { path: "src/main.ts" },
    result: "success",
    files: ["src/backup.ts"],
  };

  const entry = transformToolCall(event);
  assert.ok(entry.action.artifacts.includes("src/main.ts"));
  assert.ok(entry.action.artifacts.includes("src/backup.ts"));
});

test("transformToolCall preserves context fields", () => {
  const event = {
    tool: "message",
    arguments: { action: "send", target: "general" },
    result: "success",
    channel: "discord",
    session: "main-session",
    request: "say hello",
  };

  const entry = transformToolCall(event);
  assert.equal(entry.context?.channel, "discord");
  assert.equal(entry.context?.session, "main-session");
  assert.equal(entry.context?.request, "say hello");
});

test("transformToolCall removes empty context", () => {
  const event = {
    tool: "Read",
    arguments: { path: "file.txt" },
    result: "success",
  };

  const entry = transformToolCall(event);
  assert.equal(entry.context, undefined);
});

test("transformToolCall accepts custom options", () => {
  const event = { tool: "exec", result: "success" };
  const entry = transformToolCall(event, {
    id: "custom-id",
    assumptions: ["User has permissions"],
    uncertainties: ["May timeout"],
    suggestedVerification: ["Check output"],
  });

  assert.equal(entry.id, "custom-id");
  assert.ok(entry.assumptions.includes("User has permissions"));
  assert.ok(entry.uncertainties.includes("May timeout"));
  assert.ok(entry.verification?.suggested.includes("Check output"));
});

// ==================== parseJsonlLine tests ====================

test("parseJsonlLine returns ok for valid line", () => {
  const line = JSON.stringify({ tool: "Read", result: "success" });
  const result = parseJsonlLine(line);
  assert.ok(result.ok);
  assert.ok(result.entry);
});

test("parseJsonlLine returns error for empty line", () => {
  const result = parseJsonlLine("");
  assert.ok(!result.ok);
  assert.equal(result.error, "Empty line");
});

test("parseJsonlLine returns error for invalid JSON", () => {
  const result = parseJsonlLine("{invalid json}");
  assert.ok(!result.ok);
  assert.ok(result.error.length > 0);
});

test("parseJsonlLine returns error for invalid schema", () => {
  const line = JSON.stringify({ tool: "Read" }); // missing result
  const result = parseJsonlLine(line);
  assert.ok(!result.ok);
  assert.ok(result.error.length > 0);
});

// ==================== parseClawdbotJsonl tests ====================

test("parseClawdbotJsonl parses multiple lines", () => {
  const jsonl = [
    JSON.stringify({
      tool: "Read",
      result: "success",
      arguments: { path: "a.txt" },
    }),
    JSON.stringify({
      tool: "Write",
      result: "success",
      arguments: { path: "b.txt" },
    }),
  ].join("\n");

  const entries = [...parseClawdbotJsonl(jsonl)];
  assert.equal(entries.length, 2);
  assert.ok(entries[0].action.summary.includes("Read"));
  assert.ok(entries[1].action.summary.includes("Write"));
});

test("parseClawdbotJsonl skips empty lines", () => {
  const jsonl = [
    JSON.stringify({ tool: "Read", result: "success" }),
    "",
    "   ",
    JSON.stringify({ tool: "Write", result: "success" }),
  ].join("\n");

  const entries = [...parseClawdbotJsonl(jsonl)];
  assert.equal(entries.length, 2);
});

test("parseClawdbotJsonl skips invalid lines gracefully", () => {
  const jsonl = [
    JSON.stringify({ tool: "Read", result: "success" }),
    "{invalid}",
    JSON.stringify({ tool: "Write", result: "success" }),
  ].join("\n");

  const entries = [...parseClawdbotJsonl(jsonl)];
  assert.equal(entries.length, 2);
});

// ==================== transformBatch tests ====================

test("transformBatch transforms multiple events", () => {
  const events = [
    { tool: "Read", result: "success" },
    { tool: "Write", result: "failure" },
  ];

  const entries = transformBatch(events);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].action.type, "file_write");
  assert.equal(entries[1].action.type, "file_write");
});
