/**
 * Clawdbot Adapter
 *
 * Transforms Clawdbot tool-call events into audit-ledger entries.
 */

import { z } from "zod";
import {
  AuditEntrySchema,
  type AuditEntry,
  type ActionType,
} from "../schema.js";
import { makeId } from "../ledger.js";

/**
 * Schema for Clawdbot tool-call events.
 * This represents the input format from Clawdbot tool execution logs.
 */
export const ClawdbotToolCallSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.unknown()).optional().default({}),
  result: z.enum(["success", "failure"]),
  timestamp: z.string().datetime().optional(),
  files: z.array(z.string()).optional().default([]),
  // Optional context fields
  channel: z.string().optional(),
  session: z.string().optional(),
  request: z.string().optional(),
  // Optional extra metadata
  error: z.string().optional(),
  output: z.string().optional(),
});

export type ClawdbotToolCall = z.infer<typeof ClawdbotToolCallSchema>;

/**
 * Map Clawdbot tool names to audit-ledger action types.
 */
const TOOL_TYPE_MAP: Readonly<Record<string, ActionType>> = {
  // File operations
  Read: "file_write", // Read is technically not a write, but we log it as file access
  Write: "file_write",
  Edit: "file_edit",

  // Execution
  exec: "exec",
  process: "exec",

  // Browser
  browser: "browser",

  // Web/API
  web_search: "api_call",
  web_fetch: "api_call",
  image: "api_call",
  tts: "api_call",

  // Messaging
  message: "message_send",

  // Node operations
  nodes: "other",
  canvas: "other",
};

/**
 * Determine the action type for a Clawdbot tool.
 */
function getActionType(toolName: string): ActionType {
  return TOOL_TYPE_MAP[toolName] ?? "other";
}

/**
 * Generate a human-readable summary from tool call data.
 */
