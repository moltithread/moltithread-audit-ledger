import test from "node:test";
import assert from "node:assert/strict";
import {
  transformToolCall,
  parseClawdbotJsonl,
  transformBatch,
  ClawdbotToolCallSchema,
} from "../dist/adapters/clawdbot.js";

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
    tool: "Write",
    arguments: { path: "/tmp/test.txt", content: "hello" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
    files: ["/tmp/test.txt"],
    channel: "discord",
    session: "agent:main:main",
    request: "Create a test file",
  };
  const parsed = ClawdbotToolCallSchema.parse(event);
  assert.equal(parsed.tool, "Write");
  assert.equal(parsed.channel, "discord");
  assert.deepEqual(parsed.files, ["/tmp/test.txt"]);
});

test("transformToolCall produces valid AuditEntry for Read", () => {
  const event = {
    tool: "Read",
    arguments: { path: "/etc/hosts" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.ok(entry.id);
  assert.equal(entry.ts, "2026-01-31T12:00:00.000Z");
  assert.equal(entry.action.type, "file_read",
    "Read tool should map to file_read, not file_write");
  assert.ok(entry.action.summary.includes("Read file"));
  assert.ok(entry.action.summary.includes("/etc/hosts"));
  assert.ok(entry.action.artifacts.includes("/etc/hosts"));
  assert.ok(entry.what_i_did.some((s) => s.includes("/etc/hosts")));
});

test("transformToolCall produces valid AuditEntry for Write", () => {
  const event = {
    tool: "Write",
    arguments: { path: "/tmp/output.txt", content: "data" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "file_write");
  assert.ok(entry.action.summary.includes("Write file"));
  assert.ok(entry.action.artifacts.includes("/tmp/output.txt"));
});

test("transformToolCall produces valid AuditEntry for Edit", () => {
  const event = {
    tool: "Edit",
    arguments: { path: "README.md", oldText: "old", newText: "new" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "file_edit");
  assert.ok(entry.action.summary.includes("Edit file"));
  assert.ok(entry.what_i_did.some((s) => s.includes("Replaced specific text")));
});

test("transformToolCall produces valid AuditEntry for exec", () => {
  const event = {
    tool: "exec",
    arguments: { command: "ls -la /tmp", workdir: "/home" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "exec");
  assert.ok(entry.action.summary.includes("Execute:"));
  assert.ok(entry.action.summary.includes("ls -la"));
  assert.ok(entry.what_i_did.some((s) => s.includes("Executed shell command")));
  assert.ok(
    entry.what_i_did.some((s) => s.includes("Working directory: /home")),
  );
});

test("transformToolCall produces valid AuditEntry for browser", () => {
  const event = {
    tool: "browser",
    arguments: { action: "navigate", targetUrl: "https://example.com" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "browser");
  assert.ok(entry.action.summary.includes("Browser navigate"));
  assert.ok(entry.action.artifacts.includes("https://example.com"));
});

test("transformToolCall produces valid AuditEntry for web_search", () => {
  const event = {
    tool: "web_search",
    arguments: { query: "TypeScript zod validation", count: 5 },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "api_call");
  assert.ok(entry.action.summary.includes("Web search"));
  assert.ok(entry.action.summary.includes("TypeScript zod"));
});

test("transformToolCall produces valid AuditEntry for web_fetch", () => {
  const event = {
    tool: "web_fetch",
    arguments: { url: "https://api.example.com/data", extractMode: "markdown" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "api_call");
  assert.ok(entry.action.summary.includes("Fetch URL"));
  assert.ok(entry.action.artifacts.includes("https://api.example.com/data"));
});

test("transformToolCall produces valid AuditEntry for message", () => {
  const event = {
    tool: "message",
    arguments: { action: "send", target: "general", message: "Hello" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "message_send");
  assert.ok(entry.action.summary.includes("Message send"));
  assert.ok(entry.action.summary.includes("general"));
});

test("transformToolCall handles failure result", () => {
  const event = {
    tool: "Write",
    arguments: { path: "/root/forbidden.txt" },
    result: "failure",
    error: "Permission denied",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.ok(entry.action.summary.includes("(failed)"));
  assert.ok(entry.uncertainties.some((u) => u.includes("failed")));
  assert.ok(entry.what_i_did.some((s) => s.includes("Permission denied")));
});

test("transformToolCall includes context when provided", () => {
  const event = {
    tool: "exec",
    arguments: { command: "echo test" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
    channel: "discord",
    session: "agent:main:subagent:abc",
    request: "Run a quick test",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.context?.channel, "discord");
  assert.equal(entry.context?.session, "agent:main:subagent:abc");
  assert.equal(entry.context?.request, "Run a quick test");
});

test("transformToolCall accepts override options", () => {
  const event = {
    tool: "Read",
    arguments: { path: "/etc/passwd" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event, {
    id: "custom-id-123",
    assumptions: ["File exists", "User has read access"],
    uncertainties: ["File might be symlinked"],
    suggestedVerification: ["Check file contents"],
  });

  assert.equal(entry.id, "custom-id-123");
  assert.ok(entry.assumptions.includes("File exists"));
  assert.ok(entry.uncertainties.some((u) => u.includes("symlinked")));
  assert.ok(entry.verification?.suggested?.includes("Check file contents"));
});

test("transformToolCall extracts files from explicit files array", () => {
  const event = {
    tool: "exec",
    arguments: { command: "touch a.txt b.txt" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
    files: ["a.txt", "b.txt"],
  };
  const entry = transformToolCall(event);

  assert.ok(entry.action.artifacts.includes("a.txt"));
  assert.ok(entry.action.artifacts.includes("b.txt"));
});

test("transformToolCall handles unknown tool gracefully", () => {
  const event = {
    tool: "custom_tool",
    arguments: { foo: "bar" },
    result: "success",
    timestamp: "2026-01-31T12:00:00.000Z",
  };
  const entry = transformToolCall(event);

  assert.equal(entry.action.type, "other");
  assert.equal(entry.action.summary, "custom_tool");
});

test("parseClawdbotJsonl parses multiple lines", () => {
  const jsonl = `
{"tool": "Read", "arguments": {"path": "a.txt"}, "result": "success", "timestamp": "2026-01-31T12:00:00.000Z"}
{"tool": "Write", "arguments": {"path": "b.txt"}, "result": "success", "timestamp": "2026-01-31T12:01:00.000Z"}

{"tool": "Edit", "arguments": {"path": "c.txt"}, "result": "failure", "timestamp": "2026-01-31T12:02:00.000Z"}
`;

  const entries = [...parseClawdbotJsonl(jsonl)];
  assert.equal(entries.length, 3);
  assert.equal(entries[0].action.type, "file_read");
  assert.equal(entries[1].action.type, "file_write");
  assert.equal(entries[2].action.type, "file_edit");
});

test("parseClawdbotJsonl skips invalid lines", () => {
  const jsonl = `
{"tool": "Read", "arguments": {"path": "a.txt"}, "result": "success", "timestamp": "2026-01-31T12:00:00.000Z"}
this is not json
{"tool": "Write", "arguments": {"path": "b.txt"}, "result": "success", "timestamp": "2026-01-31T12:01:00.000Z"}
`;

  const entries = [...parseClawdbotJsonl(jsonl)];
  assert.equal(entries.length, 2);
});

test("transformBatch transforms multiple events", () => {
  const events = [
    {
      tool: "Read",
      arguments: { path: "a.txt" },
      result: "success",
      timestamp: "2026-01-31T12:00:00.000Z",
    },
    {
      tool: "Write",
      arguments: { path: "b.txt" },
      result: "success",
      timestamp: "2026-01-31T12:01:00.000Z",
    },
  ];

  const entries = transformBatch(events);
  assert.equal(entries.length, 2);
  assert.ok(entries[0].action.summary.includes("Read"));
  assert.ok(entries[1].action.summary.includes("Write"));
});

test("transformToolCall uses current time when timestamp not provided", () => {
  const before = new Date();
  const event = {
    tool: "Read",
    arguments: { path: "test.txt" },
    result: "success",
  };
  const entry = transformToolCall(event);
  const after = new Date();

  const entryTime = new Date(entry.ts);
  assert.ok(entryTime >= before);
  assert.ok(entryTime <= after);
});

// -----------------------------------------------------------------------------
// Read vs Write type distinction
// -----------------------------------------------------------------------------

test("Read and Write produce different action types", () => {
  const readEvent = { tool: "Read", arguments: { path: "/foo.ts" }, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
  const writeEvent = { tool: "Write", arguments: { path: "/foo.ts" }, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
  const readEntry = transformToolCall(readEvent);
  const writeEntry = transformToolCall(writeEvent);

  assert.equal(readEntry.action.type, "file_read");
  assert.equal(writeEntry.action.type, "file_write");
  assert.notEqual(readEntry.action.type, writeEntry.action.type,
    "Read and Write must have distinct action types");
});

test("Edit produces file_edit, distinct from file_read and file_write", () => {
  const readEvent = { tool: "Read", arguments: { path: "/foo.ts" }, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
  const writeEvent = { tool: "Write", arguments: { path: "/foo.ts" }, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
  const editEvent = { tool: "Edit", arguments: { path: "/foo.ts" }, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };

  const readEntry = transformToolCall(readEvent);
  const writeEntry = transformToolCall(writeEvent);
  const editEntry = transformToolCall(editEvent);

  assert.equal(editEntry.action.type, "file_edit");
  assert.notEqual(editEntry.action.type, readEntry.action.type);
  assert.notEqual(editEntry.action.type, writeEntry.action.type);
});

// -----------------------------------------------------------------------------
// Property-based tests
// -----------------------------------------------------------------------------

import fc from "fast-check";

test("property: Read tool always produces file_read", () => {
  fc.assert(fc.property(
    fc.record({
      path: fc.string(),
      offset: fc.option(fc.nat(), { nil: undefined }),
      limit: fc.option(fc.nat(), { nil: undefined })
    }),
    (params) => {
      const event = { tool: "Read", arguments: params, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const entry = transformToolCall(event);
      return entry.action.type === "file_read";
    }
  ));
});

test("property: Write tool always produces file_write", () => {
  fc.assert(fc.property(
    fc.record({
      path: fc.string(),
      content: fc.string()
    }),
    (params) => {
      const event = { tool: "Write", arguments: params, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const entry = transformToolCall(event);
      return entry.action.type === "file_write";
    }
  ));
});

test("property: Edit tool always produces file_edit", () => {
  fc.assert(fc.property(
    fc.record({
      path: fc.string(),
      oldText: fc.string(),
      newText: fc.string()
    }),
    (params) => {
      const event = { tool: "Edit", arguments: params, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const entry = transformToolCall(event);
      return entry.action.type === "file_edit";
    }
  ));
});

test("property: same tool always maps to same type (deterministic)", () => {
  const knownTools = ["Read", "Write", "Edit", "exec", "process", "browser", "web_search", "web_fetch", "message"];
  fc.assert(fc.property(
    fc.constantFrom(...knownTools),
    fc.dictionary(fc.string().filter(s => s.length > 0 && s.length < 50), fc.string().filter(s => s.length < 100)),
    (toolName, params) => {
      const event1 = { tool: toolName, arguments: params, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const event2 = { tool: toolName, arguments: params, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const entry1 = transformToolCall(event1);
      const entry2 = transformToolCall(event2);
      return entry1.action.type === entry2.action.type;
    }
  ));
});

test("property: unknown tools map to other", () => {
  const knownTools = new Set(["Read", "Write", "Edit", "exec", "process", "browser", "web_search", "web_fetch", "message", "nodes", "canvas", "image", "tts"]);
  fc.assert(fc.property(
    fc.string().filter(s => s.length > 0 && !knownTools.has(s)),
    (unknownTool) => {
      const event = { tool: unknownTool, arguments: {}, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const entry = transformToolCall(event);
      return entry.action.type === "other";
    }
  ));
});

test("property: all known tool mappings produce valid ActionType", () => {
  const validTypes = ["file_read", "file_write", "file_edit", "browser", "api_call", "exec", "message_send", "config_change", "other"];
  const knownTools = ["Read", "Write", "Edit", "exec", "process", "browser", "web_search", "web_fetch", "message", "nodes", "canvas", "image", "tts"];
  fc.assert(fc.property(
    fc.constantFrom(...knownTools),
    (toolName) => {
      const event = { tool: toolName, arguments: {}, result: "success", timestamp: "2026-01-31T12:00:00.000Z" };
      const entry = transformToolCall(event);
      return validTypes.includes(entry.action.type);
    }
  ));
});
