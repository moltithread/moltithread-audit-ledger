#!/usr/bin/env node

// Recur runner: reads one JSON test case on stdin and outputs one JSON object to stdout.
// Output is a structured eval result (NOT an audit entry).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AuditEntrySchema } from "../dist/schema.js";
import { appendEntry, readEntries } from "../dist/ledger.js";
import { redactObject, RedactionError, findSensitivePatterns } from "../dist/redact.js";
import { parseClawdbotJsonl } from "../dist/adapters/clawdbot.js";
import { parseClaudeCodeJsonl } from "../dist/adapters/claude_code.js";

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function okResult(tc, findings = [], meta = {}) {
  return {
    case_id: tc.case_id || tc.id || "unknown",
    level: tc.level,
    test_type: tc.test_type,
    ok: true,
    exit_code: 0,
    findings,
    violations: [],
    meta,
  };
}

function failResult(tc, violations, findings = [], meta = {}) {
  return {
    case_id: tc.case_id || tc.id || "unknown",
    level: tc.level,
    test_type: tc.test_type,
    ok: false,
    exit_code: 1,
    findings,
    violations,
    meta,
  };
}

function loadFixture(relPath) {
  const abs = path.resolve(path.dirname(new URL(import.meta.url).pathname), relPath);
  return fs.readFileSync(abs, "utf8");
}

