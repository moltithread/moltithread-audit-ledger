import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI = path.join(process.cwd(), "dist/cli.js");

// Helper to run CLI and capture output
function runCli(args, options = {}) {
  const { stdin, env } = options;
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI, ...args], {
      env: { ...process.env, ...env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// Create a temp ledger for each test
function tempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-ledger-test-"));
  return path.join(dir, "ledger.jsonl");
}

// -----------------------------------------------------------------------------
// Help and version
// -----------------------------------------------------------------------------

test("help command shows usage", async () => {
  const { code, stdout } = await runCli(["help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("audit-ledger"));
  assert.ok(stdout.includes("COMMANDS"));
  assert.ok(stdout.includes("add"));
  assert.ok(stdout.includes("EXAMPLES"));
});

test("--help flag shows usage", async () => {
  const { code, stdout } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("audit-ledger"));
});

test("-h flag shows usage", async () => {
  const { code, stdout } = await runCli(["-h"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("audit-ledger"));
});

test("--version shows version", async () => {
  const { code, stdout } = await runCli(["--version"]);
  assert.equal(code, 0);
  assert.match(stdout, /^\d+\.\d+\.\d+$/);
});

test("-v shows version", async () => {
  const { code, stdout } = await runCli(["-v"]);
  assert.equal(code, 0);
  assert.match(stdout, /^\d+\.\d+\.\d+$/);
});

// -----------------------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------------------

test("unknown command exits with code 1", async () => {
  const { code, stderr } = await runCli(["foobar"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("error:"));
  assert.ok(stderr.includes("Unknown command"));
  assert.ok(stderr.includes("hint:"));
});

test("add without --type gives actionable error", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli([
    "add",
    "--summary",
    "test",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("error:"));
  assert.ok(stderr.includes("--type"));
  assert.ok(stderr.includes("hint:"));
});

test("add without --summary gives actionable error", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli([
    "add",
    "--type",
    "exec",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("error:"));
  assert.ok(stderr.includes("--summary"));
});

test("add with invalid type gives actionable error", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli([
    "add",
    "--type",
    "invalid_type",
    "--summary",
    "test",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Invalid type"));
  assert.ok(stderr.includes("hint:"));
  assert.ok(stderr.includes("file_write"));
});

test("show without id gives error", async () => {
  const { code, stderr } = await runCli(["show"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Missing entry ID"));
});

test("show with nonexistent id gives error with hint", async () => {
  const ledger = tempLedger();
  // First add an entry
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "test",
    "--ledger",
    ledger,
  ]);

  const { code, stderr } = await runCli([
    "show",
    "nonexistent-id",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Entry not found"));
  assert.ok(stderr.includes("hint:"));
});

test("search without term gives error", async () => {
  const { code, stderr } = await runCli(["search"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Missing search term"));
});

test("explain without id gives error", async () => {
  const { code, stderr } = await runCli(["explain"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Missing entry reference"));
});

test("last with invalid count gives error", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli(["last", "abc", "--ledger", ledger]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Invalid count"));
});

// -----------------------------------------------------------------------------
// Basic add and retrieval
// -----------------------------------------------------------------------------

test("add creates entry and returns id", async () => {
  const ledger = tempLedger();
  const { code, stdout } = await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Ran tests",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.length > 10); // ID should be reasonable length

  // Verify file was created
  assert.ok(fs.existsSync(ledger));
});

test("add with all options works", async () => {
  const ledger = tempLedger();
  const { code, stdout } = await runCli([
    "add",
    "--type",
    "file_edit",
    "--summary",
    "Updated config",
    "--artifact",
    "config.json",
    "--did",
    "Changed port",
    "--did",
    "Added timeout",
    "--assume",
    "File exists",
    "--unsure",
    "Correct format",
    "--suggest",
    "Check logs",
    "--observed",
    "No errors",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  // Verify entry contents
  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "file_edit");
  assert.equal(entry.action.summary, "Updated config");
  assert.deepEqual(entry.action.artifacts, ["config.json"]);
  assert.deepEqual(entry.what_i_did, ["Changed port", "Added timeout"]);
  assert.deepEqual(entry.assumptions, ["File exists"]);
  assert.deepEqual(entry.uncertainties, ["Correct format"]);
});

test("last shows recent entries", async () => {
  const ledger = tempLedger();

  // Add a few entries
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "First",
    "--ledger",
    ledger,
  ]);
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Second",
    "--ledger",
    ledger,
  ]);
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Third",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli(["last", "2", "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Second"));
  assert.ok(stdout.includes("Third"));
  assert.ok(!stdout.includes("First"));
});

test("show displays entry as JSON", async () => {
  const ledger = tempLedger();

  const { stdout: id } = await runCli([
    "add",
    "--type",
    "api_call",
    "--summary",
    "Called API",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli(["show", id, "--ledger", ledger]);
  assert.equal(code, 0);

  const entry = JSON.parse(stdout);
  assert.equal(entry.id, id);
  assert.equal(entry.action.type, "api_call");
});

test("search finds matching entries", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Deploy to prod",
    "--ledger",
    ledger,
  ]);
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Run tests",
    "--ledger",
    ledger,
  ]);
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Deploy to staging",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli([
    "search",
    "deploy",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Deploy to prod"));
  assert.ok(stdout.includes("Deploy to staging"));
  assert.ok(!stdout.includes("Run tests"));
});

test("explain shows human-readable output", async () => {
  const ledger = tempLedger();

  const { stdout: id } = await runCli([
    "add",
    "--type",
    "file_edit",
    "--summary",
    "Updated README",
    "--did",
    "Added examples",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli(["explain", id, "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Updated README"));
  assert.ok(stdout.includes("What I did:"));
  assert.ok(stdout.includes("Added examples"));
});

test("explain last works", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "First",
    "--ledger",
    ledger,
  ]);
  await runCli([
    "add",
    "--type",
    "exec",
    "--summary",
    "Last entry",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli([
    "explain",
    "last",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Last entry"));
});

test("explain --md outputs markdown", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "--type",
    "file_edit",
    "--summary",
    "Updated file",
    "--did",
    "Changed stuff",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli([
    "explain",
    "last",
    "--md",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("# Updated file"));
  assert.ok(stdout.includes("## What I Did"));
});

// -----------------------------------------------------------------------------
// Environment variable support
// -----------------------------------------------------------------------------

test("AUDIT_LEDGER_PATH env var sets default ledger", async () => {
  const ledger = tempLedger();

  // Add without --ledger flag, using env var
  const { code: addCode, stdout: id } = await runCli(
    ["add", "--type", "exec", "--summary", "Env test"],
    { env: { AUDIT_LEDGER_PATH: ledger } },
  );
  assert.equal(addCode, 0);

  // Verify file was created at env var path
  assert.ok(fs.existsSync(ledger));

  // Retrieve using env var
  const { code, stdout } = await runCli(["last"], {
    env: { AUDIT_LEDGER_PATH: ledger },
  });
  assert.equal(code, 0);
  assert.ok(stdout.includes("Env test"));
});

test("--ledger flag overrides AUDIT_LEDGER_PATH", async () => {
  const envLedger = tempLedger();
  const flagLedger = tempLedger();

  // Write to flag path despite env var being set
  await runCli(
    ["add", "--type", "exec", "--summary", "Flag test", "--ledger", flagLedger],
    { env: { AUDIT_LEDGER_PATH: envLedger } },
  );

  // File should exist at flag path, not env path
  assert.ok(fs.existsSync(flagLedger));
  assert.ok(!fs.existsSync(envLedger));
});

// -----------------------------------------------------------------------------
// JSON input mode
// -----------------------------------------------------------------------------

test("--json reads full entry from stdin", async () => {
  const ledger = tempLedger();
  const input = JSON.stringify({
    type: "exec",
    summary: "JSON test entry",
    what_i_did: ["Step 1", "Step 2"],
  });

  const { code, stdout } = await runCli(["add", "--json", "--ledger", ledger], {
    stdin: input,
  });
  assert.equal(code, 0);

  // Verify entry
  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.summary, "JSON test entry");
  assert.deepEqual(entry.what_i_did, ["Step 1", "Step 2"]);
});

test("--json adds id and ts if missing", async () => {
  const ledger = tempLedger();
  const input = JSON.stringify({
    type: "api_call",
    summary: "Minimal JSON",
  });

  await runCli(["add", "--json", "--ledger", ledger], { stdin: input });

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.ok(entry.id);
  assert.ok(entry.ts);
});

test("--json with invalid JSON gives error", async () => {
  const ledger = tempLedger();

  const { code, stderr } = await runCli(["add", "--json", "--ledger", ledger], {
    stdin: "not valid json",
  });
  assert.equal(code, 1);
  assert.ok(stderr.includes("Invalid JSON"));
});

// -----------------------------------------------------------------------------
// Stdin bullet mode
// -----------------------------------------------------------------------------

test("--stdin did reads bullet points from stdin", async () => {
  const ledger = tempLedger();
  const bullets =
    "- First thing done\n- Second thing done\n• Third with bullet";

  const { code } = await runCli(
    [
      "add",
      "--type",
      "exec",
      "--summary",
      "Stdin test",
      "--stdin",
      "did",
      "--ledger",
      ledger,
    ],
    { stdin: bullets },
  );
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.deepEqual(entry.what_i_did, [
    "First thing done",
    "Second thing done",
    "Third with bullet",
  ]);
});

test("--stdin assume reads assumptions from stdin", async () => {
  const ledger = tempLedger();
  const bullets = "User has permissions\nAPI is available";

  const { code } = await runCli(
    [
      "add",
      "--type",
      "api_call",
      "--summary",
      "Assumption test",
      "--stdin",
      "assume",
      "--ledger",
      ledger,
    ],
    { stdin: bullets },
  );
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.deepEqual(entry.assumptions, [
    "User has permissions",
    "API is available",
  ]);
});

test("--stdin combines with flag values", async () => {
  const ledger = tempLedger();

  const { code } = await runCli(
    [
      "add",
      "--type",
      "exec",
      "--summary",
      "Combined test",
      "--did",
      "From flag",
      "--stdin",
      "did",
      "--ledger",
      ledger,
    ],
    { stdin: "From stdin" },
  );
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.deepEqual(entry.what_i_did, ["From flag", "From stdin"]);
});

test("--stdin with invalid field gives error", async () => {
  const ledger = tempLedger();

  const { code, stderr } = await runCli(
    [
      "add",
      "--type",
      "exec",
      "--summary",
      "Invalid field",
      "--stdin",
      "invalid",
      "--ledger",
      ledger,
    ],
    { stdin: "content" },
  );
  assert.equal(code, 1);
  assert.ok(stderr.includes("Invalid --stdin field"));
  assert.ok(stderr.includes("hint:"));
});

// -----------------------------------------------------------------------------
// Redaction
// -----------------------------------------------------------------------------

test("--strict rejects entries with secrets", async () => {
  const ledger = tempLedger();

  const { code, stderr } = await runCli([
    "add",
    "--type",
    "api_call",
    "--summary",
    "Secret test",
    "--did",
    "Used token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "--strict",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("secrets"));
});

test("default mode redacts secrets", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "--type",
    "api_call",
    "--summary",
    "Redact test",
    "--did",
    "Used token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "--ledger",
    ledger,
  ]);

  const content = fs.readFileSync(ledger, "utf8");
  assert.ok(!content.includes("ghp_"));
  assert.ok(content.includes("[REDACTED]"));
});

// -----------------------------------------------------------------------------
// Empty ledger handling
// -----------------------------------------------------------------------------

test("last on empty ledger warns gracefully", async () => {
  const ledger = tempLedger();

  const { code, stderr } = await runCli(["last", "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stderr.includes("warn:") || stderr.includes("empty"));
});

test("search on empty ledger warns gracefully", async () => {
  const ledger = tempLedger();

  const { code, stderr } = await runCli(["search", "test", "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stderr.includes("warn:") || stderr.includes("empty"));
});

test("explain on empty ledger gives error", async () => {
  const ledger = tempLedger();

  const { code, stderr } = await runCli([
    "explain",
    "last",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("empty"));
});

// -----------------------------------------------------------------------------
// Type aliases
// -----------------------------------------------------------------------------

test("add accepts type alias 'e' for exec", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "add",
    "-t",
    "e",
    "--summary",
    "Ran tests",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "exec");
});

test("add accepts type alias 'w' for file_write", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "add",
    "-t",
    "w",
    "--summary",
    "Wrote file",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "file_write");
});

test("add accepts type alias 'd' for file_edit", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "add",
    "-t",
    "d",
    "--summary",
    "Edited file",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "file_edit");
});

test("add accepts type alias 'x' for exec (alternate)", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "add",
    "-t",
    "x",
    "--summary",
    "Executed command",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "exec");
});

test("add -t flag works same as --type", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "add",
    "-t",
    "api_call",
    "--summary",
    "Called API",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "api_call");
});

test("invalid type alias gives error with alias list", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli([
    "add",
    "-t",
    "z",
    "--summary",
    "test",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Invalid type"));
  assert.ok(stderr.includes("e=exec") || stderr.includes("Aliases"));
});

// -----------------------------------------------------------------------------
// Quick capture (q command)
// -----------------------------------------------------------------------------

test("q command creates entry with summary only", async () => {
  const ledger = tempLedger();
  const { code, stdout } = await runCli([
    "q",
    "deployed to production",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.length > 10); // ID returned

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.summary, "deployed to production");
  assert.equal(entry.action.type, "other"); // default type
});

test("q command with type prefix creates entry with specified type", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "q",
    "exec",
    "ran npm test",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.summary, "ran npm test");
  assert.equal(entry.action.type, "exec");
});

