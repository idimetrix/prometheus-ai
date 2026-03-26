import { z } from "zod";

// ---------- .prometheus.md parsed content ----------

const ruleTypeValues = [
  "code_style",
  "architecture",
  "testing",
  "review",
  "security",
  "prompt",
] as const;

export const prometheusRuleSchema = z.object({
  type: z.enum(ruleTypeValues),
  rule: z.string().min(1).max(5000),
});

export const prometheusRulesFileSchema = z.object({
  rules: z.array(prometheusRuleSchema),
});

// ---------- .prometheus/config.yml project config ----------

export const prometheusProjectConfigSchema = z.object({
  version: z.string().default("1.0"),
  project: z.object({
    id: z.string().optional(),
    language: z.string().default("unknown"),
    framework: z.string().nullable().default(null),
    packageManager: z.string().nullable().default(null),
    testFramework: z.string().nullable().default(null),
    repoUrl: z.string().optional(),
  }),
  settings: z
    .object({
      autoApprove: z.boolean().default(false),
      maxAgents: z.number().int().min(1).max(25).default(3),
      defaultMode: z
        .enum(["task", "ask", "plan", "watch", "fleet"])
        .default("task"),
    })
    .optional(),
});

// ---------- CLI global config (~/.prometheus/config.json) ----------

export const cliGlobalConfigSchema = z.object({
  apiUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  defaultProjectId: z.string().optional(),
});

// ---------- Types ----------
export type PrometheusRule = z.infer<typeof prometheusRuleSchema>;
export type PrometheusRulesFile = z.infer<typeof prometheusRulesFileSchema>;
export type PrometheusProjectConfig = z.infer<
  typeof prometheusProjectConfigSchema
>;
export type CLIGlobalConfig = z.infer<typeof cliGlobalConfigSchema>;
