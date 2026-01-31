# Claude Code Adapter

Automatically log Claude Code tool executions to your audit ledger using hooks.

## Overview

The Claude Code adapter transforms PostToolUse hook events into standard `AuditEntry` objects. This enables zero-friction auto-capture of all tool calls made during your Claude Code sessions.

## Setup

### 1. Configure the Hook

Add a `post_tool_use` hook to your Claude Code hooks configuration.

**Location:** `~/.claude/hooks.json` (or project-level `.claude/hooks.json`)

```json
{
  "hooks": {
    "post_tool_use": [
      {
        "command": "audit-ledger import claude-code --stdin",
        "timeout": 5000
      }
    ]
  }
}
```

### 2. Set Your Ledger Path (Optional)

By default, entries are written to `./memory/action-ledger.jsonl`. To use a different location:

```bash
# In your shell profile (~/.bashrc, ~/.zshrc, etc.)
export AUDIT_LEDGER_PATH="$HOME/.audit-ledger/actions.jsonl"
```

Or specify per-project in your hook:

```json
{
  "hooks": {
    "post_tool_use": [
      {
        "command": "audit-ledger import claude-code --stdin --ledger ./audit/ledger.jsonl",
        "timeout": 5000
      }
    ]
  }
}
```

## Tool Mapping

Claude Code tools are mapped to audit-ledger action types as follows:

| Claude Code Tool | Action Type   | Description |
|-----------------|---------------|-------------|
| Read            | file_write    | File access/read operations |
| Write           | file_write    | File creation |
| Edit            | file_edit     | File modification |
| NotebookEdit    | file_edit     | Jupyter notebook edits |
| Glob            | file_write    | File pattern search |
| Bash            | exec          | Shell command execution |
| Task            | exec          | Subagent task invocations |
| WebFetch        | api_call      | URL content fetching |
| WebSearch       | api_call      | Web searches |
| Grep            | other         | Content search |
| AskUserQuestion | message_send  | User interactions |

## Event Schema

The adapter expects events in Claude Code's PostToolUse format:

```typescript
{
  tool_name: string;         // Required: Tool name (e.g., "Bash", "Read")
  tool_input?: object;       // Tool parameters
  tool_output?: string;      // Tool execution output
  session_id?: string;       // Session identifier
  timestamp?: string;        // ISO 8601 timestamp
  success?: boolean;         // Default: true
}
```

## Manual Import

You can also manually import tool events:

```bash
# Single event from stdin
echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"success":true}' | \
  audit-ledger import claude-code --stdin

# Multiple events from a file
audit-ledger import claude-code events.jsonl

# Dry run to preview without writing
echo '{"tool_name":"Read","tool_input":{"file_path":"README.md"},"success":true}' | \
  audit-ledger import claude-code --stdin --dry-run
```

## Example Entries

### Bash Command

Input:
```json
{"tool_name":"Bash","tool_input":{"command":"npm test"},"success":true}
```

Generated entry:
```json
{
  "id": "20260131T123456Z-a1b2",
  "ts": "2026-01-31T12:34:56.000Z",
  "action": {
    "type": "exec",
    "summary": "Execute: npm test",
    "artifacts": []
  },
  "what_i_did": [
    "Executed shell command: npm test"
  ],
  "assumptions": [],
  "uncertainties": [],
  "verification": {
    "suggested": [],
    "observed": ["Tool call completed successfully"]
  }
}
```

### File Edit

Input:
```json
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/src/app.ts",
    "old_string": "const x = 1",
    "new_string": "const x = 2"
  },
  "success": true
}
```

Generated entry:
```json
{
  "id": "20260131T123500Z-c3d4",
  "ts": "2026-01-31T12:35:00.000Z",
  "action": {
    "type": "file_edit",
    "summary": "Edit file: /src/app.ts",
    "artifacts": ["/src/app.ts"]
  },
  "what_i_did": [
    "Edited /src/app.ts",
    "Replaced specific text block"
  ],
  "assumptions": [],
  "uncertainties": [],
  "verification": {
    "suggested": [],
    "observed": ["Tool call completed successfully"]
  }
}
```

## GitHub Actions Integration

Use Claude Code hooks in CI workflows:

```yaml
name: AI-Assisted Development
on: push

jobs:
  develop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install audit-ledger
        run: npm install -g audit-ledger

      - name: Configure hooks
        run: |
          mkdir -p ~/.claude
          echo '{"hooks":{"post_tool_use":[{"command":"audit-ledger import claude-code --stdin"}]}}' > ~/.claude/hooks.json

      - name: Run Claude Code task
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: claude --print "Implement feature X"

      - name: Upload audit ledger
        uses: actions/upload-artifact@v4
        with:
          name: audit-ledger
          path: memory/action-ledger.jsonl
```

## Troubleshooting

### Hook not firing

1. Verify hooks.json is valid JSON
2. Check hook location (`~/.claude/hooks.json` or project-level)
3. Ensure `audit-ledger` is in PATH

### Permission errors

Make sure the ledger directory exists and is writable:

```bash
mkdir -p ./memory
```

### Testing the setup

Run a quick test:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo test"},"success":true}' | \
  audit-ledger import claude-code --stdin

audit-ledger last 1
```

## See Also

- [Clawdbot Adapter](./clawdbot.md) - For Clawdbot/Moltbot integration
- [Quick Start Guide](../QUICK-START.md) - Complete setup guide
