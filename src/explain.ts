import type { AuditEntry } from "./schema.js";

export type ExplainFormat = "text" | "markdown";

export function formatExplain(
  entry: AuditEntry,
  format: ExplainFormat = "text",
): string {
  const lines: string[] = [];

  if (format === "markdown") {
    lines.push(`# ${entry.action.summary}`);
    lines.push("");
    lines.push(`**ID:** \`${entry.id}\`  `);
    lines.push(`**Time:** ${entry.ts}  `);
    lines.push(`**Type:** ${entry.action.type}`);

    if (entry.action.artifacts.length > 0) {
      lines.push("");
      lines.push("## Artifacts");
      for (const a of entry.action.artifacts) lines.push(`- \`${a}\``);
    }

    if (entry.what_i_did.length > 0) {
      lines.push("");
      lines.push("## What I Did");
      for (const d of entry.what_i_did) lines.push(`- ${d}`);
    }

    if (entry.assumptions.length > 0) {
      lines.push("");
      lines.push("## Assumptions");
      for (const a of entry.assumptions) lines.push(`- ${a}`);
    }

    if (entry.uncertainties.length > 0) {
      lines.push("");
      lines.push("## Uncertainties");
      for (const u of entry.uncertainties) lines.push(`- ${u}`);
    }

    if (entry.verification?.suggested?.length) {
      lines.push("");
      lines.push("## Suggested Verification");
      for (const s of entry.verification.suggested) lines.push(`- ${s}`);
    }

    if (entry.verification?.observed?.length) {
      lines.push("");
      lines.push("## Observed Results");
      for (const o of entry.verification.observed) lines.push(`- ${o}`);
    }
  } else {
    // Plain text format
    lines.push(`${entry.action.summary}`);
    lines.push(
      `ID: ${entry.id}  |  Time: ${entry.ts}  |  Type: ${entry.action.type}`,
    );
    lines.push("");

    if (entry.action.artifacts.length > 0) {
      lines.push("Artifacts:");
      for (const a of entry.action.artifacts) lines.push(`  • ${a}`);
      lines.push("");
    }

    if (entry.what_i_did.length > 0) {
      lines.push("What I did:");
      for (const d of entry.what_i_did) lines.push(`  • ${d}`);
      lines.push("");
    }

    if (entry.assumptions.length > 0) {
      lines.push("Assumptions:");
      for (const a of entry.assumptions) lines.push(`  • ${a}`);
      lines.push("");
    }

    if (entry.uncertainties.length > 0) {
      lines.push("Uncertainties:");
      for (const u of entry.uncertainties) lines.push(`  • ${u}`);
      lines.push("");
    }

    if (entry.verification?.suggested?.length) {
      lines.push("Suggested verification:");
      for (const s of entry.verification.suggested) lines.push(`  • ${s}`);
      lines.push("");
    }

    if (entry.verification?.observed?.length) {
      lines.push("Observed results:");
      for (const o of entry.verification.observed) lines.push(`  • ${o}`);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}
