import type { AuditEntry } from "./schema.js";

/** Output format for explain command */
export type ExplainFormat = "text" | "markdown";

/**
 * Format an audit entry for human-readable display.
 *
 * @param entry - The audit entry to format
 * @param format - Output format ("text" or "markdown")
 * @returns Formatted string representation
 */
export function formatExplain(
  entry: AuditEntry,
  format: ExplainFormat = "text",
): string {
  const lines: string[] = [];

  if (format === "markdown") {
    lines.push(...formatMarkdown(entry));
  } else {
    lines.push(...formatPlainText(entry));
  }

  return lines.join("\n").trimEnd();
}

/**
 * Format entry as markdown.
 */
function formatMarkdown(entry: AuditEntry): string[] {
  const lines: string[] = [];

  lines.push(`# ${entry.action.summary}`);
  lines.push("");
  lines.push(`**ID:** \`${entry.id}\`  `);
  lines.push(`**Time:** ${entry.ts}  `);
  lines.push(`**Type:** ${entry.action.type}`);

  if (entry.action.artifacts.length > 0) {
    lines.push("");
    lines.push("## Artifacts");
    for (const artifact of entry.action.artifacts) {
      lines.push(`- \`${artifact}\``);
    }
  }

  if (entry.what_i_did.length > 0) {
    lines.push("");
    lines.push("## What I Did");
    for (const step of entry.what_i_did) {
      lines.push(`- ${step}`);
    }
  }

  if (entry.assumptions.length > 0) {
    lines.push("");
    lines.push("## Assumptions");
    for (const assumption of entry.assumptions) {
      lines.push(`- ${assumption}`);
    }
  }

  if (entry.uncertainties.length > 0) {
    lines.push("");
    lines.push("## Uncertainties");
    for (const uncertainty of entry.uncertainties) {
      lines.push(`- ${uncertainty}`);
    }
  }

  const suggested = entry.verification?.suggested ?? [];
  if (suggested.length > 0) {
    lines.push("");
    lines.push("## Suggested Verification");
    for (const suggestion of suggested) {
      lines.push(`- ${suggestion}`);
    }
  }

  const observed = entry.verification?.observed ?? [];
  if (observed.length > 0) {
    lines.push("");
    lines.push("## Observed Results");
    for (const observation of observed) {
      lines.push(`- ${observation}`);
    }
  }

  return lines;
}

/**
 * Format entry as plain text.
 */
function formatPlainText(entry: AuditEntry): string[] {
  const lines: string[] = [];

  lines.push(`${entry.action.summary}`);
  lines.push(
    `ID: ${entry.id}  |  Time: ${entry.ts}  |  Type: ${entry.action.type}`,
  );
  lines.push("");

  if (entry.action.artifacts.length > 0) {
    lines.push("Artifacts:");
    for (const artifact of entry.action.artifacts) {
      lines.push(`  • ${artifact}`);
    }
    lines.push("");
  }

  if (entry.what_i_did.length > 0) {
    lines.push("What I did:");
    for (const step of entry.what_i_did) {
      lines.push(`  • ${step}`);
    }
    lines.push("");
  }

  if (entry.assumptions.length > 0) {
    lines.push("Assumptions:");
    for (const assumption of entry.assumptions) {
      lines.push(`  • ${assumption}`);
    }
    lines.push("");
  }

  if (entry.uncertainties.length > 0) {
    lines.push("Uncertainties:");
    for (const uncertainty of entry.uncertainties) {
      lines.push(`  • ${uncertainty}`);
    }
    lines.push("");
  }

  const suggested = entry.verification?.suggested ?? [];
  if (suggested.length > 0) {
    lines.push("Suggested verification:");
    for (const suggestion of suggested) {
      lines.push(`  • ${suggestion}`);
    }
    lines.push("");
  }

  const observed = entry.verification?.observed ?? [];
  if (observed.length > 0) {
    lines.push("Observed results:");
    for (const observation of observed) {
      lines.push(`  • ${observation}`);
    }
    lines.push("");
  }

  return lines;
}
