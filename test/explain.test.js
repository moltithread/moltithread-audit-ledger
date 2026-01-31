import test from "node:test";
import assert from "node:assert/strict";
import { formatExplain } from "../dist/explain.js";

const sampleEntry = {
  id: "20260131T034656Z-abcd",
  ts: "2026-01-31T03:46:56.000Z",
  action: {
    type: "file_edit",
    summary: "Updated README with install instructions",
    artifacts: ["README.md"],
  },
  what_i_did: ["Added npm install command", "Fixed typo in heading"],
  assumptions: ["User has Node.js 18+ installed"],
  uncertainties: ["Not sure if yarn should also be documented"],
  verification: {
    suggested: ["Run npm install to verify"],
    observed: [],
  },
};

test("formatExplain returns text format by default", () => {
  const out = formatExplain(sampleEntry);
  assert.ok(out.includes("Updated README with install instructions"));
  assert.ok(out.includes("What I did:"));
  assert.ok(out.includes("Added npm install command"));
  assert.ok(out.includes("Assumptions:"));
  assert.ok(out.includes("User has Node.js 18+ installed"));
  assert.ok(out.includes("Uncertainties:"));
  assert.ok(out.includes("Not sure if yarn"));
  // Should NOT have markdown headers
  assert.ok(!out.includes("## What I Did"));
});

test("formatExplain returns markdown format with format=markdown", () => {
  const out = formatExplain(sampleEntry, "markdown");
  assert.ok(out.includes("# Updated README with install instructions"));
  assert.ok(out.includes("## What I Did"));
  assert.ok(out.includes("- Added npm install command"));
  assert.ok(out.includes("## Assumptions"));
  assert.ok(out.includes("## Uncertainties"));
  assert.ok(out.includes("`README.md`"));
});

test("formatExplain handles empty arrays gracefully", () => {
  const minimal = {
    id: "20260131T000000Z-0000",
    ts: "2026-01-31T00:00:00.000Z",
    action: { type: "other", summary: "Minimal action", artifacts: [] },
    what_i_did: [],
    assumptions: [],
    uncertainties: [],
  };
  const out = formatExplain(minimal);
  assert.ok(out.includes("Minimal action"));
  // Should not include section headers for empty arrays
  assert.ok(!out.includes("What I did:"));
  assert.ok(!out.includes("Assumptions:"));
});

test("formatExplain includes artifacts when present", () => {
  const out = formatExplain(sampleEntry, "text");
  assert.ok(out.includes("Artifacts:"));
  assert.ok(out.includes("README.md"));
});

test("formatExplain markdown includes code-formatted artifacts", () => {
  const out = formatExplain(sampleEntry, "markdown");
  assert.ok(out.includes("## Artifacts"));
  assert.ok(out.includes("- `README.md`"));
});
