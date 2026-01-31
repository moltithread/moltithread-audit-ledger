/**
 * Claude Code Adapter
 *
 * Transforms Claude Code JSONL tool-call style events into audit-ledger entries.
 *
 * NOTE: Claude Code does not have a single universal log schema. This adapter
 * supports a minimal, explicit JSONL format designed for deterministic imports
 * and evaluation fixtures.
 */

import { z } from "zod";
import { AuditEntrySchema, type AuditEntry, type ActionType } from "../schema.js";
import { makeId } from "../ledger.js";

/**
 * Minimal schema for Claude Code tool-call events.
 */
export const ClaudeCodeEventSchema = z.object({
  tool_name: z.string().min(1),
  tool_input: z.record(z.unknown()).optional().default({}),
  status: z.enum(["success", "failure"]).default("success"),
  timestamp: z.string().datetime().optional(),
  // Optional context
  request: z.string().optional(),
  session: z.string().optional(),
  channel: z.string().optional(),
  // Optional extras
  error: z.string().optional(),
  artifacts: z.array(z.string()).optional().default([]),
});

export type ClaudeCodeEvent = z.infer<typeof ClaudeCodeEventSchema>;

const TOOL_TYPE_MAP: Readonly<Record<string, ActionType>> = {
  // Align roughly with the Clawdbot mapping
  read_file: "file_write",
  write_file: "file_write",
  edit_file: "file_edit",
  exec: "exec",
  browser: "browser",
  web_search: "api_call",
  web_fetch: "api_call",
  message: "message_send",
};

function getActionType(toolName: string): ActionType {
  return TOOL_TYPE_MAP[toolName] ?? "other";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function generateSummary(e: ClaudeCodeEvent): string {
  const status = e.status === "success" ? "" : " (failed)";
  const input = e.tool_input ?? {};

  switch (e.tool_name) {
    case "read_file":
      return `Read file: ${String((input as any).path ?? "unknown")}${status}`;
    case "write_file":
      return `Write file: ${String((input as any).path ?? "unknown")}${status}`;
    case "edit_file":
      return `Edit file: ${String((input as any).path ?? "unknown")}${status}`;
    case "exec":
      return `Execute: ${truncate(String((input as any).command ?? "command"), 60)}${status}`;
    case "browser":
      return `Browser ${String((input as any).action ?? "action")}${status}`;
    case "web_search":
      return `Web search: ${truncate(String((input as any).query ?? ""), 40)}${status}`;
    case "web_fetch":
      return `Fetch URL: ${truncate(String((input as any).url ?? ""), 50)}${status}`;
    default:
      return `${e.tool_name}${status}`;
  }
}

function extractArtifacts(e: ClaudeCodeEvent): string[] {
  const out: string[] = [];
  if (Array.isArray(e.artifacts)) out.push(...e.artifacts);

  const input = e.tool_input ?? {};
  const maybePath = (input as any).path;
  const maybeUrl = (input as any).url;

  if (typeof maybePath === "string" && !out.includes(maybePath)) out.push(maybePath);
  if (typeof maybeUrl === "string" && !out.includes(maybeUrl)) out.push(maybeUrl);

  return out;
}

function generateWhatIDid(e: ClaudeCodeEvent): string[] {
  const steps: string[] = [];
  const input = e.tool_input ?? {};

  switch (e.tool_name) {
    case "read_file":
      steps.push(`Read contents of ${String((input as any).path ?? "unknown")}`);
      break;
    case "write_file":
      steps.push(`Wrote content to ${String((input as any).path ?? "unknown")}`);
      break;
    case "edit_file":
      steps.push(`Edited ${String((input as any).path ?? "unknown")}`);
      break;
    case "exec":
      steps.push(`Executed shell command: ${truncate(String((input as any).command ?? ""), 80)}`);
      break;
    default:
      steps.push(`Invoked ${e.tool_name} tool`);
  }

  if (e.status === "failure" && e.error) {
    steps.push(`Error: ${truncate(e.error, 100)}`);
  }

  return steps;
}

export function transformClaudeCodeEvent(event: ClaudeCodeEvent): AuditEntry {
  const validated = ClaudeCodeEventSchema.parse(event);
  const ts = validated.timestamp || new Date().toISOString();

  const entry: AuditEntry = {
    id: makeId(new Date(ts)),
    ts,
    context: {
      channel: validated.channel,
      session: validated.session,
      request: validated.request,
    },
    action: {
      type: getActionType(validated.tool_name),
      summary: generateSummary(validated),
      artifacts: extractArtifacts(validated),
    },
    what_i_did: generateWhatIDid(validated),
    assumptions: [],
    uncertainties:
      validated.status === "failure" ? ["Tool call failed - may need retry"] : [],
    verification: {
      suggested: [],
      observed: validated.status === "success" ? ["Tool call completed successfully"] : [],
    },
  };

  // Clean empty context
  if (!entry.context?.channel && !entry.context?.session && !entry.context?.request) {
    delete entry.context;
  }

  return AuditEntrySchema.parse(entry);
}

export function* parseClaudeCodeJsonl(jsonl: string): Generator<AuditEntry> {
  const lines = jsonl.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj: unknown = JSON.parse(trimmed);
      yield transformClaudeCodeEvent(obj as ClaudeCodeEvent);
    } catch (err) {
      console.error(`Skipping invalid line: ${(err as Error).message}`);
    }
  }
}
