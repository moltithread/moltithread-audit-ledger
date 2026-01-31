# Clawdbot Adapter

Transforms Clawdbot tool-call events into audit-ledger entries.

## CLI Usage

```bash
# Import from JSONL file
audit-ledger import clawdbot <file.jsonl> [--ledger <path>] [--dry-run] [--strict] [--no-redact]

# Examples
audit-ledger import clawdbot ./tool-calls.jsonl
audit-ledger import clawdbot ./tool-calls.jsonl --ledger ./memory/action-ledger.jsonl
audit-ledger import clawdbot ./tool-calls.jsonl --dry-run
```

### Options

| Flag              | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `--ledger <path>` | Path to output ledger file (default: `./memory/action-ledger.jsonl`) |
| `--dry-run`       | Preview import without writing to ledger                             |
| `--strict`        | Reject entries containing detected secrets                           |
| `--no-redact`     | Disable automatic redaction (not recommended)                        |

## Input Format

JSONL (JSON Lines) with one Clawdbot tool-call event per line.

### Schema

```typescript
interface ClawdbotToolCall {
  // Required
  tool: string; // Tool name (e.g., "Read", "Write", "exec")
  result: "success" | "failure";

  // Optional
  arguments?: Record<string, unknown>; // Tool arguments
  timestamp?: string; // ISO 8601 datetime
  files?: string[]; // Files touched by the operation
  channel?: string; // Channel context (e.g., "discord")
  session?: string; // Session ID (e.g., "agent:main:main")
  request?: string; // User request that triggered the call
  error?: string; // Error message if result is "failure"
  output?: string; // Tool output
}
```

### Example Input

```jsonl
{"tool": "Read", "arguments": {"path": "/etc/hosts"}, "result": "success", "timestamp": "2026-01-31T12:00:00.000Z"}
{"tool": "Write", "arguments": {"path": "/tmp/output.txt", "content": "hello"}, "result": "success", "timestamp": "2026-01-31T12:01:00.000Z", "files": ["/tmp/output.txt"]}
{"tool": "exec", "arguments": {"command": "npm install"}, "result": "failure", "timestamp": "2026-01-31T12:02:00.000Z", "error": "ENOENT: package.json not found"}
{"tool": "browser", "arguments": {"action": "navigate", "targetUrl": "https://example.com"}, "result": "success", "timestamp": "2026-01-31T12:03:00.000Z", "channel": "discord", "session": "agent:main:main"}
```

## Tool Type Mapping

Clawdbot tool names are mapped to audit-ledger action types:

| Clawdbot Tool | Audit Type     |
| ------------- | -------------- |
| `Read`        | `file_write`   |
| `Write`       | `file_write`   |
| `Edit`        | `file_edit`    |
| `exec`        | `exec`         |
| `process`     | `exec`         |
| `browser`     | `browser`      |
| `web_search`  | `api_call`     |
| `web_fetch`   | `api_call`     |
| `image`       | `api_call`     |
| `tts`         | `api_call`     |
| `message`     | `message_send` |
| `nodes`       | `other`        |
| `canvas`      | `other`        |
| (unknown)     | `other`        |

## Programmatic Usage

```typescript
import {
  transformToolCall,
  parseClawdbotJsonl,
  transformBatch,
  ClawdbotToolCallSchema,
  type ClawdbotToolCall,
} from "moltithread-audit-ledger/dist/adapters/clawdbot.js";

// Validate input
const event = ClawdbotToolCallSchema.parse({
  tool: "Write",
  arguments: { path: "/tmp/test.txt" },
  result: "success",
});

// Transform a single event
const entry = transformToolCall(event);
console.log(entry.action.summary); // "Write file: /tmp/test.txt"

// With options
const entryWithOptions = transformToolCall(event, {
  id: "custom-id",
  assumptions: ["User has write access"],
  uncertainties: ["File might be overwritten"],
  suggestedVerification: ["Check file contents"],
});

// Parse JSONL string
const jsonl = fs.readFileSync("tool-calls.jsonl", "utf8");
for (const entry of parseClawdbotJsonl(jsonl)) {
  console.log(entry);
}

// Transform multiple events at once
const events: ClawdbotToolCall[] = [
  { tool: "Read", arguments: { path: "a.txt" }, result: "success" },
  { tool: "Write", arguments: { path: "b.txt" }, result: "success" },
];
const entries = transformBatch(events);
```

## Output Format

Each transformed entry follows the audit-ledger schema:

```json
{
  "id": "20260131T120000Z-a1b2",
  "ts": "2026-01-31T12:00:00.000Z",
  "context": {
    "channel": "discord",
    "session": "agent:main:main"
  },
  "action": {
    "type": "file_write",
    "summary": "Write file: /tmp/output.txt",
    "artifacts": ["/tmp/output.txt"]
  },
  "what_i_did": ["Wrote content to /tmp/output.txt"],
  "assumptions": [],
  "uncertainties": [],
  "verification": {
    "suggested": [],
    "observed": ["Tool call completed successfully"]
  }
}
```

## Summary Generation

The adapter generates human-readable summaries based on the tool type:

| Tool         | Summary Format                               |
| ------------ | -------------------------------------------- |
| `Read`       | `Read file: <path>`                          |
| `Write`      | `Write file: <path>`                         |
| `Edit`       | `Edit file: <path>`                          |
| `exec`       | `Execute: <command>` (truncated to 60 chars) |
| `browser`    | `Browser <action>: <url>`                    |
| `web_search` | `Web search: <query>`                        |
| `web_fetch`  | `Fetch URL: <url>`                           |
| `message`    | `Message <action> to <target>`               |
| (other)      | `<tool>`                                     |

Failed calls append ` (failed)` to the summary.

## Error Handling

- Invalid JSONL lines are skipped with a warning
- Entries with detected secrets are redacted (or rejected in `--strict` mode)
- Missing timestamps default to current time
- Unknown tools are mapped to `other` type

## Integration Tips

### Generating Clawdbot Logs

To create a JSONL file from Clawdbot tool calls, you can:

1. **Hook into Clawdbot's event system** (if available)
2. **Parse conversation transcripts** and extract tool invocations
3. **Create a logging middleware** that captures tool calls before execution

Example logging middleware:

```typescript
function logToolCall(
  tool: string,
  args: object,
  result: "success" | "failure",
  error?: string,
) {
  const event = {
    tool,
    arguments: args,
    result,
    timestamp: new Date().toISOString(),
    error,
  };
  fs.appendFileSync("tool-calls.jsonl", JSON.stringify(event) + "\n");
}
```

### Batch Processing

For large log files, consider processing in chunks:

```typescript
import readline from "node:readline";
import fs from "node:fs";
import { transformToolCall } from "./adapters/clawdbot.js";
import { appendEntry } from "./ledger.js";

const rl = readline.createInterface({
  input: fs.createReadStream("large-file.jsonl"),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  const event = JSON.parse(line);
  const entry = transformToolCall(event);
  appendEntry({ ledgerPath: "./memory/action-ledger.jsonl" }, entry);
}
```
