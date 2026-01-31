#!/usr/bin/env node

/**
 * Recur Runner
 *
 * Reads one JSON test case from stdin and outputs an AuditEntry-like
 * object to stdout for recur evaluation checks.
 */

import { readFileSync } from "node:fs";

// ==================== Constants ====================

const EVAL_TIMESTAMP = "2026-01-31T00:00:00.000Z"; // Deterministic for stable evals

// ==================== Helpers ====================

function readStdin() {
  return readFileSync(0, "utf8");
}

function makeEvalId(prefix) {
  return `eval-${prefix}`;
}

function createErrorEntry(error) {
  return {
    id: makeEvalId("invalid-json"),
    ts: EVAL_TIMESTAMP,
    action: {
      type: "other",
      summary: "invalid input json",
      artifacts: [],
    },
    what_i_did: [],
    assumptions: [],
    uncertainties: [],
    error,
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

// ==================== Main ====================

function main() {
  const raw = readStdin().trim();

  // Parse test case JSON
  let testCase;
  try {
    testCase = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify(createErrorEntry("invalid_json")));
    process.exit(0);
  }

  // Extract input fields with defaults
  const input = testCase.input || {};
  const caseId = testCase.id || "case";

  // Build output entry
  const output = {
    id: makeEvalId(caseId),
    ts: EVAL_TIMESTAMP,
    context: {
      request: input.request || caseId,
    },
    action: {
      type: input.action_type || "other",
      summary: input.summary || "no summary",
      artifacts: ensureArray(input.artifacts),
    },
    what_i_did: ensureArray(input.did),
    assumptions: ensureArray(input.assume),
    uncertainties: ensureArray(input.unsure),
    verification: {
      suggested: [],
      observed: [],
    },
  };

  console.log(JSON.stringify(output));
}

main();
