/**
 * Claude Code Adapter
 *
 * Transforms Claude Code PostToolUse hook events into audit-ledger entries.
 * Designed to work with Claude Code's hooks system for automatic logging.
 */

import { z } from "zod";
import {
  AuditEntrySchema,
  type AuditEntry,
  type ActionType,
} from "../schema.js";
import { makeId } from "../ledger.js";

/**
 * Schema for Claude Code PostToolUse hook events.
 * This represents the JSON payload received from Claude Code hooks.
 */
export const ClaudeCodeToolCallSchema = z.object({
  tool_name: z.string().min(1),
  tool_input: z.record(z.unknown()).optional().default({}),
  tool_output: z.string().optional(),
  session_id: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  success: z.boolean().default(true),
});

export type ClaudeCodeToolCall = z.infer<typeof ClaudeCodeToolCallSchema>;

/**
 * Map Claude Code tool names to audit-ledger action types.
 */
const TOOL_TYPE_MAP: Readonly<Record<string, ActionType>> = {
  // File operations
  Read: "file_read", // File read operations
  Write: "file_write",
  Glob: "file_write",

  // File editing
  Edit: "file_edit",
  NotebookEdit: "file_edit",

  // Execution
  Bash: "exec",
  Task: "exec", // Agent task invocations

  // Web/API
  WebFetch: "api_call",
  WebSearch: "api_call",

  // Other
  Grep: "other",
  AskUserQuestion: "message_send",
};

/**
 * Determine the action type for a Claude Code tool.
 */
