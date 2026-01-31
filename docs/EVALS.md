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

- **runner**: Executes `node ./runner.js` which reads test cases from stdin and outputs audit entries
- **dataset**: Test cases in `evals/dataset.jsonl`
- **checks**:
  - `required_fields` — ensures `id`, `ts`, `action`, `what_i_did`, `assumptions`, `uncertainties` exist
  - `no_secrets` — fails if any secret patterns (tokens, passwords, API keys) are detected

### `evals/dataset.jsonl`

Each line is a JSON test case with an `id` and `input` object. The runner transforms these into audit entries that recur checks validate.

### `evals/runner.js`

Deterministic runner that:
- Uses a fixed timestamp (`2026-01-31T00:00:00.000Z`) for reproducibility
- Generates stable IDs from test case IDs
- Transforms input fields into the audit entry schema

## Adding Test Cases

Add new cases to `evals/dataset.jsonl`:

```json
{"id":"my-test","input":{"request":"description","action_type":"api_call","summary":"Did something","artifacts":[],"did":["step 1"],"assume":["precondition"],"unsure":["uncertainty"]}}
```

Run `npm run eval` to verify the new case passes all checks.
