# Moltithread Audit Ledger

A tiny, inspectable action ledger for AI agents.

Core principle:

> If an agent can’t clearly answer **what did you do, what did you assume, and what are you not sure about?** — it’s not a worker, it’s a liability.

## What this repo provides

- **Append-only JSONL ledger** format (no secrets; references only)
- **CLI** to write/view/search entries
- **Adapters** for agent platforms (Clawdbot, etc.)

## Quick start

```bash
npm install
npm run build

# write an entry
node dist/cli.js add --summary "Posted to Moltbook" --type api_call \
  --artifact "https://www.moltbook.com/post/..." \
  --did "POST /api/v1/posts" \
  --assume "API key present in ~/.config/moltbook/credentials.json" \
  --unsure "Whether UI shows post immediately" \
  --ledger ./memory/action-ledger.jsonl

# view
node dist/cli.js last 5 --ledger ./memory/action-ledger.jsonl
node dist/cli.js show <id> --ledger ./memory/action-ledger.jsonl
node dist/cli.js search moltbook --ledger ./memory/action-ledger.jsonl
```

## Redaction

By default, the CLI automatically redacts sensitive values before writing entries. This prevents accidental leakage of tokens, passwords, and API keys.

**Detected patterns include:**

- Sensitive key names: `token`, `password`, `api_key`, `secret`, `auth_token`, `ct0`, etc.
- Inline secrets: `password=value`, `token: xyz`, etc. in string values
- Bearer/Basic auth tokens
- JWT tokens (`eyJ...`)
- AWS access keys (`AKIA...`)
- GitHub tokens (`ghp_...`, `gho_...`)
- Stripe keys (`sk_live_...`, `pk_test_...`)
- Long hex strings (64+ chars)
- PEM private key headers

**CLI flags:**

- `--strict` — Reject the entry entirely if secrets are detected (exit 1)
- `--no-redact` — Disable automatic redaction (not recommended)

**Programmatic usage:**

```javascript
import { redactObject, redactString, containsSecrets } from "./dist/redact.js";

// Default: replace secrets with [REDACTED]
const clean = redactObject({ password: "secret123" });
// → { password: "[REDACTED]" }

// Strict mode: throw if secrets detected
redactObject(data, { mode: "strict" }); // throws RedactionError

// Check without modifying
if (containsSecrets(data)) {
  /* ... */
}
```

## Adapters

### Clawdbot

Import tool-call events from Clawdbot into the audit ledger:

```bash
# Import from JSONL file
node dist/cli.js import clawdbot tool-calls.jsonl --ledger ./memory/action-ledger.jsonl

# Preview without writing (dry-run)
node dist/cli.js import clawdbot tool-calls.jsonl --dry-run
```

**Input format** (JSONL, one event per line):

```json
{
  "tool": "Write",
  "arguments": { "path": "/tmp/test.txt" },
  "result": "success",
  "timestamp": "2026-01-31T12:00:00.000Z"
}
```

Required fields:

- `tool` (string): Tool name (e.g., "Read", "Write", "Edit", "exec", "browser", "web_search", "message")
- `result` ("success" | "failure"): Outcome of the tool call

Optional fields:

- `arguments` (object): Tool arguments
- `timestamp` (ISO datetime): When the call occurred
- `files` (array): Files touched by the operation
- `channel`, `session`, `request`: Context fields
- `error`, `output`: Additional metadata

See: [`docs/adapters/clawdbot.md`](docs/adapters/clawdbot.md) for full documentation.

## Ledger entry schema

See: `docs/SCHEMA.md`

## Roadmap

See: `docs/ROADMAP.md`
