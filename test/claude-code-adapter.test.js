import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeCodeToolCallSchema,
  transformToolCall,
  parseClaudeCodeJsonl,
  parseClaudeCodeEvent,
  transformBatch,
} from "../dist/adapters/claude-code.js";
import { AuditEntrySchema } from "../dist/schema.js";

// -----------------------------------------------------------------------------
// Schema validation
// -----------------------------------------------------------------------------

test("ClaudeCodeToolCallSchema validates minimal event", () => {
  const event = {
    tool_name: "Bash",
    success: true,
  };
  const result = ClaudeCodeToolCallSchema.parse(event);
  assert.equal(result.tool_name, "Bash");
  assert.equal(result.success, true);
  assert.deepEqual(result.tool_input, {});
});

test("ClaudeCodeToolCallSchema validates full event", () => {
  const event = {
    tool_name: "Bash",
    tool_input: { command: "ls -la" },
    tool_output: "file1.txt\nfile2.txt",
    session_id: "session-123",
    timestamp: "2026-01-31T12:00:00.000Z",
    success: true,
  };
  const result = ClaudeCodeToolCallSchema.parse(event);
  assert.equal(result.tool_name, "Bash");
  assert.deepEqual(result.tool_input, { command: "ls -la" });
  assert.equal(result.tool_output, "file1.txt\nfile2.txt");
  assert.equal(result.session_id, "session-123");
});

test("ClaudeCodeToolCallSchema defaults success to true", () => {
  const event = { tool_name: "Read" };
  const result = ClaudeCodeToolCallSchema.parse(event);
  assert.equal(result.success, true);
});

// -----------------------------------------------------------------------------
// Tool call transformation
// -----------------------------------------------------------------------------

