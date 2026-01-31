# Recur Evals (Expanded)

This folder contains recur-based evaluation tests for **moltithread-audit-ledger**.

The eval suite is designed to catch common failures in audit-ledger usage:

- **L1 (edge cases):** redaction behavior, import adapters, viewer schema compatibility
- **L2 (schema invariants):** append-only ledger behavior, required triad fields, secret hygiene
- **L3 (behavioral):** placeholder for duplicate-link cache behavior (if/when implemented)

## Files

- `recur.yaml` — recur runner + dataset + checks
- `test_cases.jsonl` — test case dataset (one JSON object per line)
- `runner.js` — executes one test case and outputs a structured JSON result
- `output_schema.json` — JSON schema for runner output (documented contract)
- `fixtures/` — deterministic fixtures used by test cases

## Running locally

Prereqs: `npm ci && npm run build` and a local `recur` binary.

```bash
recur eval --config evals/recur.yaml
# or
npm run eval
```

## Test case format

Each line in `test_cases.jsonl` looks like:

```json
{
  "case_id": "l1_redaction_replaces_secrets",
  "level": "L1",
  "test_type": "redaction_replaces",
  "fixture": "fixtures/secret_entry.json"
}
```

## Output contract

The runner prints one JSON object per test case with:

- `case_id` (string)
- `ok` (boolean)
- `exit_code` (0/1)
- `findings` (array)
- `violations` (array; required when `ok=false`)

See `output_schema.json` for the full contract.