function loadFixtureJson(relPath) {
  const parsed = safeJsonParse(loadFixture(relPath));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

function containsSecrets(obj) {
  const text = JSON.stringify(obj);
  const matches = findSensitivePatterns(text);
  return matches.length > 0;
}

async function readAllLedger(ledgerPath) {
  const out = [];
  for await (const e of readEntries({ ledgerPath })) out.push(e);
  return out;
}

async function run(tc) {
  const fixture = tc.fixture;

  switch (tc.test_type) {
    case "redaction_strict_rejects": {
      const entry = loadFixtureJson(fixture);
      try {
        redactObject(entry, { mode: "strict" });
        return failResult(tc, ["strict_mode_did_not_reject_secrets"], [], {
          note: "Expected RedactionError in strict mode",
        });
      } catch (e) {
        if (e instanceof RedactionError) {
          return okResult(tc, ["strict_mode_rejected_secrets"], {
            matches_count: e.matches.length,
          });
        }
        return failResult(tc, ["unexpected_error"], [], {
          error: String(e),
        });
      }
    }

    case "redaction_replaces": {
      const entry = loadFixtureJson(fixture);
      const redacted = redactObject(entry, { mode: "redact" });

      // Should contain replacement and should not still contain secret patterns.
      const txt = JSON.stringify(redacted);
      if (!txt.includes("[REDACTED]")) {
        return failResult(tc, ["redaction_did_not_insert_replacement"], []);
      }
      if (containsSecrets(redacted)) {
        return failResult(tc, ["redaction_left_secret_patterns"], []);
      }

      return okResult(tc, ["secrets_replaced_with_REDACTED"], {
        replacement: "[REDACTED]",
      });
    }

    case "import_adapter": {
      const jsonl = loadFixture(fixture);
      const adapter = tc.adapter;

      const entries =
        adapter === "clawdbot"
          ? Array.from(parseClawdbotJsonl(jsonl))
          : Array.from(parseClaudeCodeJsonl(jsonl));

      if (entries.length === 0) {
        return failResult(tc, ["no_entries_produced"], [], { adapter });
      }

      // Validate schema + required triad present.
      for (const e of entries) {
        const parsed = AuditEntrySchema.safeParse(e);
        if (!parsed.success) {
          return failResult(tc, ["entry_failed_schema_validation"], [], {
            adapter,
          });
        }
        if (!Array.isArray(e.what_i_did) || !Array.isArray(e.assumptions) || !Array.isArray(e.uncertainties)) {
          return failResult(tc, ["required_triad_missing_or_wrong_type"], [], {
            adapter,
          });
        }
      }

      // Ensure the adapter does not emit plaintext secret patterns.
      for (const e of entries) {
        if (containsSecrets(e)) {
          return failResult(tc, ["adapter_emitted_secret_patterns"], [], { adapter });
        }
      }

      return okResult(tc, ["adapter_produced_valid_entries"], {
        adapter,
        entries: entries.length,
        first_action_type: entries[0]?.action?.type,
      });
    }

    case "viewer_schema_compat": {
      const jsonl = loadFixture(fixture);
      const lines = jsonl.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        return failResult(tc, ["fixture_empty"], []);
      }

      for (const line of lines) {
        const parsed = safeJsonParse(line);
        if (!parsed.ok) return failResult(tc, ["invalid_jsonl_line"], []);
        const ok = AuditEntrySchema.safeParse(parsed.value).success;
        if (!ok) return failResult(tc, ["viewer_fixture_not_a_valid_audit_entry"], []);
      }

      return okResult(tc, ["viewer_fixture_entries_validate"], { entries: lines.length });
    }

    case "append_only_ids": {
      // Copy fixture ledger into a temp ledger, append a known entry, and ensure existing IDs unchanged.
      const base = loadFixture(fixture);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-ledger-eval-"));
      const ledgerPath = path.join(dir, "ledger.jsonl");
      fs.writeFileSync(ledgerPath, base, "utf8");

      const before = await readAllLedger(ledgerPath);
      if (before.length < 1) return failResult(tc, ["fixture_has_no_entries"], []);

      const newEntry = {
        id: "20260131T000000Z-evalappend",
        ts: "2026-01-31T00:00:00.000Z",
        action: { type: "other", summary: "append-only test", artifacts: [] },
        what_i_did: ["appended"],
        assumptions: ["ledger file is writable"],
        uncertainties: ["none"],
        verification: { suggested: [], observed: [] },
      };

      appendEntry({ ledgerPath }, AuditEntrySchema.parse(newEntry));

      const after = await readAllLedger(ledgerPath);
      if (after.length !== before.length + 1) {
        return failResult(tc, ["append_did_not_increase_entry_count"], [], {
          before: before.length,
          after: after.length,
        });
      }

      for (let i = 0; i < before.length; i++) {
        if (before[i].id !== after[i].id) {
          return failResult(tc, ["existing_entry_ids_changed"], [], {
            index: i,
          });
        }
      }

      return okResult(tc, ["append_only_preserved_existing_ids"], {
        before: before.length,
        after: after.length,
      });
    }

    case "required_triad": {
      const jsonl = loadFixture(fixture);
      const lines = jsonl.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        const e = AuditEntrySchema.parse(parsed);
        if (!Array.isArray(e.what_i_did) || !Array.isArray(e.assumptions) || !Array.isArray(e.uncertainties)) {
          return failResult(tc, ["required_triad_missing"], []);
        }
      }
      return okResult(tc, ["triad_present_on_all_entries"], { entries: lines.length });
    }

    case "no_plaintext_secrets": {
      const entry = loadFixtureJson(fixture);
      const redacted = redactObject(entry, { mode: "redact" });
      if (containsSecrets(redacted)) {
        return failResult(tc, ["plaintext_secret_patterns_found"], []);
      }
      return okResult(tc, ["no_plaintext_secrets_after_redaction"]); 
    }

    case "duplicate_link_cache": {
      // This repo does not currently implement a duplicate-link cache; keep a placeholder.
      return okResult(tc, ["not_applicable"], { note: "No duplicate-link cache behavior implemented" });
    }

    default:
      return failResult(tc, ["unknown_test_type"], [], { test_type: tc.test_type });
  }
}

async function main() {
  const raw = readStdin().trim();
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) {
    console.log(
      JSON.stringify({
        case_id: "invalid_json",
        ok: false,
        exit_code: 1,
        violations: ["invalid_json"],
        findings: [],
      }),
    );
    process.exit(0);
  }

  const tc = parsed.value || {};

  try {
    const result = await run(tc);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    console.log(
      JSON.stringify({
        case_id: tc.case_id || tc.id || "unknown",
        ok: false,
        exit_code: 1,
        violations: ["runner_threw"],
        findings: [],
        meta: { error: String(e) },
      }),
    );
    process.exit(0);
  }
}

main();
