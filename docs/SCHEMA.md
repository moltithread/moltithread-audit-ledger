# Schema

Entries are JSON objects written as JSONL (one object per line).

## Fields
- `id` (string): unique id
- `ts` (string, ISO datetime)
- `context` (optional)
  - `channel`, `session`, `request`
- `action`
  - `type`: enum (`file_write`, `file_edit`, `browser`, `api_call`, `exec`, `message_send`, `config_change`, `other`)
  - `summary`: one-line human description
  - `artifacts`: array of paths/URLs/ids (never secrets)
- `what_i_did`: bullets describing observable steps
- `assumptions`: bullets describing preconditions
- `uncertainties`: bullets describing unknowns/risks
- `verification` (optional)
  - `suggested`: verification steps
  - `observed`: what’s already confirmed

## Example
See `docs/examples/example-entry.json`.
