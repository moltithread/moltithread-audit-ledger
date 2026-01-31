#!/usr/bin/env node

// Recur runner: reads one JSON test case on stdin and outputs one JSON object to stdout.
// Output is an AuditEntry-like object used by recur checks.

import { readFileSync } from 'node:fs';

function readStdin() {
  return readFileSync(0, 'utf8');
}

function isoNowForTest() {
  // deterministic timestamp to keep evals stable
  return '2026-01-31T00:00:00.000Z';
}

function makeId(prefix) {
  return `eval-${prefix}`;
}

const raw = readStdin().trim();
let tc;
try {
  tc = JSON.parse(raw);
} catch {
  console.log(JSON.stringify({
    id: makeId('invalid-json'),
    ts: isoNowForTest(),
    action: { type: 'other', summary: 'invalid input json', artifacts: [] },
    what_i_did: [],
    assumptions: [],
    uncertainties: [],
    error: 'invalid_json'
  }));
  process.exit(0);
}

const input = tc.input || {};

const out = {
  id: makeId(tc.id || 'case'),
  ts: isoNowForTest(),
  context: {
    request: input.request || tc.id || 'unknown'
  },
  action: {
    type: input.action_type || 'other',
    summary: input.summary || 'no summary',
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : []
  },
  what_i_did: Array.isArray(input.did) ? input.did : [],
  assumptions: Array.isArray(input.assume) ? input.assume : [],
  uncertainties: Array.isArray(input.unsure) ? input.unsure : [],
  verification: {
    suggested: [],
    observed: []
  }
};

console.log(JSON.stringify(out));