test("transformToolCall produces valid AuditEntry for Read", () => {
  const event = {
    tool_name: "Read",
    tool_input: { file_path: "/path/to/file.ts" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "file_write");
  assert.ok(entry.action.summary.includes("Read file"));
  assert.deepEqual(entry.action.artifacts, ["/path/to/file.ts"]);
});

test("transformToolCall produces valid AuditEntry for Write", () => {
  const event = {
    tool_name: "Write",
    tool_input: { file_path: "/path/to/output.js" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "file_write");
  assert.ok(entry.action.summary.includes("Write file"));
});

test("transformToolCall produces valid AuditEntry for Edit", () => {
  const event = {
    tool_name: "Edit",
    tool_input: { file_path: "/path/to/file.ts", old_string: "foo", new_string: "bar" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "file_edit");
  assert.ok(entry.action.summary.includes("Edit file"));
});

test("transformToolCall produces valid AuditEntry for Bash", () => {
  const event = {
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "exec");
  assert.ok(entry.action.summary.includes("Execute"));
  assert.ok(entry.action.summary.includes("npm test"));
});

test("transformToolCall produces valid AuditEntry for WebFetch", () => {
  const event = {
    tool_name: "WebFetch",
    tool_input: { url: "https://example.com/api" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "api_call");
  assert.ok(entry.action.summary.includes("Fetch URL"));
  assert.deepEqual(entry.action.artifacts, ["https://example.com/api"]);
});

test("transformToolCall produces valid AuditEntry for WebSearch", () => {
  const event = {
    tool_name: "WebSearch",
    tool_input: { query: "Claude Code documentation" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "api_call");
  assert.ok(entry.action.summary.includes("Web search"));
});

test("transformToolCall produces valid AuditEntry for Glob", () => {
  const event = {
    tool_name: "Glob",
    tool_input: { pattern: "**/*.ts", path: "/project" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "file_write");
  assert.ok(entry.action.summary.includes("Glob"));
});

test("transformToolCall produces valid AuditEntry for Grep", () => {
  const event = {
    tool_name: "Grep",
    tool_input: { pattern: "function test", path: "/project/src" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "other");
  assert.ok(entry.action.summary.includes("Grep"));
});

test("transformToolCall produces valid AuditEntry for Task", () => {
  const event = {
    tool_name: "Task",
    tool_input: { subagent_type: "Explore", description: "find auth code" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "exec");
  assert.ok(entry.action.summary.includes("Task"));
  assert.ok(entry.action.summary.includes("Explore"));
});

test("transformToolCall produces valid AuditEntry for NotebookEdit", () => {
  const event = {
    tool_name: "NotebookEdit",
    tool_input: { notebook_path: "/path/to/notebook.ipynb", edit_mode: "replace" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "file_edit");
  assert.ok(entry.action.summary.includes("Edit notebook"));
});

test("transformToolCall handles failure result", () => {
  const event = {
    tool_name: "Bash",
    tool_input: { command: "false" },
    tool_output: "Command failed",
    success: false,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.ok(entry.action.summary.includes("(failed)"));
  assert.ok(entry.uncertainties.some((u) => u.includes("failed")));
});

test("transformToolCall includes session context when provided", () => {
  const event = {
    tool_name: "Read",
    tool_input: { file_path: "/file.txt" },
    session_id: "test-session-xyz",
    success: true,
  };
  const entry = transformToolCall(event);
  assert.equal(entry.context?.session, "test-session-xyz");
});

test("transformToolCall omits context when no session", () => {
  const event = {
    tool_name: "Read",
    tool_input: { file_path: "/file.txt" },
    success: true,
  };
  const entry = transformToolCall(event);
  assert.equal(entry.context, undefined);
});

test("transformToolCall accepts override options", () => {
  const event = {
    tool_name: "Bash",
    tool_input: { command: "echo test" },
    success: true,
  };
  const entry = transformToolCall(event, {
    id: "custom-id",
    assumptions: ["Assumed shell is bash"],
    uncertainties: ["Unknown encoding"],
  });
  assert.equal(entry.id, "custom-id");
  assert.deepEqual(entry.assumptions, ["Assumed shell is bash"]);
  assert.ok(entry.uncertainties.includes("Unknown encoding"));
});

test("transformToolCall handles unknown tool gracefully", () => {
  const event = {
    tool_name: "UnknownTool",
    tool_input: { foo: "bar" },
    success: true,
  };
  const entry = transformToolCall(event);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "other");
  assert.ok(entry.action.summary.includes("UnknownTool"));
});

test("transformToolCall uses current time when timestamp not provided", () => {
  const before = new Date().toISOString();
  const event = { tool_name: "Read", success: true };
  const entry = transformToolCall(event);
  const after = new Date().toISOString();

  assert.ok(entry.ts >= before);
  assert.ok(entry.ts <= after);
});

test("transformToolCall uses provided timestamp", () => {
  const event = {
    tool_name: "Read",
    timestamp: "2026-01-15T10:30:00.000Z",
    success: true,
  };
  const entry = transformToolCall(event);
  assert.equal(entry.ts, "2026-01-15T10:30:00.000Z");
});

// -----------------------------------------------------------------------------
// JSONL parsing
// -----------------------------------------------------------------------------

test("parseClaudeCodeJsonl parses multiple lines", () => {
  const jsonl = [
    '{"tool_name":"Read","tool_input":{"file_path":"a.ts"},"success":true}',
    '{"tool_name":"Edit","tool_input":{"file_path":"b.ts"},"success":true}',
    '{"tool_name":"Bash","tool_input":{"command":"npm test"},"success":true}',
  ].join("\n");

  const entries = [...parseClaudeCodeJsonl(jsonl)];
  assert.equal(entries.length, 3);
  assert.equal(entries[0].action.type, "file_write");
  assert.equal(entries[1].action.type, "file_edit");
  assert.equal(entries[2].action.type, "exec");
});

test("parseClaudeCodeJsonl skips empty lines", () => {
  const jsonl = [
    '{"tool_name":"Read","success":true}',
    "",
    '{"tool_name":"Edit","success":true}',
    "   ",
  ].join("\n");

  const entries = [...parseClaudeCodeJsonl(jsonl)];
  assert.equal(entries.length, 2);
});

test("parseClaudeCodeJsonl skips invalid lines", () => {
  const jsonl = [
    '{"tool_name":"Read","success":true}',
    "this is not json",
    '{"tool_name":"Edit","success":true}',
  ].join("\n");

  const entries = [...parseClaudeCodeJsonl(jsonl)];
  assert.equal(entries.length, 2);
});

test("parseClaudeCodeEvent parses single JSON string", () => {
  const json = '{"tool_name":"Bash","tool_input":{"command":"ls"},"success":true}';
  const entry = parseClaudeCodeEvent(json);
  AuditEntrySchema.parse(entry);
  assert.equal(entry.action.type, "exec");
});

// -----------------------------------------------------------------------------
// Batch transformation
// -----------------------------------------------------------------------------

test("transformBatch transforms multiple events", () => {
  const events = [
    { tool_name: "Read", tool_input: { file_path: "a.ts" }, success: true },
    { tool_name: "Write", tool_input: { file_path: "b.ts" }, success: true },
  ];
  const entries = transformBatch(events);
  assert.equal(entries.length, 2);
  entries.forEach((e) => AuditEntrySchema.parse(e));
});

// -----------------------------------------------------------------------------
// what_i_did generation
// -----------------------------------------------------------------------------

test("transformToolCall generates meaningful what_i_did for Read", () => {
  const event = {
    tool_name: "Read",
    tool_input: { file_path: "/src/main.ts", offset: 10, limit: 50 },
    success: true,
  };
  const entry = transformToolCall(event);
  assert.ok(entry.what_i_did.some((s) => s.includes("Read contents")));
  assert.ok(entry.what_i_did.some((s) => s.includes("offset")));
});

test("transformToolCall generates meaningful what_i_did for Bash", () => {
  const event = {
    tool_name: "Bash",
    tool_input: { command: "npm run build", timeout: 60000 },
    success: true,
  };
  const entry = transformToolCall(event);
  assert.ok(entry.what_i_did.some((s) => s.includes("Executed shell command")));
  assert.ok(entry.what_i_did.some((s) => s.includes("Timeout")));
});

test("transformToolCall includes error in what_i_did on failure", () => {
  const event = {
    tool_name: "Bash",
    tool_input: { command: "bad-command" },
    tool_output: "command not found",
    success: false,
  };
  const entry = transformToolCall(event);
  assert.ok(entry.what_i_did.some((s) => s.includes("Error")));
});
