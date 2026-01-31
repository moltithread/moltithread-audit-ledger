import { z } from "zod";

/**
 * Valid action types for audit entries.
 * Exported as const tuple for type inference and runtime validation.
 */
export const ACTION_TYPES = [
  "file_read",
  "file_write",
  "file_edit",
  "browser",
  "api_call",
  "exec",
  "message_send",
  "config_change",
  "other",
] as const;

/** Union type of all valid action types */
export type ActionType = (typeof ACTION_TYPES)[number];

/** Schema for entry context (optional session metadata) */
export const ContextSchema = z.object({
  channel: z.string().optional(),
  session: z.string().optional(),
  request: z.string().optional(),
});

/** Schema for action details */
export const ActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  summary: z.string().min(1),
  artifacts: z.array(z.string()).default([]),
});

/** Schema for verification info */
export const VerificationSchema = z.object({
  suggested: z.array(z.string()).default([]),
  observed: z.array(z.string()).default([]),
});

/** Full audit entry schema */
export const AuditEntrySchema = z.object({
  id: z.string().min(1),
  ts: z.string().datetime(),
  context: ContextSchema.optional(),
  action: ActionSchema,
  what_i_did: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  verification: VerificationSchema.optional(),
});

/** Inferred type for a complete audit entry */
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Inferred type for action object */
export type Action = z.infer<typeof ActionSchema>;

/** Inferred type for verification object */
export type Verification = z.infer<typeof VerificationSchema>;

/** Inferred type for context object */
export type Context = z.infer<typeof ContextSchema>;

/**
 * Type guard to check if a string is a valid action type.
 */
export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

/**
 * Single-letter aliases for action types.
 * Provides convenient shortcuts for CLI usage.
 */
export const TYPE_ALIASES = {
  e: "exec",
  x: "exec",
  r: "file_read",
  w: "file_write",
  d: "file_edit",
  b: "browser",
  a: "api_call",
  m: "message_send",
  c: "config_change",
  o: "other",
} as const satisfies Record<string, ActionType>;

export type TypeAlias = keyof typeof TYPE_ALIASES;

/**
 * Check if a string is a valid type alias.
 */
export function isTypeAlias(value: string): value is TypeAlias {
  return value in TYPE_ALIASES;
}

/**
 * Resolve a type alias or full type name to an ActionType.
 * Returns undefined if the value is neither a valid alias nor a valid type.
 */
export function resolveTypeAlias(value: string): ActionType | undefined {
  if (isTypeAlias(value)) {
    return TYPE_ALIASES[value];
  }
  if (isActionType(value)) {
    return value;
  }
  return undefined;
}
