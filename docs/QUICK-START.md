# Audit Ledger Quick Start

A comprehensive guide to using audit-ledger for accountability logging with AI assistants.

## Installation

```bash
# Install globally
npm install -g audit-ledger

# Or use via npx
npx audit-ledger --help

# Or add to your project
npm install audit-ledger
```

### Environment Setup

```bash
# Set default ledger location (optional)
export AUDIT_LEDGER_PATH="$HOME/.audit-ledger/actions.jsonl"

# Set default action type for quick capture (optional)
export AUDIT_DEFAULT_TYPE="exec"
```

---

## Quick Capture (`q`)

The fastest way to log an action.

### Local Usage

```bash
# Basic: summary only (uses AUDIT_DEFAULT_TYPE or "other")
audit-ledger q "deployed to production"

# With explicit type
audit-ledger q exec "ran npm test"

# With type alias (e = exec)
audit-ledger q e "ran npm test"

# Multi-word summary
audit-ledger q "fixed critical bug in auth flow"
```

### CI Usage

**GitHub Actions:**
```yaml
steps:
  - name: Deploy
    run: ./deploy.sh

  - name: Log deployment
    run: audit-ledger q exec "Deployed to production"
```

**OpenClaw Agent Tool Definition:**
```yaml
tools:
  - name: log_action
    command: audit-ledger q {type} "{summary}"
```

---

## Interactive Mode (`add -i`)

Guided entry creation with preview before save.

### Local Usage

```bash
$ audit-ledger add -i

Add new audit entry
Aliases: e=exec, w=file_write, d=file_edit, b=browser, a=api_call, m=message_send, c=config_change, o=other

Type (e=exec, w=file_write, d=file_edit, ...): e
Summary: Deployed v2.1 to production
Artifacts (comma-sep, optional): app.js, config.json
What I did (line per item, blank to finish):
  > Built optimized bundle
  > Ran smoke tests
  > Pushed to k8s cluster
  >

Preview:
Type: exec
Summary: Deployed v2.1 to production
Artifacts: app.js, config.json
What I did:
  • Built optimized bundle
  • Ran smoke tests
  • Pushed to k8s cluster

Save? (Y/n): y

Saved: 20260131T143256Z-a1b2
```

### CI Usage

Interactive mode is not applicable for CI (requires TTY).

---

## Session Summary

View entries from a time period, perfect for standups and reviews.

### Local Usage

```bash
# Today's entries
audit-ledger today

# Today in markdown (for standups)
audit-ledger today --md

# Last 2 hours
audit-ledger summary --since 2h

# Last day in markdown
audit-ledger summary --since 1d --format md

# Last week
audit-ledger summary --since 1w
```

**Time specs:** `2h` (hours), `1d` (days), `1w` (weeks)

### CI Usage

**Post-workflow summary:**
```yaml
- name: Generate session summary
  run: |
    echo "## Session Summary" >> $GITHUB_STEP_SUMMARY
    audit-ledger summary --since 1h --format md >> $GITHUB_STEP_SUMMARY
```

**Slack notification:**
```yaml
- name: Post to Slack
  run: |
    SUMMARY=$(audit-ledger summary --since 1h --format md)
    curl -X POST $SLACK_WEBHOOK -d "{\"text\": \"$SUMMARY\"}"
```

---

## Type Aliases

Single-letter shortcuts for action types.

| Alias | Type |
|-------|------|
| `e`, `x` | exec |
| `w` | file_write |
| `d` | file_edit |
| `b` | browser |
| `a` | api_call |
| `m` | message_send |
| `c` | config_change |
| `o` | other |

**Usage:**
```bash
audit-ledger add -t e --summary "ran tests"
audit-ledger q d "updated config"
```

**Default type:**
```bash
export AUDIT_DEFAULT_TYPE=exec
audit-ledger q "ran npm test"  # Uses exec
```

---

## Auto-Capture: Claude Code Hook

Zero-friction logging of all Claude Code tool calls.

### Local Setup

1. Create or edit `~/.claude/hooks.json`:

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

2. Verify it works:

```bash
# Run any Claude Code command
claude --print "List files in current directory"

# Check the ledger
audit-ledger last 5
```