function getActionType(toolName: string): ActionType {
  return TOOL_TYPE_MAP[toolName] ?? "other";
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/**
 * Generate a human-readable summary from tool call data.
 */
function generateSummary(event: ClaudeCodeToolCall): string {
  const { tool_name, tool_input, success } = event;
  const status = success ? "" : " (failed)";
  const input = tool_input ?? {};

  switch (tool_name) {
    case "Read":
      return `Read file: ${input.file_path || "unknown"}${status}`;
    case "Write":
      return `Write file: ${input.file_path || "unknown"}${status}`;
    case "Edit":
      return `Edit file: ${input.file_path || "unknown"}${status}`;
    case "NotebookEdit":
      return `Edit notebook: ${input.notebook_path || "unknown"}${status}`;
    case "Bash":
      return `Execute: ${truncate(String(input.command || "command"), 60)}${status}`;
    case "Task":
      return `Task: ${input.subagent_type || "agent"} - ${truncate(String(input.description || ""), 40)}${status}`;
    case "WebFetch":
      return `Fetch URL: ${truncate(String(input.url || ""), 50)}${status}`;
    case "WebSearch":
      return `Web search: ${truncate(String(input.query || ""), 40)}${status}`;
    case "Glob":
      return `Glob: ${truncate(String(input.pattern || ""), 50)}${status}`;
    case "Grep":
      return `Grep: ${truncate(String(input.pattern || ""), 40)}${status}`;
    case "AskUserQuestion":
      return `Asked user question${status}`;
    default:
      return `${tool_name}${status}`;
  }
}

/**
 * Extract artifacts (files/URLs/identifiers) from tool call.
 */
function extractArtifacts(event: ClaudeCodeToolCall): string[] {
  const artifacts: string[] = [];
  const { tool_name, tool_input } = event;
  const input = tool_input ?? {};

  switch (tool_name) {
    case "Read":
    case "Write":
    case "Edit": {
      const path = input.file_path;
      if (typeof path === "string") {
        artifacts.push(path);
      }
      break;
    }
    case "NotebookEdit": {
      const path = input.notebook_path;
      if (typeof path === "string") {
        artifacts.push(path);
      }
      break;
    }
    case "WebFetch": {
      const url = input.url;
      if (typeof url === "string") {
        artifacts.push(url);
      }
      break;
    }
    case "Glob": {
      const pattern = input.pattern;
      if (typeof pattern === "string") {
        artifacts.push(pattern);
      }
      break;
    }
  }

  return artifacts;
}

/**
 * Generate "what I did" steps from tool call.
 */
function generateWhatIDid(event: ClaudeCodeToolCall): string[] {
  const steps: string[] = [];
  const { tool_name, tool_input, success, tool_output } = event;
  const input = tool_input ?? {};

  switch (tool_name) {
    case "Read":
      steps.push(`Read contents of ${input.file_path}`);
      if (input.offset || input.limit) {
        steps.push(
          `Applied offset=${input.offset ?? 0}, limit=${input.limit ?? "all"}`,
        );
      }
      break;
    case "Write":
      steps.push(`Wrote content to ${input.file_path}`);
      break;
    case "Edit":
      steps.push(`Edited ${input.file_path}`);
      if (input.old_string) {
        steps.push("Replaced specific text block");
      }
      break;
    case "NotebookEdit":
      steps.push(`Edited notebook ${input.notebook_path}`);
      if (input.edit_mode) {
        steps.push(`Edit mode: ${input.edit_mode}`);
      }
      break;
    case "Bash":
      steps.push(
        `Executed shell command: ${truncate(String(input.command || ""), 80)}`,
      );
      if (input.timeout) steps.push(`Timeout: ${input.timeout}ms`);
      break;
    case "Task":
      steps.push(`Launched ${input.subagent_type || "agent"} task`);
      if (input.description) {
        steps.push(`Description: ${input.description}`);
      }
      break;
    case "WebFetch":
      steps.push(`Fetched content from: ${input.url}`);
      if (input.prompt) steps.push(`Prompt: ${truncate(String(input.prompt), 60)}`);
      break;
    case "WebSearch":
      steps.push(`Searched web for: ${input.query}`);
      break;
    case "Glob":
      steps.push(`Searched for files matching: ${input.pattern}`);
      if (input.path) steps.push(`In directory: ${input.path}`);
      break;
    case "Grep":
      steps.push(`Searched for pattern: ${input.pattern}`);
      if (input.path) steps.push(`In: ${input.path}`);
      break;
    case "AskUserQuestion":
      steps.push("Asked user a question via interactive prompt");
      break;
    default:
      steps.push(`Invoked ${tool_name} tool`);
  }

  if (!success && tool_output) {
    steps.push(`Error: ${truncate(tool_output, 100)}`);
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
 * Transform a Claude Code tool-call event into an audit-ledger entry.
 */
export function transformToolCall(
  event: ClaudeCodeToolCall,
  options: TransformOptions = {},
): AuditEntry {
  const validated = ClaudeCodeToolCallSchema.parse(event);
  const ts = validated.timestamp || new Date().toISOString();

  const entry: AuditEntry = {
    id: options.id || makeId(new Date(ts)),
    ts,
    context: {
      session: validated.session_id,
    },
    action: {
      type: getActionType(validated.tool_name),
      summary: generateSummary(validated),
      artifacts: extractArtifacts(validated),
    },
    what_i_did: generateWhatIDid(validated),
    assumptions: options.assumptions || [],
    uncertainties: [
      ...(!validated.success ? ["Tool call failed - may need retry"] : []),
      ...(options.uncertainties || []),
    ],
    verification: {
      suggested: options.suggestedVerification || [],
      observed: validated.success
        ? ["Tool call completed successfully"]
        : [],
    },
  };

  // Clean up empty context
  if (!entry.context?.session) {
    delete entry.context;
  }

  return AuditEntrySchema.parse(entry);
}

/**
 * Parse and transform a single Claude Code tool-call event from JSON string.
 */
export function parseClaudeCodeEvent(json: string): AuditEntry {
  const event: unknown = JSON.parse(json);
  return transformToolCall(event as ClaudeCodeToolCall);
}

/**
 * Parse and transform multiple Claude Code tool-call events from JSONL.
 * Yields each transformed entry.
 */
export function* parseClaudeCodeJsonl(jsonl: string): Generator<AuditEntry> {
  const lines = jsonl.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event: unknown = JSON.parse(trimmed);
      yield transformToolCall(event as ClaudeCodeToolCall);
    } catch (err) {
      console.error(`Skipping invalid line: ${(err as Error).message}`);
    }
  }
}

/**
 * Transform multiple events at once.
 */
export function transformBatch(events: ClaudeCodeToolCall[]): AuditEntry[] {
  return events.map((e) => transformToolCall(e));
}
