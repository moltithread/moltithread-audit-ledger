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

## Ledger entry schema
See: `docs/SCHEMA.md`

## Roadmap
See: `docs/ROADMAP.md`