function generateSummary(event: ClawdbotToolCall): string {
  const { tool, arguments: args, result } = event;
  const status = result === "success" ? "" : " (failed)";

  switch (tool) {
    case "Read":
      return `Read file: ${args.path || args.file_path || "unknown"}${status}`;
    case "Write":
      return `Write file: ${args.path || args.file_path || "unknown"}${status}`;
    case "Edit":
      return `Edit file: ${args.path || args.file_path || "unknown"}${status}`;
    case "exec":
      return `Execute: ${truncate(String(args.command || "command"), 60)}${status}`;
    case "process":
      return `Process ${args.action || "action"}: ${args.sessionId || ""}${status}`;
    case "browser":
      return `Browser ${args.action || "action"}${args.targetUrl ? `: ${args.targetUrl}` : ""}${status}`;
    case "web_search":
      return `Web search: ${truncate(String(args.query || ""), 40)}${status}`;
    case "web_fetch":
      return `Fetch URL: ${truncate(String(args.url || ""), 50)}${status}`;
    case "message":
      return `Message ${args.action || "send"} to ${args.target || args.channel || "unknown"}${status}`;
    case "nodes":
      return `Node ${args.action || "action"}${args.node ? ` on ${args.node}` : ""}${status}`;
    case "canvas":
      return `Canvas ${args.action || "action"}${status}`;
    case "image":
      return `Analyze image${status}`;
    case "tts":
      return `Text-to-speech${status}`;
    default:
      return `${tool}${status}`;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/**
 * Extract artifacts (files/URLs/identifiers) from tool call.
 */
function extractArtifacts(event: ClawdbotToolCall): string[] {
  const artifacts: string[] = [];
  const { tool, arguments: args, files } = event;

  // Add explicitly provided files
  if (files.length > 0) {
    artifacts.push(...files);
  }

  // Extract artifacts based on tool type
  switch (tool) {
    case "Read":
    case "Write":
    case "Edit": {
      const path = args.path || args.file_path;
      if (typeof path === "string" && !artifacts.includes(path)) {
        artifacts.push(path);
      }
      break;
    }
    case "web_fetch":
    case "browser": {
      const url = args.url || args.targetUrl;
      if (typeof url === "string") {
        artifacts.push(url);
      }
      break;
    }
  }

  return artifacts;
}

/**
 * Generate "what I did" steps from tool call.
 */
function generateWhatIDid(event: ClawdbotToolCall): string[] {
  const steps: string[] = [];
  const { tool, arguments: args, result, error } = event;

  switch (tool) {
    case "Read":
      steps.push(`Read contents of ${args.path || args.file_path}`);
      if (args.offset || args.limit) {
        steps.push(
          `Applied offset=${args.offset ?? 0}, limit=${args.limit ?? "all"}`
        );
      }
      break;
    case "Write":
      steps.push(`Wrote content to ${args.path || args.file_path}`);
      break;
    case "Edit":
      steps.push(`Edited ${args.path || args.file_path}`);
      if (args.oldText || args.old_string) {
        steps.push("Replaced specific text block");
      }
      break;
    case "exec":
      steps.push(
        `Executed shell command: ${truncate(String(args.command || ""), 80)}`
      );
      if (args.workdir) steps.push(`Working directory: ${args.workdir}`);
      if (args.timeout) steps.push(`Timeout: ${args.timeout}s`);
      break;
    case "browser":
      steps.push(`Browser action: ${args.action}`);
      if (args.targetUrl) steps.push(`Target URL: ${args.targetUrl}`);
      break;
    case "web_search":
      steps.push(`Searched web for: ${args.query}`);
      if (args.count) steps.push(`Requested ${args.count} results`);
      break;
    case "web_fetch":
      steps.push(`Fetched content from: ${args.url}`);
      if (args.extractMode) steps.push(`Extract mode: ${args.extractMode}`);
      break;
    case "message":
      steps.push(`Message action: ${args.action}`);
      if (args.target) steps.push(`Target: ${args.target}`);
      break;
    default:
      steps.push(`Invoked ${tool} tool`);
  }

  if (result === "failure" && error) {
    steps.push(`Error: ${truncate(error, 100)}`);
  }

  return steps;
}

/** Options for transforming tool calls */
export interface TransformOptions {
  /** Override the generated ID */
  id?: string;
  /** Additional assumptions to include */
  assumptions?: string[];
  /** Additional uncertainties to include */
  uncertainties?: string[];
  /** Additional verification suggestions */
  suggestedVerification?: string[];
}

/**
 * Transform a Clawdbot tool-call event into an audit-ledger entry.
 */
export function transformToolCall(
  event: ClawdbotToolCall,
  options: TransformOptions = {}
): AuditEntry {
  const validated = ClawdbotToolCallSchema.parse(event);
  const ts = validated.timestamp || new Date().toISOString();

  const entry: AuditEntry = {
    id: options.id || makeId(new Date(ts)),
    ts,
    context: {
      channel: validated.channel,
      session: validated.session,
      request: validated.request,
    },
    action: {
      type: getActionType(validated.tool),
      summary: generateSummary(validated),
      artifacts: extractArtifacts(validated),
    },
    what_i_did: generateWhatIDid(validated),
    assumptions: options.assumptions || [],
    uncertainties: [
      ...(validated.result === "failure"
        ? ["Tool call failed - may need retry"]
        : []),
      ...(options.uncertainties || []),
    ],
    verification: {
      suggested: options.suggestedVerification || [],
      observed:
        validated.result === "success"
          ? ["Tool call completed successfully"]
          : [],
    },
  };

  // Clean up empty context
  if (
    !entry.context?.channel &&
    !entry.context?.session &&
    !entry.context?.request
  ) {
    delete entry.context;
  }

  return AuditEntrySchema.parse(entry);
}

/**
 * Parse and transform multiple Clawdbot tool-call events from JSONL.
 * Yields each transformed entry.
 */
export function* parseClawdbotJsonl(jsonl: string): Generator<AuditEntry> {
  const lines = jsonl.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event: unknown = JSON.parse(trimmed);
      yield transformToolCall(event as ClawdbotToolCall);
    } catch (err) {
      // Skip invalid lines, or you could throw/log
      console.error(`Skipping invalid line: ${(err as Error).message}`);
    }
  }
}

/**
 * Transform multiple events at once.
 */
export function transformBatch(events: ClawdbotToolCall[]): AuditEntry[] {
  return events.map((e) => transformToolCall(e));
}
