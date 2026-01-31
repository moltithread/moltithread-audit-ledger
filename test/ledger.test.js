import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readEntries,
  appendEntry,
  makeId,
  ensureDir,
  JsonlParseError,
} from "../dist/ledger.js";

// ==================== Helper functions ====================

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
}

function createValidEntry(id = "test-entry") {
  return {
    id,
    ts: "2026-01-31T00:00:00.000Z",
    action: { type: "other", summary: "test", artifacts: [] },
    what_i_did: [],
    assumptions: [],
    uncertainties: [],
  };
}

// ==================== makeId tests ====================

test("makeId generates unique IDs", () => {
  const id1 = makeId();
  const id2 = makeId();
  assert.notEqual(id1, id2);
});

test("makeId uses provided date", () => {
  const date = new Date("2026-06-15T12:30:45.123Z");
  const id = makeId(date);
  assert.ok(id.startsWith("20260615T123045Z-"));
});

test("makeId format is YYYYMMDDTHHMMSSZ-XXXX", () => {
  const id = makeId();
  assert.match(id, /^\d{8}T\d{6}Z-[0-9a-f]{4}$/);
});

// ==================== ensureDir tests ====================

test("ensureDir creates parent directories", () => {
  const tempDir = createTempDir();
  const nestedPath = path.join(tempDir, "a", "b", "c", "file.txt");

  ensureDir(nestedPath);

  const parentDir = path.dirname(nestedPath);
  assert.ok(fs.existsSync(parentDir));

  fs.rmSync(tempDir, { recursive: true });
});

// ==================== appendEntry tests ====================

test("appendEntry creates file and appends entry", () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");
  const entry = createValidEntry();

  appendEntry({ ledgerPath }, entry);

  const content = fs.readFileSync(ledgerPath, "utf8");
  const parsed = JSON.parse(content.trim());
  assert.equal(parsed.id, entry.id);

  fs.rmSync(tempDir, { recursive: true });
});

test("appendEntry appends multiple entries", () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");

  appendEntry({ ledgerPath }, createValidEntry("entry-1"));
  appendEntry({ ledgerPath }, createValidEntry("entry-2"));

  const content = fs.readFileSync(ledgerPath, "utf8");
  const lines = content.trim().split("\n");
  assert.equal(lines.length, 2);

  fs.rmSync(tempDir, { recursive: true });
});

// ==================== readEntries tests ====================

test("readEntries yields nothing for non-existent file", async () => {
  const entries = [];
  for await (const e of readEntries({
    ledgerPath: "/nonexistent/path.jsonl",
  })) {
    entries.push(e);
  }
  assert.equal(entries.length, 0);
});

test("readEntries reads valid entries", async () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");

  appendEntry({ ledgerPath }, createValidEntry("entry-1"));
  appendEntry({ ledgerPath }, createValidEntry("entry-2"));

  const entries = [];
  for await (const e of readEntries({ ledgerPath })) {
    entries.push(e);
  }

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "entry-1");
  assert.equal(entries[1].id, "entry-2");

  fs.rmSync(tempDir, { recursive: true });
});

test("readEntries skips empty lines", async () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");

  const content = [
    JSON.stringify(createValidEntry("entry-1")),
    "",
    "   ",
    JSON.stringify(createValidEntry("entry-2")),
  ].join("\n");

  fs.writeFileSync(ledgerPath, content);

  const entries = [];
  for await (const e of readEntries({ ledgerPath })) {
    entries.push(e);
  }

  assert.equal(entries.length, 2);

  fs.rmSync(tempDir, { recursive: true });
});

test("readEntries throws on invalid JSON by default", async () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");

  fs.writeFileSync(ledgerPath, "{invalid json}\n");

  await assert.rejects(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _entry of readEntries({ ledgerPath })) {
      // consume
    }
  }, JsonlParseError);

  fs.rmSync(tempDir, { recursive: true });
});

test("readEntries throws on schema validation failure by default", async () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");

  // Missing required fields
  fs.writeFileSync(ledgerPath, JSON.stringify({ id: "test" }) + "\n");

  await assert.rejects(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _entry of readEntries({ ledgerPath })) {
      // consume
    }
  }, JsonlParseError);

  fs.rmSync(tempDir, { recursive: true });
});

test("readEntries skips invalid lines with skipInvalid option", async () => {
  const tempDir = createTempDir();
  const ledgerPath = path.join(tempDir, "test.jsonl");

  const content = [
    JSON.stringify(createValidEntry("entry-1")),
    "{invalid}",
    JSON.stringify({ bad: "schema" }),
    JSON.stringify(createValidEntry("entry-2")),
  ].join("\n");

  fs.writeFileSync(ledgerPath, content);

  const entries = [];
  for await (const e of readEntries({ ledgerPath }, { skipInvalid: true })) {
    entries.push(e);
  }

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "entry-1");
  assert.equal(entries[1].id, "entry-2");

  fs.rmSync(tempDir, { recursive: true });
});

// ==================== JsonlParseError tests ====================

test("JsonlParseError includes line information", () => {
  const error = new JsonlParseError(
    "Invalid JSON",
    5,
    "{bad json...",
    new Error("Unexpected token"),
  );

  assert.equal(error.lineNumber, 5);
  assert.equal(error.lineContent, "{bad json...");
  assert.ok(error.cause);
  assert.equal(error.name, "JsonlParseError");
});
