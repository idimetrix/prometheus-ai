import { z } from "zod";

const ruleTypeValues = [
  "code_style",
  "architecture",
  "testing",
  "review",
  "prompt",
  "security",
] as const;

const ruleSourceValues = ["manual", "auto_detected", "file"] as const;

// ---------- Create ----------
export const createRuleSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(ruleTypeValues),
  rule: z.string().min(1).max(5000),
  source: z.enum(ruleSourceValues).default("manual"),
  enabled: z.boolean().default(true),
});

// ---------- Update ----------
export const updateRuleSchema = z.object({
  ruleId: z.string().min(1),
  type: z.enum(ruleTypeValues).optional(),
  rule: z.string().min(1).max(5000).optional(),
  enabled: z.boolean().optional(),
});

// ---------- Delete ----------
export const deleteRuleSchema = z.object({
  ruleId: z.string().min(1),
});

// ---------- List ----------
export const listRulesSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(ruleTypeValues).optional(),
});

// ---------- Import from file ----------
export const importRulesFromFileSchema = z.object({
  projectId: z.string().min(1),
  content: z.string().min(1),
});

// ---------- Rules file schema ----------
const ruleFileEntrySchema = z.object({
  type: z.enum(ruleTypeValues),
  rule: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const rulesFileSchema = z.object({
  rules: z.array(ruleFileEntrySchema),
});

// ---------- Types ----------
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type DeleteRuleInput = z.infer<typeof deleteRuleSchema>;
export type ListRulesInput = z.infer<typeof listRulesSchema>;
export type ImportRulesFromFileInput = z.infer<
  typeof importRulesFromFileSchema
>;
export type RulesFileInput = z.infer<typeof rulesFileSchema>;
