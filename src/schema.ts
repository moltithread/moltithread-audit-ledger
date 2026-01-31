import { z } from "zod";

export const AuditEntrySchema = z.object({
  id: z.string().min(1),
  ts: z.string().datetime(),
  context: z
    .object({
      channel: z.string().optional(),
      session: z.string().optional(),
      request: z.string().optional()
    })
    .optional(),
  action: z.object({
    type: z.enum([
      "file_write",
      "file_edit",
      "browser",
      "api_call",
      "exec",
      "message_send",
      "config_change",
      "other"
    ]),
    summary: z.string().min(1),
    artifacts: z.array(z.string()).default([])
  }),
  what_i_did: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  verification: z
    .object({
      suggested: z.array(z.string()).default([]),
      observed: z.array(z.string()).default([])
    })
    .optional()
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;
