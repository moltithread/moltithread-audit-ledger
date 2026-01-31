# Evals

This project uses [recur](https://github.com/ImWillieBeamin/recur) for evaluation testing. Evals validate that audit ledger entries have required fields and contain no secrets.

## CI Integration

Evals run automatically on every push and pull request via GitHub Actions. See `.github/workflows/ci.yml` for the full workflow.

The CI job will fail if:

- Any required field is missing from generated entries
- Any secret patterns are detected in the output

## Running Locally

### Prerequisites

1. Install [Go 1.22+](https://go.dev/dl/)
2. Clone and build recur:
   ```bash
   git clone https://github.com/ImWillieBeamin/recur.git ../recur
   cd ../recur && make build
   ```

### Run the eval suite

```bash
# From the project root
npm ci
npm run build
../recur/recur eval --config evals/recur.yaml
```

Or use the convenience script:

```bash
npm run eval
```

### Eval output

Eval artifacts are written to `evals/out/` which is gitignored. Do not commit generated output.

## Configuration

### `evals/recur.yaml`

Defines the runner, dataset, and checks:

- **runner**: Executes `node ./runner.js` which reads test cases from stdin and outputs a structured JSON result
- **dataset**: Test cases in `evals/test_cases.jsonl`
- **checks**:
  - `required_fields` — ensures `case_id`, `ok`, `exit_code` exist
  - `no_secrets` — fails if any secret patterns (tokens, passwords, API keys) are detected in runner output

### `evals/test_cases.jsonl`

Each line is a JSON test case with a `case_id`, `test_type`, and optional `fixture` path.

### `evals/runner.js`

Runner that:

- Reads a single test case JSON from stdin
- Executes the specified test (redaction/import/schema invariants)
- Prints a structured result object (see `evals/output_schema.json`)

## Adding Test Cases

Add new cases to `evals/test_cases.jsonl`:

```json
{
  "case_id": "my-test",
  "level": "L1",
  "test_type": "viewer_schema_compat",
  "fixture": "fixtures/viewer_compat_ledger.jsonl"
}
```

Run `npm run eval` to verify the new case passes all checks.