test("q command with type alias creates entry with resolved type", async () => {
  const ledger = tempLedger();
  const { code } = await runCli(["q", "e", "ran tests", "--ledger", ledger]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.summary, "ran tests");
  assert.equal(entry.action.type, "exec");
});

test("q command with multi-word summary", async () => {
  const ledger = tempLedger();
  const { code } = await runCli([
    "q",
    "this",
    "is",
    "a",
    "long",
    "summary",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.summary, "this is a long summary");
});

test("q command respects AUDIT_DEFAULT_TYPE env var", async () => {
  const ledger = tempLedger();
  const { code } = await runCli(["q", "automated task", "--ledger", ledger], {
    env: { AUDIT_DEFAULT_TYPE: "exec" },
  });
  assert.equal(code, 0);

  const content = fs.readFileSync(ledger, "utf8");
  const entry = JSON.parse(content.trim());
  assert.equal(entry.action.type, "exec");
});

test("q command without summary gives error", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli(["q", "--ledger", ledger]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Missing summary") || stderr.includes("error"));
});

// -----------------------------------------------------------------------------
// Today command
// -----------------------------------------------------------------------------

test("today command shows entries from today", async () => {
  const ledger = tempLedger();

  // Add an entry (will be from today)
  await runCli([
    "add",
    "-t",
    "exec",
    "--summary",
    "Today task",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli(["today", "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Today task"));
});

test("today command with --md outputs markdown", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "-t",
    "exec",
    "--summary",
    "Markdown test",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli(["today", "--md", "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("# Activity"));
  assert.ok(stdout.includes("## exec"));
});

test("today command on empty ledger warns gracefully", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli(["today", "--ledger", ledger]);
  assert.equal(code, 0);
  assert.ok(stderr.includes("No entries") || stderr.includes("warn"));
});

// -----------------------------------------------------------------------------
// Summary command
// -----------------------------------------------------------------------------

test("summary command requires --since", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli(["summary", "--ledger", ledger]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("--since"));
});

test("summary command with invalid time spec gives error", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli([
    "summary",
    "--since",
    "invalid",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Invalid time spec"));
});

test("summary command parses hours correctly", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "-t",
    "exec",
    "--summary",
    "Recent task",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli([
    "summary",
    "--since",
    "1h",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Recent task"));
});

test("summary command parses days correctly", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "-t",
    "exec",
    "--summary",
    "Day task",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli([
    "summary",
    "--since",
    "1d",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("Day task"));
});

test("summary command with --format md outputs markdown", async () => {
  const ledger = tempLedger();

  await runCli([
    "add",
    "-t",
    "api_call",
    "--summary",
    "API call for summary",
    "--ledger",
    ledger,
  ]);

  const { code, stdout } = await runCli([
    "summary",
    "--since",
    "1h",
    "--format",
    "md",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("# Activity"));
  assert.ok(stdout.includes("## api_call"));
});

// -----------------------------------------------------------------------------
// Claude Code import
// -----------------------------------------------------------------------------

test("import claude-code from stdin works", async () => {
  const ledger = tempLedger();
  const event = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "ls -la" },
    success: true,
  });

  const { code, stdout } = await runCli(
    ["import", "claude-code", "--stdin", "--ledger", ledger],
    { stdin: event },
  );
  assert.equal(code, 0);
  assert.ok(stdout.includes("Imported: 1"));
});

test("import claude-code handles multiple events in JSONL", async () => {
  const ledger = tempLedger();
  const events = [
    '{"tool_name":"Read","tool_input":{"file_path":"a.ts"},"success":true}',
    '{"tool_name":"Write","tool_input":{"file_path":"b.ts"},"success":true}',
  ].join("\n");

  const { code, stdout } = await runCli(
    ["import", "claude-code", "--stdin", "--ledger", ledger],
    { stdin: events },
  );
  assert.equal(code, 0);
  assert.ok(stdout.includes("Imported: 2"));
});

test("import claude-code --dry-run does not write", async () => {
  const ledger = tempLedger();
  const event = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "test" },
    success: true,
  });

  const { code, stdout } = await runCli(
    ["import", "claude-code", "--stdin", "--dry-run", "--ledger", ledger],
    { stdin: event },
  );
  assert.equal(code, 0);
  assert.ok(stdout.includes("dry-run"));
  assert.ok(!fs.existsSync(ledger));
});

test("import requires valid format", async () => {
  const ledger = tempLedger();
  const { code, stderr } = await runCli([
    "import",
    "invalid-format",
    "--stdin",
    "--ledger",
    ledger,
  ]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("Unknown import format"));
});

// -----------------------------------------------------------------------------
// Help shows new features
// -----------------------------------------------------------------------------

test("help shows quick capture command", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("q"));
  assert.ok(stdout.includes("Quick capture"));
});

test("help shows today command", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("today"));
});

test("help shows summary command", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("summary"));
});

test("help shows type aliases", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("TYPE ALIASES"));
  assert.ok(stdout.includes("e=exec"));
});

test("help shows AUDIT_DEFAULT_TYPE env var", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("AUDIT_DEFAULT_TYPE"));
});

test("help shows claude-code import format", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("claude-code"));
});

test("help shows interactive mode flag", async () => {
  const { stdout } = await runCli(["help"]);
  assert.ok(stdout.includes("-i") || stdout.includes("--interactive"));
});
