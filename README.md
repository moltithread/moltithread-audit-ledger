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

See: [`docs/adapters/clawdbot.md`](docs/adapters/clawdbot.md) for full documentation.

## Web Viewer

A static HTML viewer is available at [`docs/viewer/index.html`](docs/viewer/index.html).

**Features:**

- Load JSONL files via drag-and-drop or file picker
- Filter by date range, action type, or free-text search in summary
- Expandable entries showing the 3-section explanation (What I Did, Assumptions, Uncertainties)
- Works offline — no server required

**Usage:**

1. Open `docs/viewer/index.html` directly in a browser
2. Drag a `.jsonl` ledger file onto the drop zone (or click to select)
3. Use the filters to find specific entries
4. Click an entry to expand and see full details

Or host it via GitHub Pages: `https://<user>.github.io/moltithread-audit-ledger/viewer/`

## Ledger entry schema

See: `docs/SCHEMA.md`

## Evals

This project includes a [recur](https://github.com/ImWillieBeamin/recur) eval suite that validates audit entries have required fields and contain no secrets. Evals run in CI on every push/PR.

```bash
# Run evals locally (requires recur binary on PATH)
npm run eval
```

See: `docs/EVALS.md` for setup and configuration.

## Roadmap

See: `docs/ROADMAP.md`
