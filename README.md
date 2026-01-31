# Moltithread Audit Ledger

A tiny, inspectable action ledger for AI agents.

Core principle:
> If an agent can’t clearly answer **what did you do, what did you assume, and what are you not sure about?** — it’s not a worker, it’s a liability.

## What this repo provides
- **Append-only JSONL ledger** format (no secrets; references only)
- **CLI** to write/view/search entries
- **Optional adapters** (coming) for agents (Clawdbot, etc.)

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
if (containsSecrets(data)) { /* ... */ }
```

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