### CI Usage (GitHub Actions)

```yaml
name: AI Development
on: push

jobs:
  develop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install tools
        run: npm install -g audit-ledger

      - name: Configure Claude Code hooks
        run: |
          mkdir -p ~/.claude
          cat > ~/.claude/hooks.json << 'EOF'
          {
            "hooks": {
              "post_tool_use": [
                {"command": "audit-ledger import claude-code --stdin"}
              ]
            }
          }
          EOF

      - name: Run Claude Code
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: claude --print "Implement the feature described in TASK.md"

      - name: Upload audit ledger
        uses: actions/upload-artifact@v4
        with:
          name: audit-ledger
          path: memory/action-ledger.jsonl
```

---

## Auto-Capture: OpenClaw / Clawdbot

### Local Setup

Configure Clawdbot to auto-log tool calls:

```yaml
# clawdbot.yaml
hooks:
  post_tool_call:
    - command: audit-ledger import clawdbot --stdin
```

Or import from saved logs:

```bash
audit-ledger import clawdbot events.jsonl
```

### CI Usage

```yaml
- name: Import Clawdbot events
  run: |
    cat clawdbot-events.jsonl | audit-ledger import clawdbot --stdin
```

---

## Viewing the Ledger

### CLI Commands

```bash
# Last N entries (default: 10)
audit-ledger last 20

# Show specific entry as JSON
audit-ledger show 20260131T143256Z-a1b2

# Human-readable explanation
audit-ledger explain last
audit-ledger explain 20260131T143256Z-a1b2 --md

# Search entries
audit-ledger search "deploy"
audit-ledger search "config"
```

### Web Viewer

Open `docs/viewer/index.html` in a browser:

1. Click "Load from /ledger" (if served from same origin)
2. Or click "Choose File" to select a local ledger file

### CI: Deploy Viewer

**GitHub Pages:**
```yaml
- name: Deploy viewer with ledger
  run: |
    mkdir -p public
    cp docs/viewer/index.html public/
    cp memory/action-ledger.jsonl public/ledger.jsonl

- name: Deploy to Pages
  uses: peaceiris/actions-gh-pages@v4
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./public
```

---

## Best Practices

### Ledger File Location

**For personal projects:**
```bash
export AUDIT_LEDGER_PATH="./memory/action-ledger.jsonl"
```

**For shared/team projects:**
```bash
export AUDIT_LEDGER_PATH="./audit/ledger.jsonl"
```

### Secret Redaction

Audit-ledger automatically redacts sensitive patterns:
- API keys, tokens, secrets
- AWS credentials
- Private keys
- Bearer tokens

To reject entries with secrets instead of redacting:
```bash
audit-ledger add --strict -t a --summary "API call" --did "Used token xyz"
# Error: Entry contains potential secrets
```

To bypass redaction (not recommended):
```bash
audit-ledger add --no-redact -t a --summary "Test with fake token"
```

### Should You Commit the Ledger?

**Pros:**
- Full accountability history
- Audit trail for compliance
- Team visibility

**Cons:**
- File grows over time
- May contain sensitive context (even redacted)

**Recommendation:**
- Commit for compliance-sensitive projects
- Add to `.gitignore` for personal/exploratory work
- Consider periodic archival for long-running projects

```bash
# Archive old entries
mv memory/action-ledger.jsonl archive/ledger-$(date +%Y%m).jsonl
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `q [type] "summary"` | Quick capture |
| `add -t <type> --summary "..."` | Full add with options |
| `add -i` | Interactive mode |
| `today [--md]` | Today's entries |
| `summary --since <time>` | Entries since time |
| `last [n]` | Last N entries |
| `show <id>` | Show entry JSON |
| `explain <id\|last>` | Human-readable output |
| `search <term>` | Search entries |
| `import <format> <file\|--stdin>` | Import from adapters |
| `help` | Show help |

---

## Next Steps

- Read the [Schema Reference](./SCHEMA.md) for entry structure details
- Check [Claude Code Adapter](./adapters/claude-code.md) for hook configuration
- See [Clawdbot Adapter](./adapters/clawdbot.md) for Moltbot integration
- Explore the [Roadmap](./ROADMAP.md) for upcoming features
